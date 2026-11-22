# Spec: a window's summary, the parts over their norm, rests in the CLI and the session count in the band

Extends `2026-09-17-zapara-design.md` (the CLI, the index),
`2026-09-19-zapara-status-file-design.md`,
`2026-10-05-cogload-explain-command-design.md`,
`2026-10-04-zapara-forced-rest-design.md` and
`2026-10-29-cognitive-load-powerbank-design.md`. Everything not mentioned
here stays as they say. Tracks
[#252](https://github.com/drakulavich/cogload/issues/252).

## Objective

A look at one month (2026-10-24 to 2026-11-22, `cogload --days 30 --json` on
two Macs, 0.16.1 at home and 0.15.0 at work) needed a script over the JSON to
say what the month looked like. The issue names four gaps. Each section below
closes one, lands as its own PR, and can be approved or cut on its own; the
sections keep the issue's numbering.

1. `cogload trend`: a window in one screen, with the share of hours by level,
   one line per week and the mean index by sessions in the hour.
2. Where a part of the index is at its cap, `--explain` says how far over its
   norm the raw value is, and `trend` counts the capped hours.
3. The plugin records each rest's start and lift in a file cogload owns, and
   `trend` counts rests taken and skipped per week and the skips left.
4. The band above the prompt names the session count from the fourth session
   in the last sixty minutes.

The numbers below come from the two saved JSON files and the issue's
`stats.ts`, recomputed by a scratch script over the same files. Every proposed
output is filled with the work Mac's numbers unless it says otherwise.
Section 3 is the exception: no rest history exists yet, so its example is a
fixture.

## The order of the four PRs

| PR | Section | Depends on |
|---|---|---|
| 1 | 2, the ratio in `--explain` | nothing |
| 2 | 1, `cogload trend` | PR 1 for its capped block (1d) only; without PR 1 it lands without that block |
| 3 | 4, the session count in the band | nothing |
| 4 | 3, rests in the CLI | PR 2, whose output it extends |

PR 1 goes first because it adds the helper (`overOf`) that PR 2's capped block
reads, and it is the smallest. PR 3 can land at any point. PR 4 follows PR 2
as soon as it can: the rest history starts on the day a release carries it.
Cut section 1, and section 3 has nowhere to print and goes with it.

## 1. `cogload trend`: a window in one screen

### 1a. The command

`cogload trend [window]` is a new verb, with the window flags the grid and the
card take (`--days`, `--from`, `--to`, at most 90 days) and 28 days by
default: four whole weeks ending today. It prints text whether piped or not;
`--json` prints the JSON below, as `card --json` does. `--explain` and `--out`
are usage errors with it, through the checks that already reject them outside
a day and outside `card`. `--projects`, `--no-color`, `--no-cache` and
`--verbose` work as for the grid. An unknown command's message gains `trend`:
`(try today, yesterday, a date, card, trend or status)`.

It is a verb because the grid's JSON is `Day[]`, and a summary needs its own
shape, as the card's has. A verb with its own `--json` follows the card and
leaves the grid's output alone.

### 1b. What it prints

`cogload trend --days 30 --to 2026-11-22` on the work Mac:

```
Sat 24/10 to Sun 22/11, 30 days: 310 hours with a session, 147h20 active

level      hours  share
calm          96    31%
warming       68    22%
heating       69    22%
fried         77    25%

week from   days  hours  active  heating+  prompts
Sat 24/10      2      3    0h20         0        6
Mon 26/10      7     59   26h10        28      785
Mon 02/11      7     67   31h05        31      888
Mon 09/11      7     65   35h05        36     1000
Mon 16/11      7    116   54h40        51     1748

sessions  hours  mean index
1            50           7
2            45          20
3            25          36
4            33          55
5+          157          76

at the cap, in 146 hours at heating or above
part         hours  median   max
supervision    108    1.6×  3.5×
parallel       130    1.5×  2.5×
pace           109    1.4×  2.9×
reading         16    1.1×  1.5×
streak          86    2.2×  7.1×
  as of 14:23, this hour is still running
```

The last block is 1d; section 3 adds a block after the week table (3e). The
level names are painted as in the grid's legend; `--no-color` and `NO_COLOR`
leave them plain. Labels are the grid's (`Sat 24/10`), and active time is the
grid's `hm` (`147h20`). Every line fits the grid's 98 columns. The as-of line
is the grid's own and shows when the window holds today (the saved run was
taken at 10:23 UTC on a +04:00 clock).

On the home Mac the same window gives 238 hours with a session and 61h55
active; calm 194 (82%), warming 32 (13%), heating 12 (5%), fried 0; weeks of
4h40, 23h35, 17h35, 9h00 and 7h05 active with 2, 9, 0, 0 and 1 hours at
heating or above; and means of 10, 22, 32, 63 and 76 by sessions over 155,
40, 26, 14 and 3 hours.

The level and session tables always print all their rows, with `0` hours and
`-` for a mean (the fixture in 1h has no hour with three or four sessions).
Rows of the capped block with no hours are left out, and so is the block when
the window has no hour at heating or above.

A window with no hour scored prints two lines and exits 0.
`TZ=UTC cogload trend --projects tests/fixtures/busy-week --from 2026-01-01 --to 2026-01-02`:

```
Thu 01/01 to Fri 02/01, 2 days: 0 hours with a session, 0h00 active
no activity from 2026-01-01 to 2026-01-02
```

The second line is the card's sentence (`src/cli/commands.io.ts`, `no
activity from ${from} to ${to}`), dates in `YYYY-MM-DD`; it takes the place of
every table and block. When the window holds today the as-of line follows it.

### 1c. What each number is

- **An hour with a session** is an hour bucket with a score: at least one
  session with a record in it (`sessions > 0`). An agent working alone makes
  one. This is the denominator of the level shares: 310 on the work Mac.
- **Active** is the sum of `activeMin`: minutes you were present, as the
  grid's `active` column counts them. 147h20 on the work Mac.

  The issue uses "active hours" for both: "310 active hours" is the first,
  "active hours per week 26, 31, 35, 55" is the second (26h10, 31h05, 35h05,
  54h40, rounded). The two differ by a factor of two on this data, so the
  output names them apart and prints both.
- **Share** is `Math.round(100 × hours at the level / hours with a session)`,
  each rounded on its own, so the four can add up to 99 or 101 (the fixture
  in 1h gives 101). The level is the hour bucket's, `levelOf(score.index)`.
- **A week** is the grid's: seven days ending on the window's last day,
  counted back from `--to`, the first block shorter when the window is not a
  multiple of seven. `cogload` with no flags shows the last of them, so the
  last week line can be checked against the grid's totals line (its active
  time and prompts).

  `stats.ts` counts calendar weeks from Monday instead, as the plugin's
  powerbank does. For the issue's window, which ends on a Sunday, the two give
  the same five weeks and the same numbers. They part on any other last day:
  with the window ending Friday 2026-11-20, the grid's last week is
  2026-11-14 to 20, 7 days, and the calendar week is 2026-11-16 to 20, 5
  days, with 86 and 85 hours with a session. The grid's reading is chosen so
  that a week line is a run of `cogload --to <day>`.
- **heating+** is the hours of that week whose index is 60 or more, Heating
  and Fried together.
- **prompts** is the sum of `totals.prompts` over the week's days.
- **Mean index by sessions** groups the hours with a session by
  `min(sessions, 5)` and takes the mean of their hour index, rounded with
  `Math.round` as `Day.mean` is. `5+` is where `parallel` reaches its cap
  (`(sessions − 1) / NORMS.parallelSpan = 1`), so the last row holds every
  hour the parallel part cannot tell apart. These are the hour buckets'
  sessions and index, not the live sixty minutes.

With these definitions the output reproduces every number of the issue that
`stats.ts` printed: the shares 31/22/22/25 over 310 hours, the weekly active
time and prompts, the hours at heating or above per week (28, 31, 36, 51),
and the means 7, 20, 36, 55, 76 (home: 10, 22, 32, 63, 76).

### 1d. The capped block (needs section 2)

Over the window's hours at heating or above, one row per part that is at its
cap in at least one of them: how many hours, the median of section 2's
ratio, and its largest value. The median is taken over the raw ratios, as
`overOf` returns them; for an even count it is the mean of the two middle raw
values. Only then is it rounded, once, with `Math.round(x * 10) / 10`, the
rounding `score.ts` uses for parts. The largest value is rounded the same
way. Rows go heaviest weight first, as `capped` orders them; `late` is left
out, since it has no ratio.

The order matters: two hours at heating or above whose pace ratios are 21/20
and 23/20 give a median of 1.10 and print `1.1×`; rounding each ratio first
(1.1 and 1.2) would print `1.2×`. The test in 1h pins it.

This is where the issue's 130, 109 and 108 come from, now with how far over:
the 130 parallel hours had 5 to 11 sessions (22 at exactly 5, 39 at 6, 25 at
7, 28 at 8, 10 at 9, 3 at 10, 3 at 11).

Cut section 2, and this block goes with it.

### 1e. JSON

`cogload trend --days 30 --to 2026-11-22 --json` on the work Mac, complete:

```json
{
  "from": "2026-10-24",
  "to": "2026-11-22",
  "days": 30,
  "hours": 310,
  "activeMin": 8840,
  "levels": { "Calm": 96, "Warming": 68, "Heating": 69, "Fried": 77 },
  "weeks": [
    { "from": "2026-10-24", "to": "2026-10-25", "days": 2, "hours": 3, "activeMin": 20, "hot": 0, "prompts": 6 },
    { "from": "2026-10-26", "to": "2026-11-01", "days": 7, "hours": 59, "activeMin": 1570, "hot": 28, "prompts": 785 },
    { "from": "2026-11-02", "to": "2026-11-08", "days": 7, "hours": 67, "activeMin": 1865, "hot": 31, "prompts": 888 },
    { "from": "2026-11-09", "to": "2026-11-15", "days": 7, "hours": 65, "activeMin": 2105, "hot": 36, "prompts": 1000 },
    { "from": "2026-11-16", "to": "2026-11-22", "days": 7, "hours": 116, "activeMin": 3280, "hot": 51, "prompts": 1748 }
  ],
  "bySessions": [
    { "sessions": 1, "hours": 50, "mean": 7 },
    { "sessions": 2, "hours": 45, "mean": 20 },
    { "sessions": 3, "hours": 25, "mean": 36 },
    { "sessions": 4, "hours": 33, "mean": 55 },
    { "sessions": 5, "hours": 157, "mean": 76 }
  ],
  "capped": [
    { "part": "supervision", "hours": 108, "median": 1.6, "max": 3.5 },
    { "part": "parallel", "hours": 130, "median": 1.5, "max": 2.5 },
    { "part": "pace", "hours": 109, "median": 1.4, "max": 2.9 },
    { "part": "reading", "hours": 16, "median": 1.1, "max": 1.5 },
    { "part": "streak", "hours": 86, "median": 2.2, "max": 7.1 }
  ],
  "asOf": "2026-11-22T10:23:02.257Z"
}
```

The JSON holds counts; a reader divides for the shares. `bySessions` always
holds five entries, `sessions` 1 to 5, the last meaning five or more; `mean`
is `null` for an entry with no hours. `hot` is the hours at 60 or more.
`capped` is 1d's and lists only parts with hours: `[]` in a window with no
hour at heating or above, and absent without section 2. `asOf` is there when
the window holds today, as on a `Day`. Section 3 adds `rests` to each week and
two top-level keys (3e).

The empty window of 1b prints `"hours": 0`, `"activeMin": 0`, every level at
0, one week entry of zeros, five `bySessions` entries with `"mean": null` and
`"capped": []`.

### 1f. Data and cost

Nothing is stored. `trend` folds the `Day[]` that `report()` already returns
for the window, in one pure function. The 30-day report on the home Mac takes
0.15 s warm (`bun src/cli/index.ts --days 30 --json`, 378 KB of JSON that
`trend` does not print); the fold adds one pass over at most 90 × 24
buckets. The JSON above is 1.9 KB for 30 days.

### 1g. Not in this section

No chart, no comparison between two windows, no per-project split, no new
field on `Day`, no change to the grid or its JSON. `trend` does not pick the
window's weeks by the calendar. Rests are section 3.

### 1h. Definition of Done

- `TZ=UTC bun src/cli/index.ts trend --projects tests/fixtures/busy-week --days 7 --to 2026-09-20 --no-color`
  prints, as its first blocks:

  ```
  Mon 14/09 to Sun 20/09, 7 days: 22 hours with a session, 21h10 active

  level      hours  share
  calm          15    68%
  warming        3    14%
  heating        1     5%
  fried          3    14%

  week from   days  hours  active  heating+  prompts
  Mon 14/09      7     22   21h10         4      323

  sessions  hours  mean index
  1            15          17
  2             3          33
  3             0           -
  4             0           -
  5+            4          86
  ```

  Today it exits 2 with
  `cogload: unknown command trend (try today, yesterday, a date, card or status)`.
- `TZ=UTC bun src/cli/index.ts trend --projects tests/fixtures/busy-week --days 7 --to 2026-09-20 --json > out; jq -c '[.hours, .activeMin, .levels, (.bySessions | length), .bySessions[2].mean]' out`
  prints `[22,1270,{"Calm":15,"Warming":3,"Heating":1,"Fried":3},5,null]`.
  Today the run exits 2, `out` is empty, and jq prints nothing.
- `TZ=UTC bun src/cli/index.ts trend --projects tests/fixtures/busy-week --from 2026-01-01 --to 2026-01-02 --no-color`
  prints exactly the two lines of 1b and exits 0. Today it exits 2 with the
  unknown-command line.
- `bun src/cli/index.ts --help > out; grep -c 'cogload trend' out` prints 1.
  Today it prints 0 and grep exits 1.
- CLI tests through fixtures pin each line above, a window of 9 days (a short
  first week of 2 days), the empty window's text and JSON, `--explain` and
  `--out` rejected with `trend`, and `--json` in a pipe and in a terminal.
  A fixture of two hours at heating or above with 21 and 23 prompts and pace
  at its cap pins the capped row `pace             2    1.1×  1.2×`; it fails
  with the ratios rounded before the median. Each test fails on main.
- On the work Mac, `cogload trend --days 30 --to 2026-11-22 --json` and
  `stats.ts` over `cogload --days 30 --to 2026-11-22 --json` taken in the
  same minute agree on every number in 1c. For the author to run; not run
  here.
- README's command table, `docs/reference.md` (Usage, the commands table, the
  pipe paragraph) and `--help` name `trend`.

## 2. How far a capped part is over its norm

### 2a. Which parts can exceed their norm

Each part is a raw value divided by its norm and clamped to `[0, 1]`
(`fractionsOf` in `src/lib/metrics/score.ts`). Five of the six have a raw
value that can pass the norm. The ratio is that value before the clamp:

| Part | Ratio | Work Mac, 2026-11-02 13:00 |
|---|---|---|
| parallel | `(sessions − 1) / 4` | (11 − 1) / 4 = 2.5 |
| pace | `prompts / 20` | 34 / 20 = 1.7 |
| supervision | `(3 × decisions + reports + contextSwitches) / 45` | (12 + 36 + 27) / 45 = 1.67 |
| reading | `outputTokens / 80 000` | 59 785 / 80 000 = 0.75, not capped |
| streak | `streakMin / 40` | 39 / 40 = 0.98, not capped |

`late` is a flag, 0 or 1. `capped` lists it in a late hour (the fixture's
23:00 has `capped: ["streak", "late"]`), but it has no raw value to be over
anything, so it never gets a ratio.

The JSON already carries every raw value needed, per hour: `sessions`,
`prompts`, `reports`, `decisions`, `contextSwitches`, `outputTokens`,
`streakMin`, and `score.capped`. A script can compute the ratio today, which
is how this spec got its numbers. The JSON does not change in this section.

### 2b. What `--explain` prints

With `--explain`, the five part columns `par`, `pace`, `sup`, `read` and
`strk` are 10 characters wide, right-aligned, header included; `late` stays 6.
A cell of a part whose ratio is 1 or more holds its points, one space, the
ratio rounded with `Math.round(x * 10) / 10` and printed with one decimal,
and `×`: `25 2.5×`. Every other cell holds its points as today. Ten
characters keep at least two spaces before a cell up to `10 99.9×`.

When any cell of the table holds a ratio, one dim line follows the rows,
after the `no … today` line and before the as-of line:

```
  N× beside a part: it is at its cap, with N times what fills it
```

The fixture's day, `TZ=UTC bun src/cli/index.ts 2026-09-14 --projects tests/fixtures/busy-week --explain --no-color`
in a terminal, header and 12:00 row:

```
hour   index  level    sess  prompts  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok       par      pace       sup      read      strk  late
12:00     87  Fried       5       55    20    1      1     1     2      54    235m    55.0k   25 1.0×   15 2.8×   30 2.9×       6.9   10 5.9×     0
```

Today the same row ends `55.0k   25    15    30   6.9    10     0`. Its 23:00
row ends `0.1   10 1.3×    10`: the late cell has no ratio.

The work Mac's 2026-11-02 13:00 row (`cogload 2026-11-02 --explain`), with the
columns that day shows:

```
hour   index  level    sess  prompts  rep  quest  mode  ctx-sw  streak  out-tok       par      pace       sup      read      strk  late
13:00     87  Fried      11       34   36      4     0      27     39m    59.8k   25 2.5×   15 1.7×   30 1.7×       7.5       9.8     0
```

An hour with five sessions prints `25 1.0×` in the same column, where today
both print `25`.

The index, the level, `parts`, `capped` and `top` do not change: the ratio
comes from the same unclamped values the score clamps (Code Style), and
nothing reads it back into the score.

The plain day view, without `--explain`, is unchanged (the author's call).
It prints the raw counts the ratio is made from and no parts.

### 2c. The number behind it

Of the work Mac's 146 hours at heating or above, `parallel` is at its cap in
130, which today all print `25`. Their ratios: 22 at exactly 1.0, 64 from
1.1 to 1.5, 38 from 1.6 to 2.0 and 6 above 2.0. The medians and largest
values of every part are in 1b's capped block.

### 2d. Data and cost

Nothing stored, no JSON change. One unclamped step shared with the score, and
wider cells in one table.

### 2e. Not in this section

No change to the index, the norms or the weights; no recalibration. No new
JSON field. No mark in the plain day view. No change to `/cogload`, which
already names the counts of a capped part (`at the cap: 16 decisions and 13
context switches`).

### 2f. Definition of Done

- `script -q out env TZ=UTC bun src/cli/index.ts 2026-09-14 --projects tests/fixtures/busy-week --explain --no-color; grep -cF '   25 1.0×   15 2.8×   30 2.9×       6.9   10 5.9×     0' out`
  prints 1, and `grep -c 'N× beside a part' out` prints 1. Today both print
  0 and grep exits 1. `script` gives the run a terminal: in a pipe the day
  prints JSON.
- A render test through the fixture pins the header and the 12:00 and 23:00
  rows above character for character, and the legend line. Each fails on
  main; the 23:00 case fails with the `late` exclusion removed.
- A score test pins that the parts `overOf` returns are the parts in
  `capped`, `late` aside, for every hour of the fixture.
- The existing score and `--json` tests pass unchanged, so the index and the
  JSON are as before.
- `docs/reference.md` (the `--explain` row and "How the index works") says
  what `N×` means.

## 3. Rests taken and skipped in the CLI

### 3a. What the plugin keeps today

The plugin keeps three things about rests, in its store (`$.store`), which
is Claude Code's, not cogload's:

| Key | What | How long |
|---|---|---|
| `rests` | the start of each rest, in ms | trimmed to the last 7 days when a rest starts |
| `overrides` | `{ at, reason }` for each skip; `reason` is text typed by the person | trimmed to the current calendar week when a skip is written; older entries stay until the next skip |
| `queueSends` | the time of each queued prompt sent at a rest's end | 7 days |

Nothing records whether a rest ran its ten minutes. `/cogload` derives
"taken" as this week's rests minus the skips that came after one of them.

On the home Mac the store is
`~/.claude/plugins/store/cognitive-load_cogload-<hash>.json`, 0600, 974 bytes
of JSON. For the issue's 30 days it held the rests since 2026-11-17 (4 of
them) and no skip: the 12 in `overrides` are from 2026-10-05 to 2026-10-10.
The work Mac's store was not read; its trims are the same, so it holds 7 days
of rests at most. The file name, its hash and its format are Claude Code's.
The transcripts hold no rests either: a held prompt is dropped before it
reaches the transcript, and a rest leaves only a gap.

So no past window can be answered. This section records from now on, in a
file cogload owns, and `trend` reads only that file. The store is not read
from the CLI and does not change.

### 3b. What the plugin records

The plugin runs two new commands, through the `run()` it already uses for
`cogload status` (the `PATH` first, then `~/.bun/bin/cogload`):

- `cogload rest start --at <instant>` when a rest starts: in
  `startRestIfDue`, after it writes `rests`, with `<instant>` the rest's
  start, `new Date(now).toISOString()`, the same `now` it stores.
- `cogload rest lift --at <instant>` when a skip lifts a rest: in the
  `prompt.submit` branch that writes `overrides`, a typed or Remote Control
  skip alike, with the skip's time.

A skip that lifts nothing (a short reason, an empty powerbank) runs nothing.
Neither call is awaited by the hook, so a prompt and a rest never wait on
it. A failure goes to the debug log as `refresh` logs one (`not found`,
`exit <code>`, `timeout`) and changes nothing else.

### 3c. The file

`cogload rest` appends one line to `~/.claude/cogload/rests.jsonl`, the
directory `status.json` lives in, created 0700 and the file 0600 as the
status file is. `HOME` comes from the environment, as for the status file. A
line is one JSON object with two keys:

```
{"at":"2026-11-12T08:00:00.000Z","event":"start"}
{"at":"2026-11-16T10:04:00.000Z","event":"lift"}
{"at":"2026-11-16T10:00:00.000Z","event":"start"}
{"at":"2026-11-18T15:00:00.000Z","event":"start"}
{"at":"2026-11-18T15:00:02.310Z","event":"start"}
{"at":"2026-11-20T11:00:00.000Z","event":"start"}
```

- `at` is an ISO 8601 UTC instant; `event` is `start` or `lift`.
- The file is only ever appended to: opened with `O_APPEND`, one `write` per
  line, so two sessions writing at once do not interleave. Nothing rewrites,
  trims or renames it, so no append can be lost to a rewrite. The first
  command creates it; two first commands at once both append to the one
  file.
- Line order carries no meaning. The plugin's calls are not awaited, so a
  `lift` can land before the `start` it lifts, as on lines 2 and 3 above.
  The reader sorts by `at` (3d).
- `--at` must match the plugin's `ISO_INSTANT` and be at most 60 seconds
  ahead of the clock, else usage error `--at must be an ISO 8601 instant`,
  exit 2; the value is not echoed. `start` or `lift` is required, else
  `rest needs start or lift`. A failed write exits 1 with
  `cannot write the rest log`, with no path. Success prints nothing.
- The reader skips a line that does not parse or whose `at` or `event` is
  not one of the above, as the transcript parser skips a malformed line.

Size: 50 bytes a line with its newline. A rest taken is one line, a skipped
one two. The work Mac had 93 hours with a streak of 40 minutes or more in the
30 days, and 77 Fried hours; a rest starts at most once per streak and, for
Fried, at most once an hour, so the month held at most about 170 rests. That
is under 17 KB a month: at most about 200 KB after one year and 1 MB after
five, upper bounds from hour counts. The file is never trimmed. `trend`
reads it whole once a run and keeps the lines inside its window; parsing
1 MB of JSON lines is a few milliseconds next to the 0.15 s report.

Privacy: a line holds a time and one of two words. No reason, prompt,
session id or path is written or printed, so the rule in `CLAUDE.md` holds as
written and needs no new exception. The skip's reason stays where it is, in
the plugin's store. The Privacy paragraph of `docs/reference.md` adds the
file to the ones cogload writes.

New format, new name: this is a new file with a name of its own, and no store
key is added or changes type. A later change to the line's meaning goes to a
new file name.

### 3d. What the records mean

The reader sorts every valid line by `at`; at the same instant a `start`
sorts before a `lift`. Then:

- **A rest** is a `start`, except that a `start` less than 10 minutes
  (`restMin`) after the previous one is the same rest. Two sessions that read
  the same due rest at once each start it, milliseconds apart (lines 4 and 5
  above); a genuine second rest cannot start within ten minutes of the first,
  since a rest lasts ten minutes and a lifted one is not started again for
  that streak. A rest's time is its first `start`, and it belongs to the
  `trend` week whose days hold that time's local date.
- **Skipped**: a rest with at least one `lift` at or after its time and
  before the next rest's time.
- **Taken**: a rest with no such `lift`, a rest still running included, as
  `/cogload` counts it today.
- **A `lift` with no rest before it** (its `start` never reached the file)
  makes nothing skipped, and still counts toward the skips left.
- **Skips left** is `5 − lift lines with at since Monday 00:00 local time of
  the current calendar week`, never below 0: the powerbank's week and limit.
  Every `lift` line counts, as every skip the plugin records in `overrides`
  counts.
- **Recorded**: the file is complete from its earliest `at` on. A week is
  recorded when that instant is at or before local 00:00 of its first day;
  the current calendar week, when it is at or before its Monday 00:00. A
  week that is not recorded says `not recorded`, never 0, and so does a
  window with no file or no valid line.

With the six lines of 3c: the earliest `at` is 2026-11-12 08:00 UTC; the
rests are 11-12 (taken), 11-16 10:00 (skipped by the 10:04 lift), 11-18 15:00
(two starts, one rest, taken) and 11-20 (taken).

### 3e. Where the CLI prints them

`trend` prints one block after the week table, one row per week with the
same labels, and one line for the skips left when the window holds today.
With the six lines of 3c as the file and activity on each day, `TZ=UTC
cogload trend --days 30 --to 2026-11-22` run on 2026-11-22 prints:

```
rests from  taken  skipped
Sat 24/10   not recorded
Mon 26/10   not recorded
Mon 02/11   not recorded
Mon 09/11   not recorded
Mon 16/11       2        1
skips left until Monday: 4 of 5
```

The week of Mon 09/11 is not recorded because recording began on its fourth
day. The skips line reads `skips left until Monday: not recorded` when the
current calendar week is not recorded, and is left out when the window does
not hold today. An empty window prints neither (1b).

In the JSON each week gains `"rests": { "taken": 2, "skipped": 1 }`, or
`"rests": null` when it is not recorded. The top level gains
`"restsSince": "2026-11-12T08:00:00.000Z"`, the earliest `at`, `null` with no
file, and, only when the window holds today, `"skipsLeft": 4`, `null` when
the week is not recorded.

### 3f. What the log misses, and when

Walked as two sessions acting at the same moment, and the cases that leave
no line:

| Case | What the log holds | What `trend` prints |
|---|---|---|
| Two sessions start the same due rest | two `start` lines milliseconds apart, in either order | one rest (3d) |
| A start and its lift, appended out of order | both lines, the `lift` first | sorted by `at`: one skipped rest |
| A start and a lift at the same millisecond | both lines | the `start` sorts first: one skipped rest |
| The first two writes ever, at once | two lines in one new file | as any two lines; the earliest `at` is where recording starts |
| Claude Code quits during a rest | the `start` line only; a rest has no end record | taken, as `/cogload` counts it |
| Claude Code quits before `cogload rest start` writes | nothing for that rest | the rest is missing from its week |
| `cogload rest` not found, timed out or failing | nothing; the plugin logs the reason to debug | the rest, or its lift, is missing |
| A session started before the update starts a rest | nothing: the old code writes only the store | the rest is missing from its week |
| A session started before the update lifts a rest | the `start` only | that rest counts as taken, and the skips left are one too many |

The last two last until every session started before the update has ended:
an updated session appends, an old one does not, and the file cannot tell a
week with an old session in it from a quiet one. Until then `trend` prints
the counts as the log holds them, which can be low: fewer rests, fewer
skipped, more skips left than the band shows. The CHANGELOG line asks to
restart every session after the update. The plugin store is not read to fill
the gap.

### 3g. Not in this section

No reader of the plugin store from the CLI, and no change to the store. No
estimate of rests before the file began, and no backfill. No trim or rewrite
of the file. No change to `/cogload`'s week line, the powerbank or the rest.
No record of a rest's end: a rest without a lift ran its ten minutes. The
days between the update and the first rest show `not recorded`, since the
file starts with that rest.

### 3h. Definition of Done

- `H=$(mktemp -d); HOME=$H bun src/cli/index.ts rest start --at 2026-11-22T10:00:00.000Z; echo $?; cat $H/.claude/cogload/rests.jsonl`
  prints `0`, then `{"at":"2026-11-22T10:00:00.000Z","event":"start"}`.
  Today it exits 2 with `cogload: unknown flag --at` and writes no file.
- `HOME=$(mktemp -d) bun src/cli/index.ts rest start --at yesterday`
  exits 2 with `cogload: --at must be an ISO 8601 instant`. Today it exits 2
  with `cogload: unknown flag --at`.
- CLI tests, each from a `rests.jsonl` fixture the test writes, each failing
  on main:
  1. `rest lift` after `rest start` leaves the file as before plus one line.
  2. A file whose lines are 200 days old gets one appended line and keeps
     every old byte; `trend` over the last 30 days does not count them.
  3. The 3e block and its JSON from the six 3c lines, shifted to the run's
     own week so the window holds today.
  4. A `lift` line written before its `start` line, with a later `at` →
     1 skipped.
  5. A `start` and a `lift` with the same `at` → 1 skipped.
  6. Two `start` lines 2 s apart, in reverse order → 1 rest; two 11 minutes
     apart → 2 rests.
  7. A `lift` with no `start` before it → 0 skipped, and one skip fewer left.
  8. A line that does not parse, and one with `"event":"since"`, are skipped.
  9. No file, and a file of only invalid lines → `not recorded` for every
     week and `"restsSince": null`.
- Plugin cases under `claude plugin test plugin`: a rest that starts runs
  `["cogload", "rest", "start", "--at", <its start>]` once; a skip of three
  words during a rest runs `["cogload", "rest", "lift", "--at", <now>]` once;
  a short reason and an empty powerbank run no `rest`; a `rest` that exits 2
  logs `exit 2` to debug and the rest runs on. The first two fail on main.
  Not run: the cases do not exist yet.
- Not testable, with the reason: two processes appending at the same instant
  (`O_APPEND` keeps whole lines on a local file system; a test of the race
  would pass or fail by timing); a session on the old plugin code beside an
  updated one (`claude plugin test` runs one version of the plugin); Claude
  Code quitting between a rest's start and the write (the engine's fake has
  no process that outlives the hook). Their outcomes are the rows of 3f.
- `docs/reference.md` (Privacy, the commands table, `trend`) and
  `plugin/README.md` name the file and what it holds, and that it is never
  trimmed; `--help` lists `cogload rest start|lift --at <instant>` as the
  plugin's.

## 4. The session count in the band

### 4a. Which count

"When the fourth session opens" can mean sessions in the last sixty minutes
or sessions open now, and only the first is in the data:

- **Sessions in the last sixty minutes, as the index counts them.** The live
  bucket's `sessions`: distinct session ids with a record in
  `(asOf − 60 min, asOf]`. The status file's `index` already scores it; the
  band's level comes from it.
- **Sessions open now.** cogload reads transcripts; an open session that has
  written nothing in an hour leaves no trace, and the plugin's engine gives
  no list of other sessions. Not available.

The band uses the first. A session closed half an hour ago still counts for
the next thirty minutes; one idle for over an hour does not count until it
writes again. A new session counts from its first record, which Claude Code
writes with its first message, and the band shows it at the next refresh: the
end of a turn or the next minute.

"The status line" also has two readings. cogload draws one line itself, the
plugin's band above the prompt; a Claude Code status line is the person's own
script reading `status.json`. This section changes the band and adds the
count to the file, so a status line script can show it too.

### 4b. Where the count comes from

`cogload status` writes a twelfth field, `sessions`, after `restMin`: the
live bucket's `sessions`, `0` when there is none. The status-file spec allows
it: adding a field does not bump `schema`. The line grows by 13 bytes for a
count under 10 (196 bytes today on the home Mac).

The plugin reads `sessions` when it is a non-negative integer and treats an
absent or invalid one as unknown: an older cogload's line still decodes, the
band shows no count, and no `olderShown` toast is raised for it. The store
key `reading` keeps its type, an object; a reading saved by a session started
before the update has no `sessions`, and the band shows no count until that
session's own next refresh.

### 4c. The text

From 4 sessions (the author's call), and when the band is 50 columns or
wider, the band names the count right after the level:

```
● Warming · 4 sessions · rest at 14:52
● Heating · 6 sessions · streak 25m
● Fried · 11 sessions
```

Under 50 columns, and while a rest runs, the band stays as it is today: the
rest's countdown and skips left keep the line. Below 4 sessions nothing
changes. The threshold is a constant in `plugin/hooks/register.ts`,
`SESSIONS_NAMED = 4`.

### 4d. The number behind it

Mean index of an hour on the work Mac: 7 with one session, 20 with two, 36
with three, 55 with four, 76 with five or more; all 77 Fried hours had five
or more. Home: 10, 22, 32, 63, 76. Four is where the mean index first passes
the middle of Warming on both Macs.

The count shows often at work: 190 of the 310 hours with a session had four
or more, on 22 of 25 active days. At home 17 of 238 hours, on 6 days.

### 4e. Not in this section

No toast, no rest and no colour change at four sessions. No count while a
rest runs or under 50 columns. No change to the index.

### 4f. Definition of Done

- `HOME=$(mktemp -d) bun src/cli/index.ts status --projects tests/fixtures/busy-week > out; grep -c '"restMin":10,"sessions":0}' out`
  prints 1. Today it prints 0 and grep exits 1: the line ends
  `"restMin":10}`.
- A status test with a fixture of four sessions in the last sixty minutes
  pins `"sessions":4` as the twelfth field. Fails on main.
- Plugin cases under `claude plugin test plugin`, through `ui.render` with a
  stored reading of level `Warming`, `restAt` at local 14:52 and `asOf`
  before it: `sessions: 4` at 60 columns renders
  `● Warming · 4 sessions · rest at 14:52`; `sessions: 3` renders
  `● Warming · rest at 14:52`; `sessions: 6` at 14:53 with a rest until 15:00 and no
  skip this week renders `● Warming · rest until 15:00 (7 min) · 5 skips left`;
  `sessions: 6` at 40 columns renders `● Warming · rest at 14:52`; a reading without `sessions` renders no count and
  raises no `olderShown`. The first fails on main. Not run: the cases do not
  exist yet.
- The status-file spec's field table, `docs/reference.md` ("eleven values"
  becomes twelve, in the status row and in Privacy),
  `docs/how-the-numbers-are-made.md` section 7, and `plugin/README.md` name
  `sessions` and the band's count.

## Tech Stack

Bun 1.4.2+, TypeScript, the Claude Code plugin engine for sections 3 and 4.
No new dependencies.

## Commands

```
bun run check
claude plugin test plugin
```

## Project Structure

```
src/lib/metrics/score.ts      rawOf(), overOf(); fractionsOf clamps rawOf (section 2)
src/lib/metrics/trend.ts      trendOf(days, rests): the summary, pure (sections 1, 3)
src/lib/text/render.ts        renderTrend; the --explain cells and legend
src/cli/args.ts               the trend and rest verbs, --at, USAGE, the unknown-command hint
src/cli/commands.io.ts        trend(), rest()
src/lib/rests/restlog.io.ts   the only module that reads and writes rests.jsonl (section 3)
src/lib/status/status.ts      the twelfth field, sessions (section 4)
plugin/hooks/register.ts      the two rest calls; decode sessions; the band's count
plugin/types/index.d.ts       sessions?: number on Status
tests/...                     the cases in each Definition of Done
README.md, docs/reference.md, docs/how-the-numbers-are-made.md, plugin/README.md,
docs/superpowers/specs/2026-09-19-zapara-status-file-design.md
```

`bun run check` says where a module belongs when this layout is wrong.

## Code Style

```ts
// score.ts: one unclamped step; the score clamps it, --explain and trend read it.
export function rawOf(m: Metrics): Record<Exclude<Part, "late">, number> {
  return {
    parallel: (m.sessions - 1) / NORMS.parallelSpan,
    pace: m.prompts / NORMS.pacePerHour,
    supervision: (NORMS.decisionWeight * m.decisions + m.reports + m.contextSwitches) / NORMS.supervisionPerHour,
    reading: m.outputTokens / NORMS.readingTokens,
    streak: m.streakMin / NORMS.streakMin,
  };
}

export function fractionsOf(m: Metrics): Fractions {
  const r = rawOf(m);
  return {
    parallel: clamp01(r.parallel),
    pace: clamp01(r.pace),
    supervision: clamp01(r.supervision),
    reading: clamp01(r.reading),
    streak: clamp01(r.streak),
    late: m.lateNight ? 1 : 0,
  };
}

// The ratio for each part at its cap; late has none.
export const overOf = (m: Metrics): Partial<Record<Exclude<Part, "late">, number>> =>
  Object.fromEntries(Object.entries(rawOf(m)).filter(([, x]) => x >= 1));
```

## Boundaries

- Always: counts and times only in every new output and file; the index
  unchanged; the window flags and their errors as the grid has them.
- Ask first: a field on `Day`, a change to the grid's output, any read of
  the plugin store from the CLI, any other new file under `~/.claude/cogload/`.
- Never: print or write a skip's reason from the CLI; print 0 for a week
  that was not recorded.

## Decisions

- `trend`, the issue's name, as a verb with its own JSON, following `card`.
- Text in a pipe, JSON only with `--json`, as `card` does: the grid's
  pipe-gets-JSON rule is listed under Limits as a gap, and a summary is
  something to paste.
- A week is the grid's seven days ending at `--to`, so the last week line is
  a run of `cogload`. Calendar weeks would match the plugin's powerbank;
  they give the same numbers for any window that ends on a Sunday. Skips left
  keep the powerbank's calendar week, since that is the week the limit uses.
- 28 days by default: four whole weeks, no short first block.
- Both "hours with a session" and active time are printed, since the issue's
  numbers use each.
- The capped median is taken over raw ratios and rounded once, as the index
  is rounded once from raw points.
- The ratio shows in `--explain` only; the plain day view is unchanged (the
  author).
- Rests are recorded by the plugin through `cogload rest` into
  `rests.jsonl`, times only, appended and never trimmed (the author, option
  B of the first draft; the first design's 90-day rewrite could lose an
  append). Reading the plugin store from the CLI, a longer store key shown in
  `/cogload`, and counting rests due from transcripts were set aside: the
  first reads Claude Code's private file, the second keeps the answer out of
  the CLI, the third cannot tell taken from skipped.
- The session count shows from four sessions (the author), and comes from
  the status file, the one reading the plugin already takes every minute,
  rather than a second `cogload today --json` run.
