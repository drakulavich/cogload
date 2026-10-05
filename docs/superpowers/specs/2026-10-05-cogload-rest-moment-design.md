# Spec: cognitive-load warns before the rest and says less when it holds

Extends `2026-10-04-zapara-forced-rest-design.md` and
`2026-10-04-zapara-live-band-design.md`; everything not mentioned here stays
as they say. Tracks [#118](https://github.com/drakulavich/cogload/issues/118)
and [#119](https://github.com/drakulavich/cogload/issues/119).

## Objective

The hold is the one moment the plugin stops the author's work, and today it
lands without warning: the band says `streak 35m`, then at the 40th minute
the next prompt is refused. The refusal leads with the way around it,
`Start with "override: <reason>" to go on.`, says the time twice, and does
not say that the typed prompt went back into the box.

After this change:

1. With no rest running, a reading whose streak is 35 to 39 minutes and
   would start a rest at 40 draws the band as `▓ Heating 68 · rest in 5 min`,
   the minutes left being `40 - streakMin`. It replaces the usual tail
   (peak, streak, active) at any width, and it draws while Calm too, as a
   rest does. The one-minute tick counts it down. The overrides count,
   when above 0, is appended after it as it is today, during a rest too:
   `▓ Heating 68 · rest in 3 min · overrides this week: 1`.
2. At 40 the rest starts as today, with the same toast.
3. A held `composer` prompt is dropped with
   `Rest until 14:32. Your prompt is saved.`; a held `bridge` prompt, which
   does not go back into the box, with `Rest until 14:32.`
4. The first held prompt after the plugin is installed adds
   ` To go on now, start the prompt with "override: <reason>".` Later ones do not;
   the README keeps the override documented.

A Fried reading starts a rest whatever the streak, so it comes without the
warning. The trigger, the ten minutes, the override, what is held and the
rest of the wording do not change.

### How

- "Would start a rest at 40": there is no `spent`, or the absolute
  difference between the streak's start (`asOf - streakMin`) and `spent`
  exceeds ten minutes; the test `startRestIfDue` already uses, on either
  side of `spent`. A streak that already held never warns.
- `$.store` gains `taught: true`, written with the first drop that carries
  the hint. Like the rest of the store it starts over with a new marketplace.
- Two sessions dropping a first prompt at the same moment may both show the
  hint; accepted, as two toasts are.

## Tech Stack

As the specs above: Claude Code plugin of function hooks, plain TypeScript,
`cogload status` on `PATH`. No new engine noun.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
claude --plugin-dir plugin --debug-file /tmp/cl/debug.log   # user scenarios, in tmux
```

## Project Structure

```
plugin/hooks/register.ts            warning, drop wording, hint
plugin/tests/register.test.ts       cases below
plugin/.claude-plugin/plugin.json   0.4.0 → 0.5.0 (also ships #117's colours)
README.md, CHANGELOG.md             see Definition of Done
```

No file under `src/` or `tests/` changes.

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing when its behaviour is
removed:

1. Streak 35 → `rest in 5 min`; 39 → `rest in 1 min`; 34 → the usual tail.
2. Streak 37 at 40 columns → `rest in 3 min`; Calm with streak 37 → the band
   draws.
3. A streak that already held, read again at 37 → no warning; with
   `spent` at 10:00 and a streak starting at 09:55 → no warning either.
4. Streak 36, one tick later at 37 → `rest in 3 min`.
5. Held `composer` prompt → `Rest until HH:MM. Your prompt is saved.` plus
   the hint the first time; a second held prompt → without the hint.
6. Held `bridge` prompt → `Rest until HH:MM.` (plus the hint if first).
7. Streak 37 with one override in seven days →
   `rest in 3 min · overrides this week: 1`.
8. Fried at streak 5 → a rest starts with no warning drawn before it.
9. After the hinted drop, `override: prod is down` plus a second line →
   the rest is lifted and the second line is sent.

User scenarios, tmux, stub `cogload` first on `PATH`:

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub: Heating, streak 36 | Start | `▓ Heating 68 · rest in 4 min` |
| 2 | Stub: streak 40 | Send a prompt | The toast; the prompt dropped with `Your prompt is saved.` and the hint; the text back in the box |
| 3 | After 2 | Send again | Dropped without the hint |
| 4 | Stub: streak 37, 45 columns | Start | `▓ Heating 68 · rest in 3 min` on one line |

## Boundaries

- Always: keep every hold path behind `origin.kind`; keep the drop without
  the hint, after Claude Code's `Prompt dropped by a hook: `, within 80
  columns.
- Ask first: changing 35, 40 or the ten minutes; showing the hint more than
  once.
- Never: store prompt text; hold anything new.

## Definition of Done

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  the existing cases and 1 to 9.
- `bun run check` passes; `git diff main -- src tests` is empty.
- User scenarios 1 to 4 pass, with captured screens in the PR.
- `plugin/.claude-plugin/plugin.json` says 0.5.0.
- README "Inside Claude Code" shows the warning and the new drop text and
  documents `override:`; CHANGELOG `## [Unreleased]` carries one entry for
  this and one for #117's colours.
