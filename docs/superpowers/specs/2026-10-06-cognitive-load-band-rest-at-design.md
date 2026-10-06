# Spec: the band says when the rest starts

Extends `2026-10-04-zapara-forced-rest-design.md` and
`2026-10-05-cogload-rest-moment-design.md`; everything not mentioned here stays
as they say.

## Objective

`● Calm · streak 19m` does not say what the number leads to. A new user meets
the rest as a surprise: the band names it only from the 35th minute, as
`rest in 5 min`. The person who installed the plugin should see from the
first minute that the streak ends in a rest, and when.

After this change:

1. While the current streak will still start a rest, the band shows the clock
   time it starts: `● Calm · rest at 14:52`. The time is the streak's start
   plus 40 minutes, so it stays put for the whole streak.
2. The warning from the 35th minute (`rest in N min`) is gone; rule 1 covers
   those minutes too.
3. When the streak will not start a rest, because this streak already had one
   or an override lifted it, the band shows `streak 52m` as before.
4. A running rest still shows `rest until 15:02 (10 min)`.
5. Like the warning it replaces, `rest at` shows at any width; `streak Nm`
   still needs 50 columns.

Not in scope: the toasts, `/cogload`, the CLI, a countdown in minutes, and a
different band before the first rest.

### How

In the `AbovePrompt` render of `plugin/hooks/register.ts`, the warning branch
becomes: no running rest, `0 < streakMin < 40` and `streakWouldRest`, then
`rest at ${clockTime(streakStart(s) + 40 min)}`. `WARN_AFTER_MIN` goes.

No Fried or 40-minute case is needed. The band reads the `status` state, and
only `take` writes it, after `startRestIfDue` has started any rest the reading
is due. So a reading at Fried, or at 40 minutes or more, reaches the band with
the rest already running (`rest until`), or with its rest spent (`streak 40m`).
A streak of 0 shows no tail, as today.

## Tech Stack

As the specs above: Claude Code plugin of function hooks, plain TypeScript.
No new engine call.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
```

## Project Structure

```
plugin/hooks/register.ts            the band's rest-at branch; WARN_AFTER_MIN removed
plugin/tests/register.test.ts       cases below replace the warning's
plugin/.claude-plugin/plugin.json   0.8.3 → 0.8.4
docs/reference.md                   the band's paragraphs
```

## Testing Strategy

Unit, `claude plugin test plugin`, on the mocked clock, each case failing when
its behaviour is removed:

1. A live streak that began 19 minutes ago → `rest at` its start plus 40
   minutes; after two more readings, one tick apart, the same time.
2. Streak 37 → `rest at` that streak's start plus 40 minutes, not
   `rest in 3 min`.
3. A rest, then `override: <reason>` typed during it → `streak Nm`, not
   `rest at`.
4. A running rest → `rest until`, unchanged.
5. 45 columns → `● Heating · rest at …` on one line; with a spent streak at 45
   columns → `● Heating` alone.

## Boundaries

- Always: privacy as in CLAUDE.md; the band shows counts and clock times only.
- Ask first: any new state or text beyond `rest at HH:MM`.
- Never: a second timer.

## Definition of Done

- The rest-moment spec's warning rules point here.
- `claude plugin test plugin` passes, the cases above included, each failing
  without its behaviour.
- `bun run check` passes.
- `docs/reference.md` describes `rest at` instead of `rest in 5 min`.
- The plugin version is 0.8.4; the PR body carries the CHANGELOG line.
