# zapara cache: parse each transcript once

Extends `2026-09-17-zapara-design.md`. Everything not mentioned here stays as
that spec says.

## Purpose

A 14-day card on a busy machine reads 816 transcripts, 1.6 GB, and parses
about 1 GB of it. With a warm disk cache that is 0.5 s of reading and 2.3 s of
`JSON.parse` on every run, although between two runs only the transcripts of
the sessions still open have changed: 8 files in the last day, against 816 in
the window. `derive` takes 21 ms. The time goes into parsing text that was
parsed the run before.

zapara keeps the events it parsed from each transcript in one SQLite file and
parses a transcript again only when the file has changed. Every command uses
the same cache: `card` and the grid on demand, and `status` each time a status
line finds its file stale.

The cache changes how fast a run is and nothing else. Over transcripts that
do not change during the run, a run with the cache, a run without it and a
run with a broken cache print the same stdout and exit the same way.

## What is stored

The transcripts are the system of record. The cache is data derived from
them: any row can be thrown away and rebuilt from the transcript it came
from, and so can the whole file. That decides the design below. There are no
migrations, every doubt resolves to a miss, and durability is traded for
speed.

One SQLite database, `~/.claude/zapara/cache.db`, opened with `bun:sqlite`
(built into Bun, so the rule of no runtime dependencies holds). `~` is `HOME`
from the environment, as for the status file: an empty `HOME` means no cache,
not a fallback path. The directory is created 0700 and the database 0600, by
`chmod` on each directory as it is made, and by creating the database
itself with an exclusive 0600 open before SQLite opens it (SQLite would create
it 0644 less the umask; it gives `-wal` and `-shm` the database's mode). The process umask is not
touched: it would outlive the cache and narrow the card the same run writes,
so a card written with the cache on came out 0600 and with `--no-cache` 0644.
Modes are set only when zapara creates the directory or the file; one that
exists keeps the mode it has, so a mode the person chose is not reset by the
next run.

```sql
PRAGMA user_version = 1;       -- storage format
PRAGMA journal_mode = WAL;     -- leaves cache.db-wal and cache.db-shm beside it
PRAGMA synchronous = NORMAL;   -- a lost last transaction is only a slower run
PRAGMA busy_timeout = 2000;

CREATE TABLE transcript (
  dev      INTEGER NOT NULL,   -- device and inode of the file: the key
  ino      INTEGER NOT NULL,
  parser   BLOB    NOT NULL,   -- fingerprint of the parser that wrote the row
  size     INTEGER NOT NULL,   -- bytes parsed: the log offset reached
  mtime_ms REAL    NOT NULL,
  tail     BLOB    NOT NULL,   -- SHA-256 of the last 4 KiB parsed, or all of it if shorter
  from_ms  REAL    NOT NULL,   -- the cutoff the bytes were parsed with
  used_at  INTEGER NOT NULL,   -- epoch ms of the last run that read or wrote the row
  events   BLOB    NOT NULL,   -- encoded events, below
  PRIMARY KEY (dev, ino)
);
```

The table keeps its rowid: SQLite advises against `WITHOUT ROWID` for rows
holding large blobs, and one transcript's events reach about 1 MB. There is
no index on `used_at`; at under a thousand rows a full scan costs nothing.

### Versions

A database whose `user_version` is not the one this zapara
writes is deleted with its WAL files and created again.

`parser` is the parser fingerprint: the SHA-256 of `src/parse.ts` and
`src/types.ts` (which defines `Event`) read from disk at start-up, plus the
package version. `parse.ts` imports nothing else, and both files ship in the
npm package, so the fingerprint is the same from a checkout or an install.
Every row carries the fingerprint of the run that wrote it, and a row with
another fingerprint is never a hit. The fingerprint lives in the row rather
than once per database because two versions of zapara can run at the same
time: an old run that started before an upgrade may still write its rows
after a new run has cleaned up, and those rows must not pass for current.
Any edit to the parser or the event shape, or a release, reprocesses
everything, and nobody has to remember a version bump.

### Encoding

`events` is UTF-8 JSON,
`{ "sessions": [id, …], "events": [[ts, kind, sessionIndex, tokens?], …] }`,
where `kind` is the event kind's name and `tokens` appears only on `output`
events. It holds what `parseTranscript` returned, in order, and nothing else.
This is only the storage format: on a hit it is decoded back into the same
`Event` objects, session ids included, before anything else sees them. No
forward or backward compatibility is needed, because a format change is a
new `user_version` and the rows are rebuilt.

### Key

A row is keyed by the file's device and inode, not by anything derived from
its path. A hash of the path would be reversible by guessing, since the paths
follow a known pattern (`~/.claude/projects/<encoded project dir>/<session
uuid>.jsonl`), and a salt stored in the same database would not help once a
copy of the file leaves the machine. With `(dev, ino)` the database holds
nothing that points at a path. A renamed transcript keeps its inode and is
still a hit, correctly, since its bytes are the same. An inode reused by a new
file after a deletion is a hit only if the new file matches `size`,
`mtime_ms` and `tail` all at once. If its bytes are the same, so are its
events; otherwise it is the accepted case of a rewrite that keeps the last
4 KiB, below. A file
whose `stat` reports an inode of 0, as some file systems do, is parsed and
never cached. The path order that the core needs comes from `scan`, never
from the database.

## A run with the cache

`scan` returns each file it kept as `{ path, dev, ino, size, mtimeMs }` from the
`stat` it already does, instead of the bare path; a file that vanishes or
fails `stat` is skipped, as today. For each file, in the sorted path order
that `scan` returns and `analyze()` also uses, `report()`:

1. looks `(dev, ino)` up; the row is a candidate when `parser` is this
   run's fingerprint, `size` and `mtime_ms` match the scan's `stat` and `from_ms` is not later than this
   run's cutoff, since events parsed from an earlier cutoff hold every event
   a later one needs;
2. for a candidate, reads the file's last 4 KiB (or all of it, if shorter);
   the row is a hit when their SHA-256 equals `tail`. mtime alone is not
   trusted: a sync, a restore or a skewed clock can leave it unchanged
   over different bytes, which is the reason `scan` already reads tails;
3. on a hit, uses the stored events and reads nothing more;
4. on a miss, opens the file, takes `fstat` on the handle, reads it, takes
   `fstat` again, and parses with `parseTranscript(text, cutoff)`. The row is
   written only when both `fstat` calls agree on device, inode, size and mtime and
   the size equals the bytes read; it stores those values and the tail of
   the bytes read. Otherwise the events are used for this run and nothing
   is cached.

The transcript is an append-only log, and `size` with `tail` is what a log
consumer keeps: an offset, and a check on the bytes just before it. The check
catches a rewrite that reaches the end of the file, which is what a restore or
a sync of a different copy does. It does not catch a rewrite of the same
length that keeps the inode, the mtime and the last 4 KiB; proving that would
mean hashing the whole file, which is the read the cache exists to avoid.
That case is accepted: Claude Code only appends to a transcript, and a run
with `--no-cache` is the way to rule the cache out. The same offset and check
are what reading only the appended part would need later (see Later),
without a schema change.

All lookups are one `SELECT` over the `(dev, ino)` pairs of the run. All writes, the `used_at`
updates and housekeeping go in one `BEGIN IMMEDIATE` transaction at the end
of the run. The events from hits and misses are concatenated in that sorted
path order, the order `analyze()` builds, so equal events keep their order
and the result cannot depend on which files hit.

### Concurrent runs

A status line runs `zapara status` over one day while a
`card` may run over fourteen. Two runs can write the same row, and a plain
upsert would let the narrow run replace the wide row: every `card` after it
misses, the status line narrows the row again, and the cache stops helping
the run it was built for. The write is therefore conditional:

```sql
INSERT INTO transcript (…) VALUES (…)
ON CONFLICT(dev, ino) DO UPDATE SET …
WHERE NOT (transcript.parser = excluded.parser AND transcript.size = excluded.size
           AND transcript.mtime_ms = excluded.mtime_ms
           AND transcript.tail = excluded.tail
           AND transcript.from_ms <= excluded.from_ms);
```

A row for another version of the file, or from another parser, always
replaces the old one; a row for the same file and parser replaces it only when
it covers more. Parsing is
deterministic, so two runs writing the same version write the same events,
and whichever commits last leaves the wider coverage in place. Run one
after the other, a narrow run never writes over a wide row, since the wide
row is already a hit for it; only two runs that both miss and commit in the
wrong order reach this condition. No deterministic test can stage that, so
the `WHERE` is a guard the tests do not pin.

### Files that change during a run

The guarantee of identical output covers transcripts that do not change
during the run. A transcript being written while zapara reads it gives
different answers from one run to the next with or without a cache; the
`fstat` pair only keeps such a read out of the cache, so a later run does
not reuse a half-written snapshot.

### Housekeeping

In the same transaction, rows with `used_at` older than 90
days, the widest window zapara accepts, are deleted. There is no `VACUUM`;
the file stays at a few megabytes.

## The core

`analyze(transcripts, window)` stays as it is, for the tests that feed it
text. It becomes `parseTranscript` over each transcript followed by a new
export, `analyzeEvents(events, window) → Day[]`, which is `derive` over events
that were parsed already. Both stay pure; the cache lives entirely in the shell.
`analyzeEvents` exists for `report()`. Tests do not import it: their entry
points stay `analyze()`, `report()` and the CLI, as `CLAUDE.md` says.

## Failure

The cache is never a reason for a run to fail or to change its answer.

- The database cannot be opened, is locked past a 2 s `busy_timeout`, or
  fails a query: the run parses every file as it does today and writes
  nothing to the cache.
- The file is not a database, is corrupt, or has another `user_version`:
  it is deleted along with its WAL files and created again, once; if that
  fails too, the run goes on without a cache. Corruption past the header
  shows only when the lookup reads a damaged page, so a lookup that fails
  as corrupt is treated the same way: the file is recreated and the run
  misses every file and fills the new one. The run deletes the file only
  if the path still holds the one it opened (same device and inode); if
  another run has already recreated it, this run opens that one instead,
  so two runs recovering at once never delete each other's fresh cache.
- A row whose `events` does not parse or does not have the shape above is a
  miss, and the row is deleted in the run's write, so the miss's fresh row
  takes its place; the conditional upsert alone would keep the broken row,
  which matches on parser, size, mtime and tail.
- No cache error is printed, and none reaches the exit code.

## CLI

- `--no-cache` runs without reading or writing the cache, for any command.
  `--help` gains the line `--no-cache        parse every transcript again`.
- `--verbose` gains one line after `read`:
  `cache   810 hits, 6 misses` (or `cache   off` with `--no-cache`, when
  the cache could not be opened, or when its lookup failed).
- On a miss the `read` line counts only the files that were read.

## Privacy

The base contract forbids keeping a file path. The cache keys each row by
the file's device and inode and stores nothing derived from the path. Events
carry what they carry today: timestamps, session ids, kinds and token counts. No message text, prompt
length or title is stored. The base spec's privacy paragraph gains one
sentence saying so, in this change. A transcript whose events carry a session
id that is not a UUID is parsed and counted as usual but never cached, so a
hand-made file cannot copy its own text into the cache.

## Project rules this changes

`CLAUDE.md` and the base spec's architecture section:

- `src/cache.ts` joins the shell. It is the only module that uses
  `bun:sqlite`, reads `src/parse.ts` and `src/types.ts` for the parser
  version, or writes the cache; `src/image.ts` and `src/statusfile.ts` keep their own rules.
- The list of modules allowed to write a file becomes three:
  `image.ts` (the card), `statusfile.ts` (the status file), `cache.ts`
  (the cache).

## Testing

CLI tests over fixture project trees in the real transcript format, with
`HOME` pointing at a temporary directory so no test touches the real cache.
Existing CLI tests get the same `HOME`, or they would start writing to it.

"Same output" below means the same stdout and exit code; the `--verbose`
lines on stderr differ by design and are asserted on their own.

- A second run prints the same output as the first and as a `--no-cache`
  run, and its `--verbose` cache line reports a hit for every file.
- A typed prompt appended to one transcript, inside the window, raises that
  hour's `prompts` by one in the output, and the cache line reports exactly
  one miss.
- A one-day run followed by a seven-day run over the same tree: the second
  run prints what `--no-cache` prints for seven days, including events older
  than the one-day cutoff.
- A seven-day run, then a one-day run, then a seven-day run: the third run
  reports a hit for every file, so the narrow run did not replace the wide
  rows.
- A transcript rewritten with different bytes of the same length, its mtime
  set back with `utimes`: the next run reports that file as a miss and prints
  what `--no-cache` prints.
- A cache row with garbage in `events`, and a `cache.db` that is plain text,
  each give the `--no-cache` output and exit 0; after the garbage row, the
  run after next hits every file.
- A `cache.db` whose header is intact but whose second page is garbage
  gives the `--no-cache` output, and the run after it hits every file.
- A lookup that fails prints `cache   off` under `--verbose`.
- The directory and the database are 0700 and 0600 when created, and keep
  modes set on them afterwards.
- An unwritable `~/.claude/zapara` gives the `--no-cache` output and exit 0.
- The cache files contain neither the fixture's paths nor any of its message
  text, nor the SHA-256 of any fixture path.
- A transcript renamed within the tree is a hit on the next run, and its
  output matches `--no-cache`.
- An old-parser row for an unchanged file (written by a test with another
  fingerprint in `parser`) is a miss.

Mutations to check the tests, one line each: a hit that ignores `size` must
fail the appended-prompt test; a hit that ignores `from_ms` must fail the
one-day-then-seven-days test; a hit that ignores `tail` must fail the rewritten-file
test; a hit that ignores `parser` must fail the old-parser test.

Performance target: a warm `zapara card --json` on this machine, with no
transcript changed since the last run, under 1 second.

## Later

A transcript that only grew could be read from where the last run stopped,
at `size`, once `tail` matches, with the parser's
state (`lastTs`, `lastMode`, the request and question ids)
saved beside the row. That would make the open sessions free as well. It waits
until the whole-file cache shows how much time is left in those files.
