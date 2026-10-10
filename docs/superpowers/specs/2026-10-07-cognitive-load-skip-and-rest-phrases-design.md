# Spec: a rest says something new each time, and how to skip it

Extends `2026-10-04-zapara-forced-rest-design.md` (rules 2 and 5),
`2026-10-05-cogload-first-meeting-design.md` (rule 4, the one-time hint) and
`2026-10-06-cognitive-load-override-last-line-design.md`; everything not
mentioned here stays as they say.

## Objective

During a rest every held prompt gets the same line, `Rest until 14:12. Your
prompt is saved.`, and only the first one says how to go on
([#183](https://github.com/drakulavich/cogload/issues/183)). Pressing Enter
again and again during a rest gives the same flat text each time, which
annoys, and the way out is gone after the first time. `override` is a hard
word to reach for when tired.

After this change:

1. A held prompt is dropped with
   `<phrase> 7 min left. Your prompt is back in the box: to send it, add
   "skip: <reason>" as its last line.` A `skip:` sent alone lifts the rest
   but sends nothing, so the hint points at the box, where Claude Code put the
   prompt back. A Remote Control (`bridge`) prompt is not held: it goes
   through with a note in its context that makes Claude begin its reply by
   saying it went past the rest. A held phone prompt came back nowhere and
   looked lost. The minutes are `Math.ceil((until - now) / 60_000)`, as
   the band counts them.
2. `<phrase>` is the next of these, in order, wrapping after the last:
   1. `Stand up and stretch.`
   2. `Water, then a window.`
   3. `Look at something far away.`
   4. `Walk to the kitchen and back.`
   5. `Roll your shoulders, unclench your jaw.`
   6. `Close your eyes for a minute.`
   7. `Breathe out slower than you breathe in.`
   8. `The code will wait.`

   Two held prompts in a row get different phrases. The position is kept in
   `$.store` as `phrase` (a number), shared by sessions: two sessions holding
   at the same moment may show the same phrase; accepted.
3. A line `skip: <reason>`, first or last in the prompt, lifts the rest under
   the rules `override:` has today: case-insensitive, a reason of three words
   or more, the line removed and the rest sent. `override:` keeps working the
   same way and is mentioned nowhere.
4. A shorter reason, or none, gets `A skip needs a reason of three words or
   more.`, and a typed prompt goes back into the box, with `Your prompt is
   back in the box.`
5. The one-time hint and its `taught` flag go: every prompt held without a
   `skip:` or `override:` line carries the way out. A too-short skip gets
   only the reply in 4, with no phrase: it already names the way out. A stored `taught` is left alone and no longer read.
6. `/cogload` reads `This week: 3 rests taken, 1 skipped (last: "prod is
   down, fixing it").`, and the command's description says "the week's rests
   and skips". Skips are still stored under `overrides`, so the week's count
   survives the update.

Not in scope: `bypass:`, jokes or escalation by attempt count, the rest's
start toast, re-recording `assets/plugin.webp` (its `override:` still works).

### How

In `plugin/hooks/register.ts`: `OVERRIDE` becomes `/^(?:skip|override):(.*)$/i`;
`HINT` and the `taught` read and write go; a `PHRASES` list and a `phrase`
counter in `prompt.submit` build the drop text; `SHORT` and `weekLine` get
the new words.

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
plugin/hooks/register.ts            prompt.submit, OVERRIDE, PHRASES, SHORT, weekLine
plugin/tests/register.test.ts       cases below; hint tests rewritten
plugin/.claude-plugin/plugin.json   0.8.7 → 0.9.0
README.md, docs/reference.md        skip, the phrases, the store's keys
```

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing without its behaviour:

1. Two typed prompts during a rest → `Stand up and stretch. 10 min left.
   Your prompt is back in the box: to send it, add "skip: <reason>" as its
   last line.`, then the same with
   `Water, then a window.`
2. Nine held prompts → the ninth carries `Stand up and stretch.` again.
3. A bridge prompt during a rest → it enters, its context carrying the
   past-the-rest note; the next typed prompt is still held.
4. Three minutes into a rest → `7 min left`.
5. `fix it\nskip: prod is down now` → the rest lifts, `fix it` is sent, the
   reason is stored; `Skip: prod is down now` alone → dropped with `Rest
   lifted.`
6. `override: prod is down now` → the rest lifts, as today.
7. `skip: no` → `A skip needs a reason of three words or more. Your prompt
   is back in the box.`
8. A rest taken and a rest skipped → `/cogload` prints `This week: 1 rest
   taken, 1 skipped (last: "prod is down now").`

## Boundaries

- Always: privacy as in CLAUDE.md; the reason is still the only text kept,
  `phrase` is a number.
- Ask first: phrases chosen at random, more or other phrases, dropping
  `override:`.
- Never: send the skip line to Claude. (Since #207 a skip sent alone goes to
  Claude with a note; `2026-10-10-cognitive-load-held-prompts-back-design.md` brings the held prompts back.)

## Definition of Done

- `claude plugin test plugin` passes, cases 1 to 8 included, each failing
  without its behaviour.
- `bun run check` passes.
- The three specs above point here from the rules this changes.
- README and `docs/reference.md` say `skip:`, quote the new held line and
  list `phrase` and `friedAt` among the store's keys, without `taught`.
- The plugin version is 0.9.0; the PR body carries the CHANGELOG line.
