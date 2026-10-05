# Spec: cognitive-load hides a reading older than five minutes

Extends `2026-10-03-zapara-cognitive-load-plugin-design.md` and
`2026-10-04-zapara-forced-rest-design.md`; everything not mentioned here stays
as they say. Tracks [#154](https://github.com/drakulavich/cogload/issues/154).

## Objective

Rule 4 of the plugin spec keeps the last good reading when `cogload` fails,
with no age limit. In exploratory session S5 the band still said
`● Heating · streak 20m` 70 s after `cogload` broke, and nothing stops it
saying the same hours later: the level and the streak frozen, drawn as if
live.

After this change:

1. On the one-minute tick, a stored reading whose `asOf` is five minutes or
   more behind `$.clock` is cleared, and the band draws nothing.
2. The next reading that decodes draws the band again, as today.
3. A reading younger than five minutes still draws when a refresh fails, as
   rule 4 says.
4. A rest that is running keeps holding prompts; only its countdown leaves the
   band with the rest of it. The held prompt's drop still names the end of
   the rest.
5. The "not found" toast and the debug log stay as they are. No new state, no
   new text.

Not in scope: a greyed or "no reading since" band, a threshold that can be
set, and a second session's band (it clears on its own tick).

### How

- `tick` in `plugin/hooks/register.ts` already reads the stored `reading`
  and refreshes when it is a minute old. After a refresh that brings no new
  reading, a stored `reading` with `now - asOf >= 5 min` is deleted and the
  `status` atom is set back to `null`.
- Five minutes is pult's threshold in the status-file spec, and five ticks:
  a slow or briefly missing `cogload` does not blank the band.

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
plugin/hooks/register.ts            tick clears a reading 5 min old
plugin/tests/register.test.ts       cases below
plugin/.claude-plugin/plugin.json   0.8.1 → 0.8.2
CHANGELOG.md                        see Definition of Done
```

No file under `src/` or `tests/` changes.

## Testing Strategy

Unit, `claude plugin test plugin`, on the mocked clock, each case failing
when its behaviour is removed:

1. One good reading, then `cogload` exits 1 on every run: the band draws at
   4 min, and is empty after the tick at 5 min.
2. As 1, then a good reading at 7 min: the band draws it.
3. A rest running when the reading clears: the band is empty and a typed
   prompt is still dropped with `Rest until …`.

## Boundaries

- Always: privacy as in CLAUDE.md; nothing about the failure is kept but the
  debug line rule 4 already writes.
- Ask first: any new band text or state.
- Never: a timer other than the existing tick.

## Definition of Done

- The plugin spec's rule 4 points here for the age limit.
- `claude plugin test plugin` passes, the three cases above included, each
  failing with the age check removed.
- `bun run check` passes.
- The plugin version is 0.8.2 and CHANGELOG has a `Fixed` line for the
  `cognitive-load` plugin.
