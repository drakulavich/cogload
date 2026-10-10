# Spec: held prompts come back after a bare skip

Extends `2026-10-04-zapara-forced-rest-design.md` (rule 5),
`2026-10-07-cognitive-load-skip-and-rest-phrases-design.md` (rules 1 and 3)
and the Privacy rule in `CLAUDE.md`; everything not mentioned here stays as
they say.

## Objective

During a rest Claude Code puts each held prompt back into the box. A person
who held several prompts, or cleared the box to send `skip: <reason>` on its
own, loses what was held: since #207 the bare skip goes to Claude and the
box is empty, so the held text has to be found and pasted by hand.

After this change:

1. Each prompt the rest holds (a `composer` prompt dropped with a phrase) is
   kept in the session's memory, `$.state` key `held` (a list of strings).
   Never in `$.store`, never on disk, never printed or sent anywhere. A
   prompt dropped for a too-short skip is not kept: it carries the skip line
   and is back in the box already.
2. A bare `skip: <reason>` lifts the rest and goes to Claude with the lifted
   note, as #207 made it. Then the box is filled (`mode: 'replace'`) with the
   held prompts, oldest first, a blank line between. A prompt contained in
   full in a later one is left out: the engine returned it to the box and the
   person typed on. With nothing held, the box is left alone.
3. `held` is cleared when the rest is lifted, either way, and by the first
   prompt submitted after the rest ends on its own. A `skip:` line with other
   text sends only that text, as today; what was held before is dropped.
4. `held` lives as long as the session's process. A restart loses it.
   `/reload-plugins` keeps it (`$.state` belongs to the host).
5. The Privacy rule in `CLAUDE.md` gains one exception: a held prompt's text,
   in `$.state` until the rest is lifted or the first prompt after it ends. This spec is the record of that
   change.

Not in scope: keeping held text in `$.store` or across a restart, other
sessions, phone (`bridge`) prompts (they pass), sending held prompts on their
own, a `skip:` line with other text bringing back what was held.

### How

`plugin/types/index.d.ts`: `held: string[]` under `PluginState`.
`plugin/hooks/register.ts`: a `held` atom; the phrase drop appends `e.text`;
the bare-skip branch reads it, clears it, returns
`next({ ...e, context: [..., LIFTED] })` and fills the box once the prompt
has entered (the submit empties the box, so a fill before it would be lost or
doubled, as in #201). The first prompt after a rest ends clears it.

## Tech Stack

As the specs above: Claude Code plugin of function hooks, plain TypeScript.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
```

## Project Structure

```
plugin/hooks/register.ts            held atom, prompt.submit
plugin/types/index.d.ts             held: string[]
plugin/tests/register.test.ts       cases below
plugin/.claude-plugin/plugin.json   0.10.5 → 0.11.0
CLAUDE.md                           Privacy: the held-prompt exception
docs/reference.md                   what a bare skip does
```

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing without its behaviour:

1. `fix the bug` held, `add a test` held, bare `skip: prod is down now` →
   it enters with the lifted note, and the box is filled with
   `fix the bug\n\nadd a test`.
2. `fix the bug` held, then `fix the bug and the retry` held, bare skip →
   the box is filled with `fix the bug and the retry` alone.
3. Bare skip with nothing held → no fill.
4. `fix the bug` held, `add a test\nskip: prod is down now` → `add a test`
   is sent, no fill; a later rest and bare skip fill nothing from before.
5. `fix the bug` held, the rest ends, a prompt passes; a new rest and a bare
   skip → no fill.
6. `skip: no` during a rest, then a bare skip → no fill.
7. A bridge prompt during a rest → it passes and is not kept.
8. After cases 1 to 7, no held prompt's text is in `$.store`, in a toast,
   in the band or in `/cogload`'s output.

PTY, the `scratchpad/et2` harness (box logger): held, held, box cleared,
bare skip → the box log shows both prompts once, then empty after Enter.

## Boundaries

- Always: the held text stays in `$.state`; nothing else about privacy
  changes.
- Ask first: keeping held text in `$.store`, bringing it back on a `skip:`
  line with other text, sending it on its own.
- Never: print, log or toast held text; write it to the store or disk.

## Definition of Done

- `claude plugin test plugin` passes, cases 1 to 8 included, each failing
  without its behaviour.
- `bun run check` passes.
- The PTY run shows the box filled once with both prompts.
- Dogfooding: in a real rest in the author's session, two prompts held, the
  box cleared, a bare skip sent; the box then holds both, once each. The
  result goes in the PR.
- `CLAUDE.md` Privacy names the exception; the two specs above point here.
- `docs/reference.md` says what a bare skip brings back.
- The plugin version is 0.11.0; the PR body carries the CHANGELOG line.
