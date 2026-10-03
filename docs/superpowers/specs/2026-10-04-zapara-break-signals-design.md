# cognitive-load: a break signal, and no band while calm

Extends `2026-10-03-zapara-cognitive-load-plugin-design.md`. Everything not
mentioned here stays as that spec says. The plugin it describes is the MVP;
this change is the first one that tells the person what to do.

## Purpose

zapara exists to help a person who drives Claude Code get less tired. The
band shows a number all day, and a number shown all day stops being read.
Two changes turn it into a signal:

- The band stays away while the last sixty minutes are Calm, so its
  appearance means something.
- When the presence streak passes the norm the index uses, 40 minutes
  (`NORMS.streakMin` in `src/lib/metrics/score.ts`), the plugin says so once,
  keeps saying it in the band, and after the break shows what the break did.

On 2026-10-03 the streak reached 50 minutes by 21:00 and the hours scored
Calm or Warming most of the day: the band would have been away for the calm
hours and asked for a break once, in the evening.

Nothing changes in zapara or in the status line. All of it is the plugin,
reading the `index`, `level`, `streakMin` and `asOf` it already decodes.

## What the person sees

Band, `bodyColumns` 50 or more:

```
▒ Warming 41 · peak 82 · streak 52m, take a break · active 6h15
```

Band, under 50 columns:

```
▒ Warming 41 · take a break
```

- The band is drawn when `level` is Warming, Heating or Fried, or when
  `streakMin` is 40 or more. A Calm reading with a shorter streak draws
  nothing (`next(e)`), as a `null` index already does.
- At 40 minutes or more the streak part reads `streak 52m, take a break`;
  under 50 columns the band is the glyph, level, index and `take a break`.
  Under 40 minutes the band is as the MVP draws it.
- A toast, once per streak, when a reading first shows `streakMin` of 40 or
  more: `52m without a break · Warming 41`.
- A toast, once, on the first reading of the next streak:
  `rested 14m · 68 → 41`, the length of the break and the index before and
  after it. When either index is `null` it is `rested 14m`. The index covers
  the last sixty minutes, so a short break moves it a little; the toast shows
  what moved, and claims nothing more.
- Both toasts are shown in one session only, the first whose turn ends after
  the crossing, even when several sessions run the plugin.
- English, as the CLI is.

The band updates only when a turn ends, as in the MVP: the signal appears at
the first turn that ends past 40 minutes, not at the minute itself.

## How the plugin knows

The streak is identified by its start, `asOf - streakMin` minutes. Two
streaks are at least ten minutes apart (zapara's gap rule), and a streak that
crossed 40 minutes started at least 50 minutes before the next one could, so
two starts within ten minutes of each other are the same streak; rounding of
`streakMin` to whole minutes and runs from different sessions stay well inside
that.

The plugin keeps one value in `$.store`, which is shared by every session of
the plugin and survives reloads and restarts:

```ts
long: { start: number; lastAsOf: number; lastIndex: number | null } | undefined
```

On every reading that decodes, after the MVP stores it in `$.state`:

1. `streakMin` above 0, with a `long` whose start is more than ten minutes
   from this start: a new streak began. Toast `rested`, the break being this
   start minus `long.lastAsOf`, then delete `long`.
2. `streakMin` 40 or more:
   - no `long`: toast the nudge, set `long` to this start, `asOf` and `index`;
   - else update `long.lastAsOf` and `long.lastIndex`.
3. Anything else changes nothing. A reading with `streakMin` 0 (a session
   started while you are away) does not end the break: it is not over until
   you act.

Step 1 runs first, so a new streak that is already past 40 minutes at its
first reading gets both toasts, `rested` and then the nudge.

The 40 and the ten minutes are constants in `register.ts`, each with one line
naming the zapara constant it must equal (`NORMS.streakMin`, `GAP_MS`): the
plugin imports nothing from `src/`, and a recalibration there would leave the
plugin's threshold behind without a word.

Two sessions whose turns end within the same moment can both read no `long`
and both toast. The store has no compare-and-set; the cost is one extra
toast, rarely, and the spec accepts it.

## Privacy

The store holds three numbers: when the last long streak started, when it
was last seen, and the index then. They sit in the plugin's JSON file under
Claude Code's configuration directory. The README's privacy paragraph says
so; the plugin still reads no transcript, prompt or tool call.

## Testing

`claude plugin test plugin`, cases added to `plugin/tests/register.test.ts`,
with `mock.store` and `mock.clock`. Each asserts what differs with and
without the behaviour it pins:

1. A Calm reading with `streakMin` 20: no band. With `streakMin` 40: the band,
   with `take a break`. On `terminal` and `desktop`.
2. A Warming reading with `streakMin` 39: the MVP's band, no `take a break`,
   no toast.
3. A reading with `streakMin` 40 or more: one nudge toast; a second reading of
   the same streak (start within a minute) adds none.
4. `bodyColumns` 40 and a long streak: `▒ Warming 41 · take a break`.
5. The store already holds this streak (another session toasted): no toast.
6. After a long streak, a reading of a new streak 14 minutes after
   `lastAsOf`: `rested 14m · 68 → 41`, and the store no longer holds `long`.
7. After a long streak, a reading with `streakMin` 0: no toast, `long` kept.
8. A long streak whose `lastIndex` is `null`: `rested 14m`.
9. After a long streak, the first reading of a new streak shows `streakMin`
   45: `rested` and then the nudge, and `long` holds the new start.

User scenarios, run as the plugin spec says (tmux, `--plugin-dir plugin`, a
stub `zapara` first on `PATH`, captured screens in the implementation PR):

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub prints a Calm line, `streakMin` 15 | Start, send a prompt | No band |
| 2 | Stub prints a Warming line, `streakMin` 52 | Send a prompt | The toast `52m without a break · Warming 41`, and the band with `take a break` |
| 3 | As 2, two sessions in two windows | One prompt in each | One toast across both windows; both bands say `take a break` |
| 4 | After 2, stub edited to a new streak, `streakMin` 3, `asOf` 14 minutes later | Send a prompt | The toast `rested 14m · 41 → …`; no `take a break` |
| 5 | Stub as 2, window 45 columns | Send a prompt | `▒ Warming 41 · take a break` |

## README, CHANGELOG

- README, "Inside Claude Code": the band is away while Calm, the break signal
  and the two toasts, one sentence each. "Privacy": the three numbers in the
  plugin's store.
- CHANGELOG `## [Unreleased]`, `### Changed`: "The `cognitive-load` band is
  hidden while the last hour is calm, asks for a break after 40 minutes
  without one, and shows what the break changed."
- The plugin's version goes up one minor version.

## Later

Each needs its own spec; the list is the order of expected use.

- The agent eases off when you are hot: at Heating or Fried, `prompt.compose`
  adds a section asking Claude to batch its questions and take defaults on
  small choices. Supervision is 30 of the index's 100 points and led 7 of the
  12 scored hours on 2026-10-03; zapara itself can measure whether questions
  per hour drop.
- A parallel ceiling: sessions mark themselves in `$.store`, and the fifth one
  at once gets a toast (`NORMS.parallelSpan` is 4).
- The band names the component driving the index (`26 sessions`,
  `14 decisions`). Needs a field in the status line; the plugin is its only
  reader that has to follow.
- A timer that refreshes between turns, so the nudge arrives at 40 minutes
  and not at the next turn.

## Definition of done

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  the MVP's cases and 1 to 9, each of which fails when the behaviour it pins
  is removed.
- `bun run check` passes; zapara's code and the status line are unchanged.
- User scenarios 1 to 5 pass, with captured screens in the implementation PR.
- README and CHANGELOG carry the changes above.
