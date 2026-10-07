# Spec: a Fried hour holds once

Extends `2026-10-04-zapara-forced-rest-design.md` (How it decides); everything
not mentioned here stays as it says.

## Objective

A rest started by a Fried reading was followed by another, and another,
while the hour stayed Fried ([#180](https://github.com/drakulavich/cogload/issues/180)).
The rest is ten minutes without a prompt, which is zapara's gap, so it ends
the streak. The next prompt opens a new streak, more than ten minutes from
`spent`, and the hour score has not dropped in ten minutes: the reading is
Fried again, and a new rest starts. A 40-minute streak does not loop, because
the new streak starts at 0.

After this change:

1. A rest that starts on a Fried reading stores its start as `friedAt`.
2. A Fried reading with `streakMin` under 40 starts a rest only when there is
   no `friedAt` or it is 60 minutes or more in the past. The `spent` check
   applies as before.
3. A reading with `streakMin` 40 or more starts a rest as before, Fried or
   not, and stores `friedAt` when it is Fried.

Not in scope: the warning before a rest, the toast text, the week's count.

### How

In `startRestIfDue` of `plugin/hooks/register.ts`: a reading is due when
`streakMin >= REST_AFTER_MIN`, or when it is Fried and `friedAt` is missing or
at least `HOUR_MS` before `now`. When the rest starts on a Fried reading, set
`friedAt = now` next to `spent`.

## Tech Stack

As the spec above: Claude Code plugin of function hooks, plain TypeScript.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
```

## Project Structure

```
plugin/hooks/register.ts            startRestIfDue reads and writes friedAt
plugin/tests/register.test.ts       cases below
plugin/.claude-plugin/plugin.json   0.8.6 → 0.8.7
docs/reference.md                   one Fried rest an hour
```

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing without its behaviour:

1. Fried at streak 5 starts a rest; 11 minutes later a Fried reading at
   streak 1 starts none, and a prompt goes through.
2. Fried at streak 5 starts a rest; 61 minutes later a Fried reading at
   streak 5 starts a second rest.
3. Fried at streak 5 starts a rest; 51 minutes later a Fried reading at
   streak 40 starts a second rest: the 40-minute rule does not wait for the
   hour.

## Boundaries

- Always: privacy as in CLAUDE.md; `friedAt` is a time, nothing else.
- Ask first: changing the 60 minutes, or the 40-minute rule.
- Never: drop the Fried rest itself.

## Definition of Done

- `claude plugin test plugin` passes, cases 1 to 3 included, each failing
  without its behaviour.
- `bun run check` passes.
- The forced-rest spec points here from its Fried rule.
- `docs/reference.md` says a Fried hour holds once.
- The plugin version is 0.8.7; the PR body carries the CHANGELOG line.
