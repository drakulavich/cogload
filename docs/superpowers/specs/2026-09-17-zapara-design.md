# zapara: cognitive load index from Claude Code transcripts

Date: 2026-09-17. Status: approved design for the MVP.

## Purpose

`zapara` reads the transcripts Claude Code already writes under `~/.claude/projects`
and turns them into an hourly Cognitive Load Index (0–100) for the person driving
the sessions. The MVP has one job: show a week of history as a picture that a human
can check against their own memory, so the formula can be judged and calibrated.
Nothing is installed into Claude Code and nothing leaves the machine.

Privacy contract: the parser compares message text against three fixed control
markers (interrupt, tool rejection, and the two tool names below) and discards it.
No message text, prompt length, file path from a tool call, or session title is
kept in an event, written anywhere, or printed. The output contains only
timestamps, session ids, counts and the derived numbers. The CLI never prints
a filesystem path it derived or read, including the projects root; usage
errors may echo the offending argv token. The parse cache (`2026-09-26-zapara-transcript-cache-design.md`)
keys its rows by a transcript's device and inode and stores nothing derived from its path.

Non-goals for the MVP: real-time alerts, break nudges, hooks, OpenTelemetry, a
statusline segment, an HTML dashboard, a config file for weights. The statusline
integration is `2026-09-19-zapara-status-file-design.md`.

## Data source

Root: `~/.claude/projects` (override with `--projects <dir>`, used by tests).
Layout that matters:

```
<projects>/<project-slug>/<session-id>.jsonl                 # one main transcript per session
<projects>/<project-slug>/<session-id>/subagents/agent-*.jsonl   # subagent transcripts
```

Scan rules:

- Take every `*.jsonl` whose path does not contain a `subagents/` directory.
  Subagent files carry the parent's `sessionId`, every record is `isSidechain: true`,
  and their "user" messages are the parent agent's prompts, not the human's.
- Skip a file whose mtime is earlier than `windowStart - LOOKBACK` where
  `LOOKBACK` is 3 hours, unless the last `"timestamp"` in its final 64 KB falls
  at or after that cutoff. mtime is a hint, not the truth: a transcript synced
  from another machine, restored by a tool that rewrites times, or written
  under clock skew can be older by mtime than the records inside it, and the
  tail read (one small read per old file) recovers it without giving up the
  "week under 2 s" budget. This keeps a week view from parsing thousands of
  old files.
- Return paths sorted lexicographically, so the same tree always yields the same
  file order.
- A file that cannot be read (permissions, vanished between listing and reading)
  is skipped. A missing or unreadable projects root is an error (exit 1).
- Read line by line. A line that is not valid JSON, or has no `type`, is skipped.
  A bad line never aborts the file or the report.

## Events

The parser turns records into a flat list of events. Each event has `ts`
(epoch ms from `timestamp`), `sessionId`, and a `kind`. Records without a
`timestamp` are handled per kind below. Records with `isSidechain: true` are
ignored for every kind (defensive; the scan already skips subagent files). So
are records whose `entrypoint` starts with `sdk-` (`sdk-cli`, `sdk-ts`): a
script ran `claude -p` or the Agent SDK, and no human sat in that session.

| kind | rule |
|---|---|
| `prompt` | `type == "user"`, `isMeta` not true, and the message content is a string, or an array containing a `{type:"text"}` block; the first text block is the one compared against the markers, and its text is neither an interrupt marker nor an agent-message marker. A pasted image is written as an `image` block in front of the typed text, so the text block is not always the first block. A prompt is something the human typed. |
| `report` | `type == "user"`, `isMeta` not true, content string or first text block starting with an agent-message marker: `Another Claude session sent a message:`, `<teammate-message`, `<cross-session-message`, `<task-notification>` or `[Cross-session`. These are messages from subagents, other sessions and background tasks that the human has to read and react to. Not a prompt. |
| `output` | `type == "assistant"` with a string `requestId`, a `message.usage.output_tokens` that is a finite non-negative integer (anything else, such as `1e309` or a negative count, carries no tokens and is only `activity`), and at least one `{type:"text"}` content block. One event per distinct `requestId` per file (the first record seen), carrying `tokens`. Claude Code writes one record per content block of a response and repeats the same `usage` on each, so the count is per request, not per record; requests that hold only tool calls are not text the human reads. |
| `interrupt` | `type == "user"`, content array with a text block whose text starts with `[Request interrupted by user`. Covers both `[Request interrupted by user]` and `[Request interrupted by user for tool use]`. Not counted as a prompt. |
| `reject` | `type == "user"`, content array containing a `tool_result` block whose content (string, or first text block) starts with `The user doesn't want to proceed with this tool use`. |
| `answer` | `type == "user"`, content array containing a `tool_result` block whose `tool_use_id` matches the `id` of an `AskUserQuestion` or `ExitPlanMode` `tool_use` seen earlier in the same file. The parser keeps the ids of those two tools and no others, because every other `tool_result` is the machine reporting back, while these two carry the option the human picked or their verdict on a plan. One event per matching block, in addition to `activity` and, when the text starts with the rejection marker, `reject`. An answer is presence and nothing more: not a prompt, not a decision, not a report. |
| `question` | `type == "assistant"`, content array containing a `tool_use` block with `name == "AskUserQuestion"`. One event per block. |
| `plan_review` | Same as `question` with `name == "ExitPlanMode"`. |
| `mode_change` | `type == "permission-mode"`. Has no timestamp: it takes the `ts` of the last timestamped record seen earlier in the same file, or, when none has been seen yet, the `ts` of the first timestamped record that follows in the same file (one event per waiting switch). A switch is dropped only when the file holds no timestamped record at all. The first such record in a file sets the session's baseline mode and is not a switch (every session writes its starting mode). Each later record whose `permissionMode` differs from the previous record's is one switch; repeats of the same mode count nothing (Claude Code rewrites the same mode repeatedly). |
| `activity` | Every `type == "user"` or `type == "assistant"` record with a timestamp, including `isMeta` ones. Used for session liveness (`sessions`) only. |

`prompt`, `report`, `interrupt`, `reject`, `answer` and `output` records are also `activity`. The
parser emits both events for them; the deriver never double counts because it
reads kinds separately.

The record shapes above were verified against Claude Code 2.1.274 transcripts on
2026-09-17. Field names are not a published API and may drift; the CLAUDE.md of the
repo records each drift when it happens.

## Buckets and metrics

Time is local. A day is the 24 local hour labels `00`..`23`; an event belongs to
the bucket named by its local date and hour. On a DST fall-back day two wall-clock
hours share one label and merge into one bucket; on a spring-forward day one label
stays empty. So a merged bucket can hold up to 120 active minutes and such a day
up to 1500, which is the ceiling a reader of either number should allow. A week
view is `--days` days ending on `--to` (default today).

Ordering: before deriving anything, all events from all files are sorted by
`ts`, then `sessionId`, then their position in the parsed input. Every
"consecutive" below refers to this order. File discovery order never affects a
result.

Look-back: the deriver receives events from `windowStart - LOOKBACK` (3 hours)
onward. Events before `windowStart` contribute only to `streakMin` and to the
presence spans that reach into the window; slots and events before
`windowStart` are never bucketed. Because the streak component of the index saturates at 40
minutes, the index is exact at the window boundary. The displayed `streakMin`
of a streak that started more than 3 hours before the window is floored at what
the look-back sees, which is the one documented approximation.

Presence: a presence event is one the human performed — `prompt`, `interrupt`,
`reject` or `answer`. Records the agent wrote (`activity`, `report`, `output`)
and the agent's own asks (`question`, `plan_review`) are never presence: an agent
that works on while the human is away must not keep a streak alive or fill a day.
A presence streak is a run of consecutive presence events in which no two
neighbours are more than 10 minutes apart, in the global order, across all
sessions; a gap of exactly 10 minutes continues it, 10 minutes and 1 ms breaks
it.

Per bucket:

| metric | definition |
|---|---|
| `sessions` | distinct `sessionId` with at least one `activity` event in the bucket |
| `prompts` | count of `prompt` (messages the human typed) |
| `reports` | count of `report` (inbound agent, session and task messages) |
| `outputTokens` | sum of `tokens` over `output` events |
| `interrupts`, `rejects`, `questions`, `plans`, `modeSwitches` | counts of the matching kinds |
| `decisions` | `interrupts + rejects + questions + plans + modeSwitches` |
| `contextSwitches` | over all `prompt` events in the bucket sorted by `ts`, the number of consecutive pairs whose `sessionId` differs |
| `activeMin` | number of distinct 5-minute slots the human's presence covers in the bucket, times 5. Every presence event covers its own slot (`floor(ts / 5 min)`); two consecutive presence events of the same streak also cover every slot between them, from the earlier one's slot to the later one's, inclusive. A slot belongs to the bucket of the local date and hour of the slot's start; a slot starting before `windowStart` is never bucketed. So a prompt at 14:58 and one at 15:04 give bucket 14 five minutes and bucket 15 five minutes; a lone prompt gives 5; a prompt at 10:00 followed by assistant records every minute until 10:30 gives 5. |
| `streakMin` | the longest presence streak the bucket saw: the maximum, over the bucket's presence events, of the time from that event's streak's first event (which may lie in the look-back, before the window) to the event itself. 0 when the bucket has no presence event. The maximum, not the last event's streak, because a single action after a break would otherwise erase the run the hour actually held. A streak is longest at its last event, and that event lies in exactly one bucket, so the maximum over buckets is the run's true length: that is what makes the card's "longest streak" exact. |
| `lateNight` | bucket hour in {23, 0, 1, 2, 3, 4, 5} |

Per day: `peak` (max index over buckets with activity), `mean` (mean index over
buckets with activity, rounded), `activeMin` (sum), and the sums of every count
including `reports` and `outputTokens`.

`presence` is the day's last presence event and the start of the streak that
event belongs to, as `{ lastAt, streakStartAt }` in ISO 8601 UTC, or `null` on
a day with no presence event. `streakStartAt` may fall on an earlier day or in
the look-back. Both are instants, not counts, so a reader with a clock can
measure the streak against its own `now`: that is what the status file does,
and it is why a live streak needs no bucket. The first day of the window takes
the last presence event of the look-back as its `presence` when it has none of
its own, so a report run minutes after midnight still knows the streak that
was running; that event reaches this field alone, never a bucket, a total or
an active minute. `presence` appears in `--json` like every other field of a
`Day`.

`reports`, `outputTokens` and `contextSwitches` enter the index through its
supervision and reading components (see Index).

## Index

Each bucket with activity gets six normalized components in `[0, 1]`:

```
parallel    = clamp((sessions - 1) / 4)                                   # 1 session → 0, 3 → 0.5, 5+ → 1
pace        = clamp(prompts / 20)                                         # 10 prompts/hour → 0.5, 20+ → 1
supervision = clamp((3 * decisions + reports + contextSwitches) / 45)     # 15 decisions alone → 1; 45 reports alone → 1
reading     = clamp(outputTokens / 80000)                                 # 40k → 0.5, 80k+ → 1
streak      = clamp(streakMin / 40)                                       # 20 min → 0.5, 40+ → 1
late        = lateNight ? 1 : 0

index = round(25*parallel + 15*pace + 30*supervision + 10*reading + 10*streak + 10*late)
```

The weights are integer points of 100 (25/15/30/10/10/10). They are kept as
integers so that half-point sums such as 17.5 stay exact in floating point and
round the same way every time; with fractional weights those sums drift to
17.4999… and the index can come out one lower than the formula says. The six
weighted terms are the `parts` a bucket reports (rounded to one decimal for
display); the index is the rounded sum of the unrounded terms. Without the
late-night flag the index tops out at 90.

A bucket without activity has no index (rendered as `·`, `null` in JSON).

Levels: 0–29 Calm, 30–59 Warming, 60–84 Heating, 85–100 Fried.

The parallel-session thresholds follow the research summary this project started
from: BCG/HBR (productivity drops past three simultaneous AI tools) and Osmani
("three focused teammates outperform five scattered ones"). The other norms are
the p90 of two weeks of real data on two machines (116 and 114 active hours).

Supervision and reading are there because explicit decisions turned out to be
rare: in auto mode the p90 is 3 decisions per hour, so a component normed on
decisions alone read near zero on hours that felt heavy. What those hours cost
is supervision — reacting to inbound agent reports and switching between
sessions — and reading, the sheer volume of model output to get through. A
decision still counts for three times what one report or one session hop counts
for, and the three share one norm of 45. The pace norm is 20 because human
prompts per hour reached a p90 of 13 on one machine and 20 on the other; 40 was
unreachable. The streak norm was re-measured once the presence rule started
counting only the human's own actions: over the same 14 days and 118 active
hours the p90 fell from 156 minutes under the old rule, which let agent activity
keep a streak alive, to 33 minutes, with a maximum of 74. It is therefore 40,
not 120, so that an hour of unbroken presence scores the full streak points; the
second machine's numbers are still to come and may move it again. Weights and
norms live in one exported constant in `src/score.ts` so a change is one diff.

## CLI

Runs from TypeScript on Bun, no build step. `bin.zapara` points at `src/index.ts`
with a `#!/usr/bin/env bun` shebang.

```
zapara [window]                 # the last 7 days, one cell per hour (the grid)
zapara today|yesterday|<date>   # one day, one row per active hour, [--explain]
window: --days N | --to <date> | --from <date> --to <date>
common flags: --json  --projects <dir>  --no-color  -h/--help  -V/--version
```

The window is one of: `--days N` ending today, or ending at `--to <date>`
when both are given; `--to <date>` alone, 7 days ending there; `--from <date>
--to <date>`, both inclusive, at most 90 days; `--from` alone runs to today. `--from` with `--days` is an error: the dates set the
length. A date is `YYYY-MM-DD`, `today` or `yesterday`, in every position,
including the day's name; `--days`, `--from` and `--to` on a named day are
errors. `--days=30` is accepted beside `--days 30`. A value flag given twice
is a usage error. (Until 0.2.0 the grid was `week` and the day was `day
<date>`.)

The grid prints one row per day, 24 cells, then `peak` and `active`:

```
            00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23   peak  active
Mon 14/09    ·  ·  ·  ·  ·  ·  ·  ·  ░  ▒  ▒  ▓  ▓  █  █  ▓  ▒  ░  ·  ·  ░  ▒  ▒  ░    87   9h40
```

Cell glyphs by level: `·` no activity, `░` Calm, `▒` Warming, `▓` Heating, `█`
Fried. In a TTY the glyphs are colored green / yellow / orange / red; in a pipe or
with `--no-color` / `NO_COLOR` they are plain. Below the grid, dimmed in a TTY: a
legend line (the four level glyphs and names, no ranges; the ranges are in
`--help`) and one totals line (active time, prompts, reports, decisions, sessions
at once; counts past 9 999 print compact, `12k`, `1.2M`). When the window
includes today, one more dimmed line follows: `as of HH:MM, this hour is
still running`, the local time the report was generated, because the last
day's transcript is still being appended to.

A named day prints one row per bucket that has activity:

```
hour   index  level    sess  prompts  rep  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok
13:00     87  Fried       5       24   12     6    2      3     1     2       4     95m    72.0k
```

An event column (`rep`, `intr`, `rej`, `quest`, `plan`, `mode`, `ctx-sw`) that
is 0 in every row is left out, and one line under the table, dimmed in a TTY,
names what the day had none of (`no reports, rejects today`). The other
columns always show, so two days still line up. If the day is today, the same
`as of HH:MM, this hour is still running` line follows.

`--explain` adds six columns with each weighted contribution; for the row above
they read `par 25 pace 15 sup 30 read 9 strk 7.9 late 0`, so the number can be
traced to its inputs.

`--json` prints the same data as one JSON document: for the grid, an array of days,
each with `date`, `peak`, `mean`, `activeMin`, `presence`, totals and a `buckets`
array of 24 entries, each with `hour`, every metric, and `score`, which is
`{ index, level, parts }` or `null` when the bucket has no activity; for a day,
one such day. `presence` is `{ lastAt, streakStartAt }`, two ISO 8601 UTC
instants: the day's last presence event and the first event of the streak it
belongs to. It is `null` on a day with no presence event, and `streakStartAt`
may fall on an earlier day or in the look-back. The first day of the window
carries the last presence event of the look-back when it has none of its own,
so a window that opens minutes after a person stopped typing still knows the
streak they are in; nothing else about that event enters the window.
JSON is also the default when stdout is not a TTY. The day that
contains the moment the report ran also carries `asOf`, that moment as an ISO
8601 UTC string; every other day omits the field. That day's own numbers cover
only events timestamped at or before `asOf`, so a record appended while zapara
was reading, or one later than the snapshot, is excluded even though it falls
inside the window.

Defaults and validation: `--to` defaults to today. `--days` defaults to 7 and
accepts an integer from 1 to 90. A date must be `YYYY-MM-DD` and a real
calendar date, or the words `today` and `yesterday`. Any other value, an
unknown command or an unknown flag prints one line plus `run 'zapara --help'
for usage` to stderr, exit 2.

Errors: a missing or unreadable projects directory prints one line to stderr
without the path, exit 1. Anything unexpected prints one line to stderr, never
a stack trace, exit 1. A window with no data prints the empty grid (or an
empty day table) and exits 0.

## Architecture

Functional core, imperative shell, grouped by feature. `src/lib/` is the
library: one folder per feature, each with an `index.ts`. `src/cli/` is the
command line that calls it. The layout and its reasons are in
`2026-09-26-zapara-lib-cli-layout-design.md`.

```
src/cli/
  index.ts        the bin: main(), the versions for --verbose, errors → exit codes
  args.ts         USAGE, HINT, Args, the usage errors, parseArgs(argv, now, env, isTTY, projects)
  timing.ts       timingLines(timing, env) → the --verbose lines
  commands.io.ts  grid and day tables, status, card
src/lib/
  types.ts        Event, EventKind, Day, HourBucket, LiveBucket, Metrics, Totals, Window, Transcript
  transcripts/    parse.ts       JSONL text → Event[]
                  scan.io.ts     projects dir + cutoff → sorted ScanEntry[] { path, dev, ino, size, mtimeMs }
                  cache.io.ts    parsed events cached by a transcript's device and inode; the only
                                 module that uses bun:sqlite, and it reads parse.ts and ../types.ts
                                 for the parser fingerprint (2026-09-26-zapara-transcript-cache-design.md)
  metrics/        analyze.ts     analyze(transcripts, window) → Day[]; analyzeEvents(events, window)
                  derive.ts      Event[] + window → Day[] with HourBucket metrics
                  score.ts       metrics → { index, level, parts }; WEIGHTS, NORMS
  report/         report.io.ts   report(options) → Day[]: scan, cache lookup, read, analyze
  text/           render.ts      Day[] → week / day / explain / json strings
                  format.ts      compact counts and plurals
  card/           card.ts        Day[] → CardData
                  cardhtml.ts    CardData + CardAssets → the card page
                  image.io.ts    reads the assets, renders the page to PNG or WebP through
                                 Bun.WebView and Bun.Image, opens the result
                                 (2026-09-18-zapara-card-design.md)
  status/         status.ts      today's Day → the status line
                  statusfile.io.ts  the line → ~/.claude/zapara/status.json
                                 (2026-09-19-zapara-status-file-design.md)
```

Two naming rules carry the design. A file named `*.io.ts` may touch the
world: the file system, the clock, the environment, `Bun`, `process`. Every
other file under `src/lib/`, and `src/cli/args.ts` and `src/cli/timing.ts`,
is pure. A feature's `index.ts` is its only door for other features, the CLI,
tests and scripts; `src/lib/types.ts` is imported directly.

Three files write to disk: `card/image.io.ts` (the card, and the page it
renders from, in a temporary directory it removes), `status/statusfile.io.ts`
(the status file) and `transcripts/cache.io.ts` (the parse cache).

`analyze()` is the core's entry point: it takes transcript contents already in
memory, in the real JSONL format, plus a window (`{ to, days, now? }`) and
returns the same `Day[]` the CLI prints. `now`, when given, is the moment the
report is taken; the one returned day whose date contains it gets `asOf` set to
its ISO 8601 UTC string, marking that day as a snapshot of a transcript still
being written, and every event timestamped after `now` is excluded from that
day's buckets and totals, even one inside the window, so the snapshot covers
everything up to `asOf` and nothing after. Fixture tests feed it directly with
in-memory transcripts and get the statistics back without touching the disk;
the CLI tests and the report test cover the shell.

`bun run lint` holds the rules, as part of `bun run check`. Biome
(`biome.json`) fails a pure file that imports `node:` or `bun:` or names
`Bun`, `process` or `Buffer`, an import that reaches into another feature
past its `index.ts`, a library file that imports the CLI, and any import
cycle. Knip (`knip.json`) fails a file under `src/` that nothing uses, and an
export or exported type that nothing imports. The
current time is a parameter, never `Date.now()` inside the core; that one
stays a review item.
Named exports only. No runtime dependencies.

Performance target: a week view over this machine's `~/.claude/projects` (about
2 900 files, mostly filtered by mtime) under 2 seconds.

## Testing

Tests follow Kent Beck's Test Desiderata: behavioral and structure-insensitive
(they exercise what the tool reports, not how modules are wired), deterministic,
fast, readable, and specific enough that a failure names the broken behavior.
Unit tests are kept to a minimum; the bulk of the suite runs the whole pipeline
over fixture transcripts and asserts the resulting statistics.

Public seams for tests: `analyze(transcripts, window)` in the core takes in-memory
transcripts, and `src/report.ts` exports `report({ projects, to, days, now? })`,
which runs scan → parse → derive → score and returns `Day[]`, the same structure
`--json` prints. The CLI is a thin layer over it. Tests call `analyze()`, `report()` or spawn
the CLI; they never import `parse`, `derive` or `scan` directly. Refactoring the
internals must not touch a test.

Fixtures are real-format transcripts:

- `tests/fixtures/<scenario>/` is a projects tree in the exact on-disk layout
  (`<slug>/<session>.jsonl`, `<slug>/<session>/subagents/agent-*.jsonl`). Lines
  use the real field names and shapes of Claude Code 2.1.274 records: `type`,
  `timestamp`, `sessionId`, `isMeta`, `isSidechain`, `message.content` blocks,
  `permission-mode` records, and so on. They are redacted copies of real lines or
  built by the helper below; message text is a placeholder.
- `tests/helpers/transcript.ts` builds such lines and files from a compact
  script (`prompt(ts, sid)`, `interrupt(ts, sid)`, `reject`, `question`,
  `plan`, `mode(sid, "plan")`, `assistant(ts, sid)`) and writes a scenario
  tree into a temp directory, setting file mtimes explicitly. Edge cases that
  need exact timestamps use the builder; representative scenarios live on disk.
- Each scenario has an `expected.json` (or inline expectations) with the
  `Day[]` statistics it must produce for a fixed `--to`.

Scenarios, one directory or builder script each:

- `busy-week`: 7 days with varied load, the reference picture; pins peaks,
  active minutes, per-day totals and the rendered week grid.
- `hour-edges`: events at `:59:59.999` and `:00:00.000`, and across midnight.
- `parallel-sessions`: 1, 3 and 5 sessions in one hour; context switches
  between them; a single session yields zero switches.
- `streak`: prompts across sessions with a 9-minute gap (continues) and an
  11-minute gap (breaks); assistant records and inbound reports inside an
  11-minute gap between prompts do not bridge it, while an interrupt or a tool
  rejection between them does, being presence itself; a streak that starts in
  the 3-hour look-back before the window; a file whose mtime and last record
  are both before the cutoff, which stays ignored.
- `active minutes`: a lone prompt covers one slot; two prompts 8 minutes apart
  cover both slots between them; a span across an hour boundary gives each hour
  its own slots; agent-only minutes cover nothing.
- `decisions`: interrupts of both marker forms, tool rejections,
  `AskUserQuestion`, `ExitPlanMode`, repeated `permission-mode` records
  collapsing to one switch, and `permission-mode` switches made before any
  timestamp attributed to the first timestamped record that follows: a
  baseline record and one differing record before the first prompt give that
  hour 1 switch, a baseline and two further differing records give 2, and a
  switch is dropped only when the file holds no timestamped record at all.
- `agents`: inbound agent messages of every marker form count as `reports` and
  activity, never as prompts; a human prompt in the same hour still counts as one
  prompt; `output` tokens are summed once per `requestId` although the fixture
  repeats the usage on three records of one request; a request holding only a
  `tool_use` block contributes no tokens; day totals carry `reports` and
  `outputTokens`.
- `noise`: `isMeta` messages, a `subagents/` tree with prompts that must not
  count, `isSidechain` records in a main file, `claude -p` and Agent SDK sessions,
  malformed JSON lines, lines
  without `type` or `timestamp`, an empty file, an unreadable file.
- `report`: through `report()`, not `analyze()` — a `subagents/` tree whose
  prompts don't count, a same-named file at the root that does, a file
  chosen by its records rather than its mtime: an old mtime with an
  in-window last record counts (the restored/synced case) and a file with
  no in-window record adds nothing; the mtime comparison itself is now a
  shortcut, not a behaviour, so no test pins its exact boundary; a `.txt`
  file ignored, an unreadable file skipped, and a missing or non-directory
  root rejected without printing the path.
- `empty`: a projects tree with no transcripts in the window (empty grid, exit 0),
  and a missing root (exit 1).
- `cli`: spawns `bun src/index.ts --projects <fixture>` for the grid, a named
  day, `--explain`, `--json`, every window form, a bad date and an unknown
  flag; pins the JSON output, exit codes, stderr and the JSON-in-a-pipe
  default. The rendered text of the grid, a day and `--explain` is pinned
  separately, in
  `tests/render/render.test.ts` through `report()`, because a spawned process
  never has a TTY.

Order independence: one test shuffles the fixture files' creation order and
names and asserts identical output.

The only unit test is `score.test.ts`: a table of metric rows → index, covering
each component at 0, mid and cap, the level boundaries 29/30, 59/60, 84/85, and a
no-activity bucket yielding `null`. The formula is the one place where a direct
table is more readable than a fixture.

`bun test` runs with `TZ=UTC`. Each test must fail under a one-line mutation of
the behavior it pins.

## Repository

Private GitHub repository `drakulavich/zapara`. MIT. Layout follows pult and
oura-cli: `package.json` with `bin`, `test`, `typecheck` and `check` scripts;
`tsconfig.json` strict with `noUncheckedIndexedAccess`; `README.md` with quick
start and the week picture; `CHANGELOG.md` (Keep a Changelog); `CLAUDE.md` as a
list of mistakes actually made here; `docs/superpowers/{specs,plans}`; GitHub
Actions CI with `oven-sh/setup-bun` running typecheck and tests.

## Later

Signals visible in the data but not scored in the MVP: subagent count per bucket
(`subagents/` files), prompt length (which would need a change to the privacy contract), `worktree-state`, and `agent-name` records.
Hooks would add permission decisions and model switches in real time. These wait
for the week picture to say whether the base formula is even close.
