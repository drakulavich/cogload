# Spec: a window's summary and the parts over their norm

Extends `2026-09-17-zapara-design.md` (the CLI, the index),
`2026-10-05-cogload-explain-command-design.md` and
`2026-09-18-zapara-card-design.md` (the card's `--json`). Everything not mentioned
here stays as they say. Tracks
[#252](https://github.com/drakulavich/cogload/issues/252).

## Objective

A look at one month (2026-10-24 to 2026-11-22, `cogload --days 30 --json` on
two Macs, 0.16.1 at home and 0.15.0 at work) needed a script over the JSON to
say what the month looked like. The issue names four gaps; this spec covers
two of them, items 1 and 2. Each section below closes one, lands as its own
PR, and can be approved or cut on its own; the sections keep the issue's
numbering. The other two moved to their own issues: rests taken and skipped
(item 3) to [#255](https://github.com/drakulavich/cogload/issues/255), since
no rest history exists to count yet, and the session count in the band
(item 4) to [#253](https://github.com/drakulavich/cogload/issues/253), where
the plugin holds the first prompt of a fourth session and the count explains
the hold.

1. `cogload trend`: a window in one screen, with the share of hours by level,
   one line per week and the mean index by sessions in the hour.
2. Where a part of the index is at its cap, `--explain` says how far over its
   norm the raw value is.

The numbers below come from the two saved JSON files and the issue's
`stats.ts`, recomputed by a scratch script over the same files. Every proposed
output is filled with the work Mac's numbers unless it says otherwise.

## The order of the two PRs

| PR | Section | Depends on |
|---|---|---|
| 1 | 2, the ratio in `--explain` | nothing |
| 2 | 1, `cogload trend` | nothing |

The two do not depend on each other and can land in either order. I would
land section 2 first: it is the smaller diff, one helper and wider cells in
an existing table, and it leaves every JSON shape as it is.

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
  as of 14:23, this hour is still running
```

The level names are painted as in the grid's legend; `--no-color` and `NO_COLOR`
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
`-` for a mean (the fixture in 1g has no hour with three or four sessions).

A window with no hour scored prints two lines and exits 0.
`TZ=UTC cogload trend --projects tests/fixtures/busy-week --from 2026-01-01 --to 2026-01-02`:

```
Thu 01/01 to Fri 02/01, 2 days: 0 hours with a session, 0h00 active
no activity from 2026-01-01 to 2026-01-02
```

The second line is the card's sentence (`src/cli/commands.io.ts`, `no
activity from ${from} to ${to}`), dates in `YYYY-MM-DD`; it takes the place of
every table. When the window holds today the as-of line follows it.

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
  in 1g gives 101). The level is the hour bucket's, `levelOf(score.index)`.
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

### 1d. JSON

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
  "asOf": "2026-11-22T10:23:02.257Z"
}
```

The JSON holds counts; a reader divides for the shares. `bySessions` always
holds five entries, `sessions` 1 to 5, the last meaning five or more; `mean`
is `null` for an entry with no hours. `hot` is the hours at 60 or more.
`asOf` is there when the window holds today, as on a `Day`.

The empty window of 1b prints `"hours": 0`, `"activeMin": 0`, every level at
0, one week entry of zeros, five `bySessions` entries with `"mean": null`.

### 1e. Data and cost

Nothing is stored. `trend` folds the `Day[]` that `report()` already returns
for the window, in one pure function. The 30-day report on the home Mac takes
0.15 s warm (`bun src/cli/index.ts --days 30 --json`, 378 KB of JSON that
`trend` does not print); the fold adds one pass over at most 90 × 24
buckets. The JSON above is 1.4 KB for 30 days.

### 1f. Not in this section

No chart, no comparison between two windows, no per-project split, no new
field on `Day`, no change to the grid or its JSON. `trend` does not pick the
window's weeks by the calendar. No rests (#255). No count of capped hours:
no output reproduces the issue's 130, 109 and 108 capped hours any more;
`--explain` (section 2) shows how far over each hour's parts are.

### 1g. Definition of Done

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
  Each fails on main.
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
1.1 to 1.5, 38 from 1.6 to 2.0 and 6 above 2.0. `pace` is at its cap in
109 of those hours (median 1.4, largest 2.9) and `supervision` in 108
(median 1.6, largest 3.5).

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

## Tech Stack

Bun 1.4.2+, TypeScript. No new dependencies.

## Commands

```
bun run check
```

## Project Structure

```
src/lib/metrics/score.ts      rawOf(), overOf(); fractionsOf clamps rawOf (section 2)
src/lib/metrics/trend.ts      trendOf(days): the summary, pure (section 1)
src/lib/text/render.ts        renderTrend; the --explain cells and legend
src/cli/args.ts               the trend verb, USAGE, the unknown-command hint
src/cli/commands.io.ts        trend()
tests/...                     the cases in each Definition of Done
README.md, docs/reference.md
```

`bun run check` says where a module belongs when this layout is wrong.

## Code Style

```ts
// score.ts: one unclamped step; the score clamps it, --explain reads it.
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

- Always: counts only in every new output; the index unchanged; the window
  flags and their errors as the grid has them.
- Ask first: a field on `Day`, a change to the grid's output, any file
  `trend` would write.
- Never: print a path or any text from a transcript.

## Decisions

- `trend`, the issue's name, as a verb with its own JSON, following `card`.
- Text in a pipe, JSON only with `--json`, as `card` does: the grid's
  pipe-gets-JSON rule is listed under Limits as a gap, and a summary is
  something to paste.
- A week is the grid's seven days ending at `--to`, so the last week line is
  a run of `cogload`. Calendar weeks would match the plugin's powerbank;
  they give the same numbers for any window that ends on a Sunday.
- 28 days by default: four whole weeks, no short first block.
- Both "hours with a session" and active time are printed, since the issue's
  numbers use each.
- The ratio shows in `--explain` only; the plain day view is unchanged (the
  author).
- The capped block that an earlier draft printed in `trend` was cut (the
  author): `--explain` already tells one capped hour from another.
- Rests moved to #255 and the band's session count to #253 (the author).
