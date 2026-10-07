# cogload status: one small file for a status line

Extends `2026-09-17-zapara-design.md`. Everything not mentioned here stays as
that spec says.

## Purpose

A status line wants one number from cogload, the load of the last hour, and
it wants it in a few milliseconds, every thirty seconds,
without reading a single transcript. cogload takes about half a second to
compute a day, which is too slow for a status line and far too slow for one
that Claude Code kills and restarts on every event. So cogload writes the
number down, and the status line reads it back.

`cogload status` computes today and writes a one-line JSON file at a fixed
path. Whoever renders a status line reads that file, draws the number, and
decides for itself when the file is old enough to ask for a new one. The base
spec listed a statusline segment under non-goals and promised this cache
file as the later step; this is that step. The consumer in mind is
[pult](https://github.com/drakulavich/pult), but the file is plain JSON at a
plain path, and any status line can read it.

cogload stays a program that runs and exits. This spec adds no hook, no timer,
no daemon and no watcher; refreshing is the reader's job, and the contract
for it is written down below so the two sides agree without sharing code.

Prerequisite: the snapshot change (PR 25, branch `xt-fixes`), which gives
`Window` an optional `now`, `Day` an optional `asOf`, and makes `derive()`
drop events after `now`. This spec reuses that plumbing and adds none of
its own; it cannot be implemented on a `main` that lacks it.

## CLI

```
cogload status [--projects DIR]
```

- Computes the local calendar day that contains `now`, exactly as
  `cogload today` does (same `report()`, same window, same `asOf` rule: events
  after `now` are not counted).
- Writes the status file, then prints the same JSON line to stdout. `--json`
  is accepted and changes nothing, since the output is already JSON.
- The window flags (`--days`, `--from`, `--to`), `--explain` and `--out` are
  usage errors here, worded like the ones for a named day: `--days, --from
  and --to do not apply to status`, `--explain applies to a named day only`,
  `--out applies to card only`.
- Exit 0 after a successful write. A failure to read the projects directory
  is the base spec's one-line error and exit 1; a failure to write the file
  is one line, `cannot write the status file`, exit 1. Neither prints a path.
- Runtime: one day of transcripts, well under a second on a busy machine.

`--help` gains one line in the command list:

```
       cogload status                   write today's load for a status line
```

## The file

Path: `~/.claude/cogload/status.json`, where `~` is the home directory, on
every platform. There is one file per user, whatever `--projects` was; the
file describes the projects directory cogload read, and a reader has no way
to tell which one, so a person who runs `status` against a second directory
overwrites the first. The directory is created on first use.

Content: exactly one line of JSON, no trailing spaces, a newline at the end.

```json
{"schema":1,"asOf":"2026-09-19T12:30:38.300Z","date":"2026-09-19","hour":15,"index":36,"level":"Warming","peak":41,"activeMin":555,"streakMin":166}
```

| Field | Meaning |
|---|---|
| `schema` | The shape of this file: `1`. A reader that sees a number it does not know shows nothing. It changes only when a field changes meaning or goes away; adding a field does not bump it. A field that keeps its name, unit and range but is measured differently (the presence rule of 2026-09-19 for `activeMin` and `streakMin`) does not bump it either: a reader shows the corrected number, and the change is a CHANGELOG entry. |
| `asOf` | When the snapshot was taken, ISO 8601 UTC: the `Day.asOf` of the base spec, the `now` of this run. A reader decides staleness from this field, never from the file's mtime. |
| `date` | The local calendar day the numbers describe, `YYYY-MM-DD`. |
| `hour` | The local hour that contains `asOf`, `0`..`23`. |
| `index` | The load index of the sixty minutes ending at `asOf`, `0`..`100`, or `null` when they hold no session. |
| `level` | That index's level, `Calm`, `Warming`, `Heating` or `Fried`, or `null` with `index`. A reader colours by this field so it never needs the thresholds. |
| `peak` | The day's peak index so far, counting the sixty minutes ending at `asOf` as well as the day's calendar hours, so `index` is never above it; `null` when both are `null`. |
| `activeMin` | Minutes of your presence in the day so far: the 5-minute slots covered by your actions and the gaps of at most 10 minutes between them; `0` on a day with no action of yours. |
| `streakMin` | Minutes of your live presence streak as of `asOf`: from the streak's first human action to `asOf`, when your last action is no more than 10 minutes before `asOf`; `0` once you have been away longer. Not the hour's bucket. |

`hour` is the clock; `index` and `level` describe the sixty minutes ending at
`asOf` (the day's `live` bucket, see `2026-09-22-zapara-live-index-design.md`);
`peak` and `activeMin` describe the day (`peak` includes the live `index`: sixty
minutes that straddle two calendar hours can score above either of them, and a
status line reading `load 13 · peak 11` would contradict itself); `streakMin` describes now, and is the one
field that keeps growing while you sit there. It is computed from the day's
`presence` (`lastAt`, `streakStartAt`) against `asOf`, so it does not reset at
an hour boundary and does not wait for your next action to grow. On a day with no activity the
file is still written, with the `null`s and zeros above, so a reader can tell
"nothing yet today" from "cogload never ran".

Privacy: the file holds these nine values and nothing else. No path, no
project, no session count, no text, no token count: a status line has no use
for them and the file may sit in a directory other tools read.

## Writing the file

- The write is atomic: the line goes to a temporary file in the same
  directory, created exclusively (`wx`, so an existing file or symlink at
  that name is an error, never followed) under a name unique to this run,
  `status.json.<pid>.<random>.tmp`, then renamed over `status.json`. A
  reader sees the old file or the new one, never a partial line.
- A reader may start a run on every stale render; nothing coordinates readers,
  and concurrent runs are harmless because the file is written atomically.
  Each run writes its own temporary file, each rename is atomic, the last
  rename wins, and both files were complete. Renders are seconds apart and a
  run is under a second, so runs do not pile up.
- The temporary file is removed on every path out of a failed write. One
  left by a crash (a kill between create and rename) stays where it is:
  cogload never opens, reuses or deletes a temporary file it did not create
  in this run, because from the outside a crashed run and a slow one look
  the same, and deleting a slow run's file would break the promise above.
  Such a leftover is a few hundred bytes with a name no later run picks, and
  a person may delete it by hand.
- The file is created with mode `0600` (owner read and write), on every
  write, since each write is a new file. The directory is created with
  `0700`; one that exists keeps the mode it has, so a mode the person chose
  is not reset by the next run. `status.json` itself may be a symlink someone put there;
  `rename` replaces the link, it does not write through it.
- On any error before the rename, the existing `status.json` is left as it
  was: a status line keeps showing the last good snapshot with its own
  `asOf`, which is the truthful state.
- `$HOME` unset or empty is the write error above; no other location is
  tried.

## Contract for a reader

Written here so pult and cogload agree without either reading the other's
source.

- Read `~/.claude/cogload/status.json` and decode it strictly. The file is
  written by another program and can be replaced by any tool the same user
  runs, so the reader trusts nothing in it: it is one JSON object; `schema`
  is `1`; `asOf` parses as an ISO 8601 instant no later than 60 seconds after
  the reader's own clock, an allowance for the skew between two clocks and for
  a file written a moment ago; `date` is `YYYY-MM-DD`; `hour` is an integer
  `0`..`23`; `index` and `peak` are `null` or integers `0`..`100`; `level` is
  `null` exactly when `index` is, else one of the four names; `activeMin` and
  `streakMin` are integers `0`..`1500`, the ceiling being a DST fall-back day
  of 25 hours. Anything else, and a missing or
  unreadable file, is treated as no data: the segment is not drawn, and the
  file counts as stale.
- Draw `index`, the last sixty minutes' load, coloured by `level`; `null` draws nothing.
  Whatever else the reader shows (`peak`, `activeMin` as hours and minutes)
  comes from the same file.
- Staleness is `now - asOf`, or no data at all. When the file is stale, the
  reader runs `cogload status` as a detached process with stdin, stdout and
  stderr closed, does not wait for it, and draws what it has; the next read
  picks up the new file. This is how the file comes to exist on a machine
  that never ran cogload: the first render finds nothing, starts one run, and
  the render after that has the file. The threshold is the reader's (pult's
  is five minutes).
- A reader may start a run on every stale render; nothing coordinates readers,
  and concurrent runs are harmless because the file is written atomically.
  Renders are seconds apart and a run is under a second, so runs do not pile
  up.
- `asOf` moves only when cogload actually ran, so a reader that shows the
  snapshot's age shows the truth.
- `cogload` is found on the reader's `PATH`; a reader with a
  `bun`-locating wrapper (pult's) can fall back to `bunx @drakulavich/cogload
  status`. When neither is found the reader shows the file it has, or
  nothing, and never an error.
- A reader may instead run `cogload status` itself and decode the line it
  prints by the same rules, since that line equals the file's content. Such
  a reader judges no staleness and reads no file; the `cognitive-load`
  plugin does this after every turn
  (`2026-10-03-zapara-cognitive-load-plugin-design.md`).

## Architecture

- `src/statusfile.ts` is a new shell module. It is the second file, after
  `src/image.ts`, allowed to write a file, and the only one allowed to write
  the status file; CLAUDE.md's shell rule names it. It owns the path
  (`join(homedir(), ".claude", "cogload", "status.json")`), `mkdir`, the
  temporary file, `rename`, and the modes. It exports one function,
  `writeStatus(line: string): Promise<void>`.
- `src/status.ts` is core: `statusOf(day: Day, now: Date): Status` builds
  the object from the `Day` that `report()` returned, using `now` for `hour`
  and reading `index` and `level` from the day's `live` bucket rather than
  from the hour's own bucket; `renderStatus(s: Status): string` is
  `JSON.stringify` in the field order above plus the newline. Neither touches
  the clock or the file system. `Status` is the type of the table above.
- `src/index.ts`: `status` is a fourth command beside `grid`, `day` and
  `card`; it takes the day path's window (`to = localDate(now)`, `days = 1`)
  plus `streakFrom`, 1500 minutes and one 10-minute gap before `now`, which
  traces the day's `presence.streakStartAt` back past the 3-hour look-back and
  moves nothing else; `statusOf` caps `streakMin` at 1500. It
  calls `report()`, then `statusOf`, `renderStatus`, `writeStatus`, and prints
  the line. The `asOf`/`now` plumbing from the snapshot change is reused
  unchanged.
- Nothing else changes: `analyze()`, the grid, the day, the card and the
  JSON they print are untouched.

## Testing

Fixture-driven through the public seams, as the base spec requires:

- `tests/analyze/status.test.ts`: `analyze()` on a transcript with activity
  in two hours of 2026-09-14, then `statusOf(days[0], now)` with `now` inside
  the second hour: every field asserted to its exact value (`hour`, `index`,
  `level`, `peak`, `activeMin`, `streakMin`, `date`, `asOf`, `schema`). The
  same with `now` in an hour with no activity: `index` and `level` `null`,
  `peak` and `activeMin` still the day's. An empty transcript list: the
  all-`null`/zero shape. `renderStatus` on one of them: the exact line, one
  newline, field order as in the table. Each assertion fails under a
  one-line mutation (a wrong bucket picked, a field dropped, the newline
  lost).
- The live streak, in the same file: a run ending at 10:58 read with `now` at
  11:03 gives `streakMin` 63 while the 11:00 bucket's own is 0, and the same
  run read at 11:09 gives 0. Dropping the ten-minute check fails the second.
- `tests/shell/status-cli.test.ts`: the CLI with `HOME` pointing at a temp
  directory and `--projects` at a fixture tree with activity today
  (`utcDay(0)`): exit 0, stdout is one JSON line equal to the file's content,
  the file exists at `<HOME>/.claude/cogload/status.json` with mode `0600`,
  the directory with `0700`, no `status.json.tmp` beside it, and `asOf`
  matches the ISO shape. A second run with an unreadable projects directory:
  exit 1, one line on stderr, no path in it, and the file's content is
  byte-identical to before. `--days 3` with `status`: exit 2 and the usage
  message. `HOME` empty: exit 1, `cannot write the status file`. Four runs started at once against the same
  `HOME`: all exit 0, the file is one complete line, no `*.tmp` remains. A
  foreign `status.json.1.abc.tmp` placed in the directory before a run is
  still there, unchanged, after it. `status.json` replaced by a symlink to
  another file in the temp directory: after a run the path is a regular file
  and the link's target is unchanged.
- The README's `--help` test (existing) pins the new help line and the
  80-column width.

## README, CHANGELOG, CLAUDE.md

- README: one row in the usage table (`cogload status`, "write today's load
  for a status line") and a short section "Status line" with the file path,
  the field table, the reader contract in three sentences, and a link to
  pult as the reader that exists. The Limits bullet on the snapshot points
  here.
- CHANGELOG `## [Unreleased]`, `### Added`: "`cogload status` writes today's
  load to `~/.claude/cogload/status.json` for a status line to read; the file
  format and the reader's refresh contract are in the spec."
- CLAUDE.md shell rule: `src/statusfile.ts` joins `src/image.ts` as a file
  writer, for the status file only.

## Later

Not in this change: a status file for a window longer than today, a
configurable path or threshold, a `--watch` mode, a launchd or systemd unit,
and the pult side itself (a segment reading this file), which lives in pult's
repository.
