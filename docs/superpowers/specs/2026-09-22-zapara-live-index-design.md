# zapara live index: the status line's number stops resetting on the hour

Extends `2026-09-19-zapara-status-file-design.md`, which extends
`2026-09-17-zapara-design.md`. Everything not mentioned here stays as those
say.

## The problem

The status file's `index` and `level` are the bucket of the calendar hour that
contains `asOf`. At 12:00:30 that bucket holds thirty seconds: on a real
machine on 2026-09-22 the status read `90 Fried` at 11:59:30 and `6 Calm` at
12:00:30, with the same person doing the same thing. The streak already has its
own clock (the presence rule of 0.4.0: `streakMin` runs from `presence` against
`asOf`), so it crossed the boundary as 71 → 72; the index did not.

The boundary is the visible symptom of a wider one. Four of the six parts of
the index are counts per hour (`pace`, `supervision`, `reading`, and `parallel`
through sessions seen), so a bucket read at minute 20 is systematically lower
than the same hour read at minute 59. Drawn every thirty seconds, the number is
a sawtooth with a period of one hour. A status line asks "how loaded am I
right now", and a calendar hour is the wrong window for that question.

## The rule

The **live bucket** is the same measurement as an hour bucket, taken over the
sixty minutes that end at `asOf` instead of a calendar hour.

- **Window.** An event, or the start of a 5-minute slot, belongs to the live
  window when `asOf − 60 min < t ≤ asOf`. The right end is closed because
  `derive()` already counts an event at exactly `now`; the left end is open so
  the window has the length of one hour and, at `asOf` = `HH:59:59.999`, is the
  calendar hour `HH` to the millisecond.
- **Counts.** `prompts`, `reports`, `outputTokens`, `interrupts`, `rejects`,
  `questions`, `plans`, `modeSwitches`, `decisions`: the events in the window,
  accumulated by the rule an hour bucket uses. `sessions`: the distinct
  sessions with an `activity` event in the window, which is every session with
  any record there, since the parser emits `activity` for every timestamped
  record before any other kind. `contextSwitches`: a prompt from a
  session other than the previous prompt's, previous meaning within the window;
  the first prompt of the window is never a switch, as the first prompt of an
  hour is not.
- **Presence.** `activeMin` is five times the number of slots whose start lies
  in the window and that the person's presence covers, by the presence rule
  (a presence event covers its own slot; within a streak, every slot between
  two events). Any sixty-minute half-open interval holds exactly twelve slot
  starts, so `activeMin` ≤ 60.
- **Streak.** The longest presence streak the window saw, measured from that
  streak's first event, which may lie before the window, exactly as an hour
  bucket measures it. The window's streak is not the live `streakMin` of the
  status file: that one drops to 0 ten minutes after the last action, and the
  index would drop ten points with it in one step. The bucket rule lets the
  streak leave the index the way everything else does, by sliding out.
- **Late night.** The hour of `asOf`, by the same set of hours as a bucket's
  label.
- **Score.** `score()` as it is, weights and norms untouched; `null` when the
  window has no session, as for a bucket.
- **Look-back.** The window may begin before the day: at `asOf` 00:20 it
  starts at 23:20 the day before. Those events count in the live bucket, though
  they belong to no bucket of this day and no total. They are already in
  memory: `derive()` keeps three hours of look-back for the presence rule and
  `foldEvents` merely skips them for the buckets. The scan's mtime cutoff
  includes the look-back, so no file is missing.

Checked before writing this, on one machine's real transcripts: a live bucket
whose window coincides with a calendar hour equals that hour's bucket in all
fourteen metrics, for four different hours; across the 12:00 boundary the live
index read 90, 90, 90, 83, 70 at 11:59:30, 12:00:30, 12:05, 12:20, 12:40,
where the calendar bucket read 90, 6, 31, 46, 46.

## Data

```ts
export type LiveBucket = Metrics & { score: Score | null };
export type Day = { …; asOf?: string; live?: LiveBucket };
```

`live` is present exactly when `asOf` is: on the day that contains `now`, and
only when the window was run with a `now`. It is the sixty minutes ending at
`asOf`. A day without `asOf` has no `live`, as it has no snapshot.

`live` appears in `--json` for that day. The week grid, the day table, the
card and their JSON are otherwise unchanged; `peak`, `mean`, `activeMin`,
`totals`, `presence` and the twenty-four buckets keep their meaning and their
values.

## The status file

`index` and `level` come from `day.live.score`. In the field table of the
status-file spec, the two rows now read:

| Field | Meaning |
|---|---|
| `index` | The load index of the sixty minutes ending at `asOf`, `0`..`100`, or `null` when they hold no session. |
| `level` | That index's level, `Calm`, `Warming`, `Heating` or `Fried`, or `null` with `index`. A reader colours by this field so it never needs the thresholds. |

`hour` keeps its meaning, the local hour containing `asOf`. `activeMin` stays
the day's. `peak` is the day's peak folded with the live index (amended
2026-09-27): the larger of the two, so the file's `index` is never above its
`peak`. `Day.peak` itself, in `--json`, the grid and the day table, stays over
calendar hours only; `streakMin` stays live. The sentence "`hour`,
`index` and `level` describe the bucket of the current hour" becomes "`hour`
is the clock; `index` and `level` describe the last sixty minutes".

`schema` stays `1`, by that field's own rule: `index` keeps its name, unit and
range and is measured differently, which is a CHANGELOG entry, as the presence
rule was for `activeMin` and `streakMin`. A reader that already validates
`index` as `null` or an integer `0`..`100` needs no change. The reader
contract is unchanged. pult's README says "this hour's cognitive load index";
that is a one-word change in pult's repository after this ships.

## Architecture

- `src/derive.ts`. The per-event accumulation (the `switch` on `e.kind`, the
  session set, the context-switch bookkeeping) moves from the body of
  `foldEvents` into one function that takes an `Acc` and an event, so it has
  one definition. `foldEvents` calls it per calendar-hour key as now. A second
  fold, over the same sorted events, runs the presence bookkeeping from the
  first event as `foldEvents` does (a streak may begin before the window) and
  accumulates into one `Acc` only the events and slot starts inside
  `(now − 60 min, now]`. `buildDay` gains nothing; `derive()` builds the live
  bucket when `w.now` is set and attaches it to the day whose date is
  `localDate(now)`, if that day is in the window, next to `asOf`. The
  metrics-to-bucket step (`sessions.size`, `slots.size * 5`,
  `round(maxStreakMs)`, `decisions`, `lateNight`, `score()`) is the one
  `buildDay` uses per hour, factored so both call it.
- `src/status.ts`. `statusOf` reads `index` and `level` from `day.live?.score`
  instead of `day.buckets[hour].score`. `hour` still comes from `now`. Nothing
  else in the function changes; `renderStatus` is untouched, the file's nine
  fields and their order are the same.
- `src/types.ts`: `LiveBucket`, and `live?` on `Day`.
- Nothing else. `parse.ts`, `score.ts`, `render.ts`, `card.ts`, `cardhtml.ts`,
  `image.ts`, `statusfile.ts`, `scan.ts`, `index.ts` do not change. The core
  stays pure: `now` already arrives as an argument, and this adds no clock,
  no import from `node:` or `Bun`, no file.

## Testing

Fixture-driven through `analyze()` and `statusOf()`, in the real transcript
format, `TZ=UTC`, each with the one-line mutation that fails it:

- **The boundary.** Activity through 11:05–11:55 of one day, `now` =
  12:00:30. `days[0].live.score.index` equals `buckets[11].score.index`, and
  `statusOf(day, now).index` equals it too, while `buckets[12].score` is
  `null` or far below. Mutation: read `buckets[now.getHours()]`.
- **Alignment.** Events at exactly `11:00:00.000` and through the hour, `now`
  = `11:59:59.999`. `live` equals `buckets[11]` in every one of the fourteen
  metrics and in `score`. Mutation: either window bound moved to the other
  half-open side, which drops the `11:00:00.000` event or admits one at
  `10:59:59.999`.
- **A streak from before the window.** Prompts every two minutes from 11:20
  to 12:30, `now` = 12:30 (window from 11:30): `live.streakMin` is 70,
  measured from 11:20. The same prompts stopping at 12:10, `now` still 12:30:
  `live.streakMin` is 50, still from 11:20, although the status file's own
  `streakMin` is 0 by then. Mutations: start the streak at the window's edge
  (60 and 40); use the live streak (70 and 0).
- **Look-back across midnight.** Prompts 23:30–23:58 on day one, `now` 00:20
  on day two, window `days: 1`. `live.prompts` counts them and
  `live.sessions` is 1, while `buckets[0]` of day two has none and
  `totals.prompts` is 0. Mutation: skip events before `startMs` in the live
  fold, as `foldEvents` does for buckets.
- **Late night by the clock.** The same activity read at `now` 22:55 and
  23:05: `live.lateNight` false then true, and the index ten points apart
  when nothing else differs. Mutation: take `lateNight` from the window's
  first hour.
- **Nothing in the window.** Activity at 09:00, `now` 14:00: `live.score` is
  `null`, `statusOf` gives `index` and `level` `null`, `peak` still the day's
  (folding a `null` live index changes nothing).
  Mutation: score an empty metrics object.
- **Only the open day carries it.** A two-day window with `now` on the second
  day: `days[0].live` is `undefined`, `days[1].live` is set; a window run
  without `now` has no `live` anywhere. Mutation: attach it to every day.
- **The file is unchanged in shape.** The existing `status-cli` test keeps
  pinning nine fields in order; `live` does not leak into the line. The
  existing `status.test.ts` cases that assert `index` for `now` inside a busy
  hour are re-derived by hand for the sixty-minute window, and their expected
  values updated where they differ; a case whose window equals the hour keeps
  its number.

`score.test.ts` is untouched: the formula does not change.

## README, CHANGELOG, docs

- README, "Status line": the two field rows above, and the sentence that
  follows the table. The Limits bullet about the snapshot points here as it
  points to the status spec.
- `docs/how-the-numbers-are-made.md`: the paragraph on the status file says
  `index` and `level` are the last sixty minutes, and why.
- CHANGELOG `## [Unreleased]`, `### Changed`: "The status file's `index` and
  `level` are the load of the sixty minutes ending at `asOf`, not of the
  calendar hour that contains it: the number no longer drops to nothing at
  every hour boundary and no longer climbs through the hour as the bucket
  fills. `Day.live` in `--json` carries that bucket on the open day. Same
  formula, same norms; `schema` stays 1."
- The status-file spec of 2026-09-19 has its `index`/`level` rows, the
  sentence after its table, the reader-contract bullet and the
  `src/status.ts` bullet updated in place, as the presence rule did; this
  document holds the rule and the reasoning.

## Later

Not in this change: a `live` column or footer in `zapara today`; a
configurable window length; a live index for a day other than the open one;
the wording change in pult's README.
