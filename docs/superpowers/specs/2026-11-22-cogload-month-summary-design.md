# Spec: a window's summary, the parts over their norm, rests in the CLI and the session count in the band

Extends `2026-09-17-zapara-design.md` (the CLI, the index),
`2026-09-19-zapara-status-file-design.md`,
`2026-10-05-cogload-explain-command-design.md` and
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
3. Rests taken and skipped over a window in the CLI. The plugin does not keep
   that history, so this section states what exists and leaves the choice to
   the author.
4. The band above the prompt names the session count from the fourth session
   in the last sixty minutes.

The numbers below come from the two saved JSON files and the issue's
`stats.ts`, recomputed by a scratch script over the same files. Every proposed
output is filled with the work Mac's numbers unless it says otherwise.

## The order of the four PRs

| PR | Section | Depends on |
|---|---|---|
| 1 | 2, the ratio in `--explain` | nothing |
| 2 | 1, `cogload trend` | PR 1 for its capped block (1d) only; without PR 1 it lands without that block |
| 3 | 4, the session count in the band | nothing; independent of PRs 1 and 2 |
| 4 | 3, rests in the CLI | the author's answer to the open question; with option B, also PR 2 |

PR 1 goes first because it adds the one helper (`overOf`) that PR 2's capped
block reads, and it is the smallest. PR 3 can land at any point. PR 4 waits.

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

It is a verb because the grid's JSON is `Day[]`, and a
summary needs its own shape, as the card's has. A verb with its own `--json`
follows the card and leaves the grid's output alone.

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
part         hours  median  max
supervision    108    1.6×  3.5×
parallel       130    1.5×  2.5×
pace           109    1.4×  2.9×
reading         16    1.1×  1.5×
streak          86    2.2×  7.1×
  as of 14:23, this hour is still running
```

The last block is 1d. The level names are painted as in the grid's legend;
`--no-color` and `NO_COLOR` leave them plain. Labels are the grid's
(`Sat 24/10`), and active time is the grid's `hm` (`147h20`). Every line fits
the grid's 98 columns. The as-of line is the grid's own and shows when the
window holds today (the saved run was taken at 10:23 UTC on a +04:00 clock).

On the home Mac the same window gives 238 hours with a session and 61h55
active; calm 194 (82%), warming 32 (13%), heating 12 (5%), fried 0; weeks of
4h40, 23h35, 17h35, 9h00 and 7h05 active with 2, 9, 0, 0 and 1 hours at
heating or above; and means of 10, 22, 32, 63 and 76 by sessions over 155,
40, 26, 14 and 3 hours.

A window with no hour scored prints the first line with `0 hours with a
session, 0h00 active` and `no activity from <from> to <to>`, and exits 0, as
the grid does for an empty window. The level and session tables keep all
their rows, with `0` hours and `-` for a mean, so two windows line up. Rows
of the capped block with no hours are left out, and so is the block when the
window has no hour at heating or above.

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
- **Share** is `round(100 × hours at the level / hours with a session)`, each
  rounded on its own, so the four can add up to 99 or 101 (the fixture below
  gives 101). The level is the hour bucket's, `levelOf(score.index)`.
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
  that a week line is a run of `cogload --to <day>`; see Decisions.
- **heating+** is the hours of that week whose index is 60 or more, Heating
  and Fried together.
- **prompts** is the sum of `totals.prompts` over the week's days.
- **Mean index by sessions** groups the hours with a session by
  `min(sessions, 5)` and takes the mean of their hour index, rounded as
  `Day.mean` is. `5+` is where `parallel` reaches its cap
  (`(sessions − 1) / NORMS.parallelSpan = 1`), so the last row holds every
  hour the parallel part cannot tell apart. These are the hour buckets'
  sessions and index, not the live sixty minutes.

With these definitions the output reproduces every number of the issue that
`stats.ts` printed: the shares 31/22/22/25 over 310 hours, the weekly active
time and prompts, the hours at heating or above per week (28, 31, 36, 51),
and the means 7, 20, 36, 55, 76 (home: 10, 22, 32, 63, 76).

### 1d. The capped block (needs section 2)

Over the window's hours at heating or above, one row per part that is at its
cap in at least one of them: how many hours, and the median and the largest
of section 2's ratio, each rounded to one decimal. The median of an even
count is the mean of the two middle values. Rows go heaviest weight first,
as `capped` orders them; `late` is left out, since it has no ratio. This is
where the issue's 130, 109 and 108 come from, now with how far over: the 130
parallel hours had 5 to 11 sessions (22 at exactly 5, 39 at 6, 25 at 7, 28 at
8, 10 at 9, 3 at 10, 3 at 11).

Cut section 2, and this block goes with it.

### 1e. JSON

`cogload trend --days 30 --to 2026-11-22 --json`, work Mac, with the week
list shortened:

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
    { "from": "2026-11-16", "to": "2026-11-22", "days": 7, "hours": 116, "activeMin": 3280, "hot": 51, "prompts": 1748 }
  ],
  "bySessions": [
    { "sessions": 1, "hours": 50, "mean": 7 },
    { "sessions": 5, "hours": 157, "mean": 76 }
  ],
  "capped": [
    { "part": "supervision", "hours": 108, "median": 1.6, "max": 3.5 },
    { "part": "parallel", "hours": 130, "median": 1.5, "max": 2.5 }
  ],
  "asOf": "2026-11-22T10:23:02.257Z"
}
```

The JSON holds counts; a reader divides for the shares. `bySessions` always holds five
entries, `sessions` 1 to 5, the last meaning five or more; `mean` is `null`
for an entry with no hours. `hot` is the hours at 60 or more. `capped` is
1d's, absent without section 2, and lists only parts with hours. `asOf` is
there when the window holds today, as on a `Day`.

### 1f. Data and cost

Nothing is stored. `trend` folds the `Day[]` that `report()` already returns
for the window, in one pure function. The 30-day report on the home Mac takes
0.15 s warm (`bun src/cli/index.ts --days 30 --json`, 378 KB of JSON that
`trend` no longer prints); the fold adds one pass over at most 90 × 24
buckets. The JSON above is about 1.2 KB for 30 days.

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
- The same with `--json` prints `"hours": 22`, `"activeMin": 1270` and
  `"levels": { "Calm": 15, "Warming": 3, "Heating": 1, "Fried": 3 }`. Today:
  the same exit 2.
- `bun src/cli/index.ts --help > out; grep -c 'cogload trend' out` prints 1.
  Today it prints 0 and grep exits 1.
- CLI tests through the fixture pin each line above, a window of 9 days (a
  short first week of 2 days), the empty window, `--explain` and `--out`
  rejected with `trend`, and `--json` in a pipe and in a terminal. Each fails
  on main.
- On the work Mac, `cogload trend --days 30 --to 2026-11-22 --json` and
  `stats.ts` over `cogload --days 30 --to 2026-11-22 --json` taken in the
  same minute agree on every number in 1c. For the author to run; not run
  here.
- README's command table, `docs/reference.md` (Usage, the commands table, the
  pipe paragraph) and `--help` name `trend`.

## 2. How far a capped part is over its norm

### 2a. Which parts can exceed their norm

Each part is a count divided by its norm and clamped to `[0, 1]`
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

In the day table with `--explain`, a part at its cap other than `late` shows
its points, then its ratio to one decimal and `×`. The other cells stay as
they are. The five part columns grow to ten characters. When any cell of the
table shows a ratio, one dim line follows the table:

```
  N× beside a part: it is at its cap, with N times what fills it
```

The work Mac's 2026-11-02, the 13:00 row (`cogload 2026-11-02 --explain`),
with the columns that day shows:

```
hour   index  level    sess  prompts  rep  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok        par       pace        sup  read  strk  late
13:00     87  Fried      11       34   36     0    0      4     0     0      27     39m    59.8k    25 2.5×    15 1.7×    30 1.7×   7.5   9.8     0
```

Today the same row ends `25  15  30  7.5  9.8  0`, and an hour with five
sessions prints the same `25`. The fixture's 2026-09-14 12:00, five sessions,
55 prompts, 25 decisions, 54 context switches and a 235-minute streak,
becomes `25 1.0×  15 2.8×  30 2.9×  6.9  10 5.9×  0`.

The index, the level, `parts`, `capped` and `top` do not change: the ratio is
computed beside `fractionsOf`, from the same metrics and `NORMS`, and nothing
reads it back into the score.

### 2c. The plain day view

Without `--explain` the day table already prints the raw values the ratio is
made from (`sess 11`, `prompts 34`) and prints no parts, so it has nothing at
a cap to mark. This section leaves it alone. The issue asks for "the day view
and `--explain`"; whether the plain view should also mark a capped hour is an
open question below.

### 2d. The number behind it

Of the work Mac's 146 hours at heating or above, `parallel` is at its cap in
130, with ratios from 1.0 to 2.5 (median 1.5): 22 of them at exactly 1.0, 64
from 1.1 to 1.5, 38 from 1.6 to 2.0 and 6 above 2.0. `pace`, 109 hours: median
1.4, up to 2.9. `supervision`, 108 hours: median 1.6, up to 3.5. Today all
of those print `25`, `15` and `30`.

### 2e. Data and cost

Nothing stored, no JSON change. One pure function next to `fractionsOf`, and
wider cells in one table.

### 2f. Not in this section

No change to the index, the norms or the weights; no recalibration. No new
JSON field. No change to `/cogload`, which already names the counts of a
capped part (`at the cap: 16 decisions and 13 context switches`).

### 2g. Definition of Done

- `script -q out env TZ=UTC bun src/cli/index.ts 2026-09-14 --projects tests/fixtures/busy-week --explain --no-color; grep -c '2.8×' out`
  prints 3: the three Fried hours, 12:00 to 14:00, each with 55 prompts.
  Today it prints 0 and grep exits 1. (`script` gives the run a terminal: in a pipe
  the day prints JSON.)
- A render test through the fixture pins the 12:00 row to
  `25 1.0×  15 2.8×  30 2.9×  6.9  10 5.9×  0`, the 23:00 row's `late` cell
  to `10` with no ratio, and the legend line. Each fails on main; the `late`
  case fails with the `late` exclusion removed.
- The existing score and `--json` tests pass unchanged, so the index and the
  JSON are as before.
- `docs/reference.md` (the `--explain` row and "How the index works") says
  what `N×` means.

## 3. Rests taken and skipped in the CLI

### 3a. What the plugin keeps

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
of JSON: `rests` holds 4 starts, the oldest 2026-11-17; `overrides` holds 12
entries, the oldest 2026-10-05, the week the powerbank spec counted, because
no skip has been written since; there is no `queueSends`. The same directory
holds older stores for the `inline` and `zapara` installs. The file name, its
hash and its format are Claude Code's, and nothing documents them for a
program other than Claude Code.

### 3b. What that means for a window

The history the issue asks for does not exist. For the issue's 30 days, the
home Mac's plugin kept the rests since 2026-11-17 (4 of them) and no skip at
all: the 12 in `overrides` are from 2026-10-05 to 2026-10-10. The work Mac's
store was not read; its trims are the same, so it holds 7 days of rests at
most. A 30-day count cannot be produced on either Mac. The transcripts hold no rests
either: a held prompt is dropped before it reaches the transcript, and a
rest leaves only a gap. Skips left are a per calendar week number (five from
Monday 00:00), so over a window they exist only for the week in progress.

The CLI also has no sound way to read the store. It would have to guess
Claude Code's path and hash, parse a format it does not own, tell three
installs apart, and step around `overrides`' reasons, the one piece of text
the plugin keeps: the CLI must never print it.

### 3c. What would have to be recorded from now on

Per rest, its start and how it ended: run to the end, or lifted by a skip
(with the skip's time). The record holds times and one word, with no
reason, prompt or session id. That passes the privacy rule in `CLAUDE.md`
as written, with no new exception. One line of JSON per event,
`{"at":"2026-11-17T17:54:08.520Z","event":"start"}`, is 50 bytes with its newline, so about
100 bytes per rest with its end.

Volume: the work Mac had 93 hours with a streak of 40 minutes or more in the
30 days, and 77 Fried hours. A rest starts at most once per streak and, for
Fried, at most once an hour, so the month held at most about 170 rests:
under 17 KB a month, 51 KB kept for 90 days, the longest window the CLI
takes. This is an upper bound from hour counts; the count itself is what is
missing.

The options are under Open questions. This section designs no reader until
the author picks one.

### 3d. Not in this section

No reader of the plugin store from the CLI. No estimate of past rests
printed as if they were counted. No change to `/cogload`'s week line, the
powerbank or the rest.

### 3e. Definition of Done

Written once the author picks an option. With option B: a plugin test shows
that a rest's start and a lifting skip each run `cogload rest` once with
`start` or `lift` and a time and nothing else; a CLI test shows `trend`
counting taken and skipped rests per week from a `rests.jsonl` fixture, and
skips left for the current calendar week only; the privacy paragraph in
`docs/reference.md` names the new file.

## 4. The session count in the band

### 4a. Which count

There are two readings of "when the fourth session opens", and only one is
in the data:

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

There are also two readings of "the status line". cogload draws one line
itself, the plugin's band above the prompt; a Claude Code status line is the
person's own script reading `status.json`. This section changes the band and
adds the count to the file, so a status line script can show it too.

### 4b. Where the count comes from

`cogload status` writes a twelfth field, `sessions`, after `restMin`: the
live bucket's `sessions`, `0` when there is none. The status-file spec allows
it: adding a field does not bump `schema`. The line grows by 13 to 14 bytes
(196 bytes today on the home Mac).

The plugin reads `sessions` when it is a non-negative integer and treats an
absent or invalid one as unknown: an older cogload's line still decodes, the
band shows no count, and no `olderShown` toast is raised for it. The store
key `reading` keeps its type, an object; a reading saved by a session started
before the update has no `sessions`, and the band shows no count until that
session's own next refresh.

### 4c. The text

From 4 sessions, the band names the count after the level, from 50 columns:

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

The count would show often at work: 190 of the 310 hours with a session had
four or more, on 22 of 25 active days. At home 17 of 238 hours, on 6 days.
With 5 as the threshold it would be 157 hours at work and 3 at home.

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
  stored reading: `sessions: 4` at 60 columns with a rest ahead →
  `● Warming · 4 sessions · rest at …`; `sessions: 3` → no count; a rest
  running with `sessions: 6` → today's rest band; 40 columns with
  `sessions: 6` → `● Heating` alone; a reading without `sessions` → no count
  and no `olderShown`. The first fails on main. Not run: the cases do not
  exist yet.
- The status-file spec's field table, `docs/reference.md` ("eleven values"
  becomes twelve, in the status row and in Privacy),
  `docs/how-the-numbers-are-made.md` section 7, and `plugin/README.md` name
  `sessions` and the band's count.

## Tech Stack

Bun 1.4.2+, TypeScript, the Claude Code plugin engine for section 4. No new
dependencies.

## Commands

```
bun run check
claude plugin test plugin
```

## Project Structure

```
src/lib/metrics/score.ts      overOf(): the ratio per capped part (section 2)
src/lib/metrics/trend.ts      trendOf(days): the summary, pure (section 1)
src/lib/text/render.ts        renderTrend; the --explain cells and legend
src/cli/args.ts               the trend verb, USAGE, the unknown-command hint
src/cli/commands.io.ts        trend(): report(), then text or JSON
src/lib/status/status.ts      the twelfth field, sessions (section 4)
plugin/hooks/register.ts      decode sessions; the band's count
plugin/types/index.d.ts       sessions?: number on Status
tests/...                     the cases in each Definition of Done
README.md, docs/reference.md, docs/how-the-numbers-are-made.md, plugin/README.md,
docs/superpowers/specs/2026-09-19-zapara-status-file-design.md
```

`bun run check` says where a module belongs when this layout is wrong.

## Code Style

```ts
// score.ts: the raw value over the norm, for the parts at their cap. late has none.
export function overOf(m: Metrics): Partial<Record<Exclude<Part, "late">, number>> {
  const raw = {
    parallel: (m.sessions - 1) / NORMS.parallelSpan,
    pace: m.prompts / NORMS.pacePerHour,
    supervision: (NORMS.decisionWeight * m.decisions + m.reports + m.contextSwitches) / NORMS.supervisionPerHour,
    reading: m.outputTokens / NORMS.readingTokens,
    streak: m.streakMin / NORMS.streakMin,
  };
  return Object.fromEntries(Object.entries(raw).filter(([, x]) => x >= 1));
}
```

`fractionsOf` keeps its own arithmetic; a test pins that `overOf` and
`fractionsOf` agree on which parts are at the cap.

## Boundaries

- Always: counts and times only in every new output; the index unchanged;
  the window flags and their errors as the grid has them.
- Ask first: a field on `Day`, a change to the grid's output, any read of
  the plugin store from the CLI, a new file under `~/.claude/cogload/`.
- Never: print or write a skip's reason from the CLI; print an estimate of
  past rests as a count.

## Open questions

1. **Section 3: where the rest history is recorded.** The author picks one,
   or cuts the section.
   - A. The CLI reads the plugin's store. Rejected here: Claude Code's path,
     hash and format; 7 days of rests and one calendar week of skips at
     most, so no 30-day answer; the reason text in the CLI's read path.
   - B. The plugin runs `cogload rest start --at <iso>` when a rest starts and
     `cogload rest lift --at <iso>` when a skip lifts one, as it already runs
     `cogload status`; the new verb appends to `~/.claude/cogload/rests.jsonl`
     (0600, trimmed to 90 days on write), and `trend` adds `rests` and
     `skipped` per week, plus skips left for the calendar week in progress.
     About 100 bytes per rest; a new file to name in the privacy paragraph;
     an older cogload rejects the verb with exit 2, and the plugin logs it to
     the debug log and goes on. History starts the day it lands. Recommended.
   - C. The plugin keeps a longer log under a new store key (90 days) and
     `/cogload` shows a window. Keeps everything in the plugin, but the
     answer is inside Claude Code, not the CLI the issue asks for.
   - D. The CLI counts rests due from transcripts: streaks that reached 40
     minutes, and Fried hours an hour apart. Works for past windows, but it
     cannot tell taken from skipped, and it counts rests the plugin may never
     have started (not installed, another Mac). Not measured here: the hour
     buckets do not say where one streak ends and the next begins.
2. **Section 2: the plain day view.** Leave it as it is (proposed), or append
   the largest ratio to the level, `Fried 2.5×`, as the issue's second
   wording ("print the raw value beside the level") suggests.
3. **Section 4: the threshold.** 4, as the issue asks, shows the count in 61%
   of the work Mac's hours; 5, where `parallel` caps, in 51%.

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
- The ratio is computed beside the score and never feeds it, so no
  recalibration rides on this change.
- The session count comes from the status file, the one reading the plugin
  already takes every minute, rather than a second `cogload today --json` run.
