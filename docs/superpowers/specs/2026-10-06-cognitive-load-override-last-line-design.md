# Spec: an override on the last line counts

Extends `2026-10-04-zapara-forced-rest-design.md` (rule 5) and
`2026-10-05-cogload-first-meeting-design.md` (rule 4); everything not
mentioned here stays as they say.

## Objective

During a rest, a prompt that ended with `override: <three-word reason>` was
held ten times in a row ([#177](https://github.com/drakulavich/cogload/issues/177)).
The plugin reads `override:` on the first line only, and the one-time hint
had already been shown, so each retry got the same `Rest until 14:12. Your
prompt is saved.` People write the message first and add the override at
the end.

After this change:

1. During a rest, an `override: <reason>` line lifts the rest when it is the
   prompt's first line or its last line. Trailing blank lines do not count
   as the last line. When both qualify, the first line is the override.
2. The override line is removed and the other lines are sent; when nothing
   is left, the prompt is dropped with `Rest lifted.`, as today.
3. A reason of fewer than three words on either line gets
   `An override needs a reason of three words or more.`, as today.
4. An `override:` line anywhere else does nothing: the prompt is held like
   any other, so a pasted log does not lift a rest.
5. The one-time hint reads
   ` To go on now, start or end the prompt with "override: <reason>".`

Not in scope: repeating the hint on later held prompts, and any other
change to the rest.

### How

In `prompt.submit` of `plugin/hooks/register.ts`, split `e.text.trimEnd()`
into lines; take the first line if `OVERRIDE` matches it, else the last line
when there is more than one; remove that line and join the rest. `HINT`
gets the new text.

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
plugin/hooks/register.ts            prompt.submit reads the first or last line; HINT
plugin/tests/register.test.ts       cases below
plugin/.claude-plugin/plugin.json   0.8.5 → 0.8.6
README.md, docs/reference.md        "first or last line"
```

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing without its behaviour:

1. `fix the retry\noverride: prod is down` during a rest → the rest lifts,
   `fix the retry` is sent, the override is stored with its reason.
2. `override: prod is down\n` with a trailing blank line, and a last line
   alone after blank lines → treated as the override line.
3. `fix it\noverride: no` → the short-reason reply; the prompt goes back
   into the box.
4. `a\noverride: prod is down now\nb` → held, `Rest until …`, no override
   stored.
5. The first held prompt's hint carries the new text.

## Boundaries

- Always: privacy as in CLAUDE.md; the reason is still the only text kept.
- Ask first: an override on any line; repeating the hint.
- Never: send the override line to Claude.

## Definition of Done

- `claude plugin test plugin` passes, cases 1 to 5 included, each failing
  without its behaviour.
- `bun run check` passes.
- The two specs above point here from their override rules.
- README and `docs/reference.md` say the override line is the first or the
  last line.
- The plugin version is 0.8.6; the PR body carries the CHANGELOG line.
