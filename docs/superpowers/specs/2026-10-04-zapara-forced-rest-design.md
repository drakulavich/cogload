# cognitive-load: hold new prompts until a break is taken

Extends `2026-10-03-zapara-cognitive-load-plugin-design.md`. Everything not
mentioned here stays as that spec says. The plugin it describes is an MVP and
may change. Tracks [#105](https://github.com/drakulavich/zapara/issues/105).

## Purpose

zapara is meant to make the person who drives Claude Code less tired. The
band shows the load, and the person sees it and keeps working: a signal that
waits for a decision is ignored. This change makes the decision for them.
After a long streak or a Fried hour, the plugin holds the person's new
prompts in every session for ten minutes. A deliberate override with a reason
lifts the hold and is counted.

Claude's behaviour does not change. Turns and agents already running finish.

The change is judged by zapara itself: a month after it is in use, the
person's week grid holds fewer Heating and Fried hours and fewer streaks over
40 minutes than the month before.

## What the person sees

1. A turn ends, and the reading it brings has `streakMin` 40 or more, or
   `level` Fried. A toast, once:
   `Rest until 14:32. Streak 52m, Heating 68.`
2. Until 14:32, a prompt typed in any session that runs the plugin is not
   sent. It is dropped with the reason
   `Rest until 14:32 (7 min). Start with "override: <reason>" to go on.`
3. The band reads `▓ Heating 68 · rest until 14:32`, under 50 columns too.
4. At 14:32 prompts go through again. Ten minutes without a prompt is
   zapara's gap (`GAP_MS`): the streak is over, and the next one starts at 0.
5. A prompt whose first line is `override: <reason>`, the reason at least
   three words, lifts the hold for the rest of this streak. The first line is
   removed and the rest of the prompt is sent; when nothing is left, nothing
   is sent and a toast says `Rest lifted.` The band then shows
   `overrides this week: 2` for as long as the count is above 0.
6. `/overrides` prints the overrides of the last 14 days, newest first, one
   per line, for the week's review:
   `Thu 03 Oct 14:25  prod is down, fixing it`. With none it prints
   `No overrides in 14 days.`
7. While the last sixty minutes are Calm and there is no hold, there is no
   band. The band's appearance means something.

Held: prompts the person typed at the terminal (`e.origin.kind` `composer`)
or sent from Remote Control (`bridge`). Not held: answers to Claude's
questions and permission prompts (they are dialogs, not prompts), slash
commands (`command.run`), and prompts from notifications, other sessions,
scheduled triggers and plugins. A running turn is never interrupted.

## How the plugin decides

The streak is identified by its start, `asOf - streakMin` minutes. Two
different streaks start at least 50 minutes apart: one that reached 40
minutes is followed by a gap of at least ten. Two starts within ten minutes
are the same streak, which absorbs rounding to whole minutes and readings from
different sessions.

The plugin keeps in `$.store`, shared by every session and kept across
reloads and restarts:

```ts
rest: { until: number; streakStart: number } | undefined
spent: number | undefined          // start of the streak that last held or was overridden
overrides: { at: number; reason: string }[]   // older than 14 days dropped on each write
```

On each reading that decodes, after the MVP stores it in `$.state`: when
`streakMin` is 40 or more or `level` is Fried, and this streak's start is
more than ten minutes from `spent` (or `spent` is unset), set
`rest = { until: now + 10 min, streakStart }`, set `spent` to this start, and
toast. A streak holds the person once: if they answer Claude's questions
through the rest and the streak survives it, it does not start another hold.

On `prompt.submit` from `composer` or `bridge`: when `rest` is set and `now`
is before `rest.until`, either it is an override (lift: delete `rest`, append
`now` and the reason, trimmed, to `overrides`) or it is dropped with the
reason above. The band counts the last 7 days; `/overrides`, registered on
`session.start` and answered by `command.run`, lists the last 14. A `rest` whose
`until` has passed is deleted on the next look.

The band reads `rest` and `overrides` from the store when it draws. It is not
redrawn on a timer: after 14:32 it can say `rest until 14:32` until the next
redraw, while a prompt already goes through. The hold itself is checked
against `$.clock` at Enter.

The 40 and the ten minutes are constants in `register.ts`, each with one
comment line naming the zapara constant it must equal (`NORMS.streakMin`,
`GAP_MS`): the plugin imports nothing from `src/`, so a recalibration there
would leave it behind without a word.

Two sessions whose turns end at the same moment can both start a hold; both
write the same `until` within a second, so the person sees one rest and
perhaps two toasts. `$.store` has no compare-and-set; this spec accepts that.

## Privacy

The store holds two timestamps for the current rest and streak, and each
override of the last 14 days with its time and its reason, the words the
person typed after `override:`. That is the one piece of text the plugin
keeps; it stays in the plugin's JSON file under Claude Code's configuration
directory, is never sent anywhere, and is dropped after 14 days. The README's
privacy paragraph says so.

## Testing

`claude plugin test plugin`, with `mock.store` and `mock.clock`, cases added
to `plugin/tests/register.test.ts`. Each asserts what differs with and
without the behaviour it pins:

1. A reading with `streakMin` 40: `rest.until` is ten minutes ahead, one
   toast. With 39 and Warming: no rest.
2. A Fried reading with `streakMin` 5: a rest.
3. During a rest, a `composer` prompt is dropped with the reason naming the
   time; a `bridge` prompt too.
4. During a rest, prompts with origin `peer`, `task-notification`,
   `scheduled-trigger` and a plugin's own pass.
5. At `until` plus one second, a `composer` prompt passes and `rest` is gone.
6. `override: prod is down` plus a second line: the second line is sent,
   `rest` is gone, `overrides` holds `now` and `prod is down`. `override: ok` (one word): dropped.
   `override: prod is down` alone: nothing sent, `Rest lifted.` toast.
7. After a rest, a reading of the same streak at 55 minutes: no new rest. A
   reading of a new streak at 40: a new rest.
8. The band: `rest until 14:32` during a rest, at 120 and at 40 columns; no
   band for Calm without a rest; `overrides this week: 2` with two overrides
   in seven days, none with one eight days old.
9. `/overrides` with overrides 2, 9 and 15 days old: two lines, newest first,
   each with its weekday, date, time and reason; the 15-day one is gone from
   the store after the next write. With none: `No overrides in 14 days.`

User scenarios, run as the plugin spec says (tmux, `--plugin-dir plugin`, a
stub `zapara` first on `PATH`, captured screens in the implementation PR):

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub prints Heating, `streakMin` 52 | Send a prompt | After the answer, the toast and `rest until HH:MM` in the band |
| 2 | After 1 | Send another prompt | It is not sent; the reason with the time is on screen |
| 3 | After 1, a second session | Send a prompt there | Not sent either |
| 4 | After 1 | `/help`, then answer an `AskUserQuestion` Claude raises in a running turn | Both work |
| 5 | After 1 | `override: prod is down, fixing it` and a second line | The second line reaches Claude; the band shows `overrides this week: 1` |
| 6 | After 1 | Wait ten minutes, send a prompt | It is sent; the band no longer says `rest until` after it redraws |
| 7 | After 5 | `/overrides` | One line with today's date, the time and `prod is down, fixing it` |
| 8 | Stub prints Calm, `streakMin` 15 | Start, send a prompt | No band, nothing held |

Scenario 4 checks what the types say but no test has run: that answers and
slash commands do not pass through `prompt.submit`.

## README, CHANGELOG

- README, "Inside Claude Code": the hold, its trigger, ten minutes, the
  override, its count and `/overrides`, what is never held. "Privacy": what the store
  keeps.
- CHANGELOG `## [Unreleased]`, `### Changed`: "The `cognitive-load` plugin
  holds new prompts for ten minutes after a 40-minute streak or a Fried hour.
  `override: <reason>` goes on and is counted; `/overrides` lists the
  reasons of the last 14 days. The band is hidden while the
  last hour is calm."
- The plugin's version goes up one minor version.

## Later

- The band redraws when the rest ends (`$.clock.after`), rather than at the
  next redraw.
- Override count in zapara's own week grid; needs a file zapara reads.

## Definition of done

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  the MVP's cases and 1 to 9, each of which fails when the behaviour it pins
  is removed.
- `bun run check` passes; zapara's code and the status line are unchanged.
- User scenarios 1 to 8 pass, with captured screens in the implementation PR.
- README and CHANGELOG carry the changes above.
