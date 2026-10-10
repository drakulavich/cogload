# Spec: cognitive-load holds new prompts until a break is taken

Extends `2026-10-03-zapara-cognitive-load-plugin-design.md`; everything not
mentioned here stays as that spec says. That plugin is an MVP and may change.
Tracks [#105](https://github.com/drakulavich/cogload/issues/105).

## Objective

The user is the author, who drives several Claude Code sessions a day and
wants to end the day less tired. The band shows the load, and the author sees
it and keeps working: a signal that waits for a decision gets ignored. So the
plugin makes the decision. After a long streak or a Fried hour it holds the
author's new prompts in every session for ten minutes. An override with a
reason goes on, and is counted and kept for the week's review. Claude's
behaviour does not change; turns and agents already running finish.

What the author sees:

1. A turn ends, and its reading has `streakMin` 40 or more, or `level` Fried.
   A toast, once: `Rest until 14:32. Streak 52m, Heating 68.`
2. Until 14:32 a prompt typed in any session running the plugin is not sent.
   It is dropped with
   `Rest until 14:32 (7 min). Start with "override: <reason>" to go on.`
   A prompt typed in the box goes back into it, so nothing has to be retyped.
   Each held prompt now gets a phrase for the break and `skip: <reason>`
   (`2026-10-07-cognitive-load-skip-and-rest-phrases-design.md`).
3. The band reads `▓ Heating 68 · rest until 14:32`, under 50 columns too.
4. At 14:32 prompts go through again. Ten minutes without a prompt is
   cogload's gap (`GAP_MS`), so the streak is over and the next starts at 0.
5. A prompt whose first line is `override: <reason>`, the reason at least
   three words, lifts the hold for the rest of this streak. The first line is
   removed and the rest is sent; when nothing is left, the line itself goes to
   Claude with a note to reply in one line that the rest is lifted (a drop
   would come back into the box, #206). The band then shows `overrides this week: 2`
   while the count is above 0. The last line counts too
   (`2026-10-06-cognitive-load-override-last-line-design.md`). The line is
   `skip: <reason>` now, `override:` kept as a synonym (`2026-10-07-cognitive-load-skip-and-rest-phrases-design.md`).
6. `/overrides` prints the overrides of the last 14 days, newest first:
   `Thu 03 Oct 14:25  prod is down, fixing it`, or
   `No overrides in 14 days.`
7. With no hold, a Calm reading draws no band.

Held: prompts with `e.origin.kind` `composer` (Enter at the prompt, typed or
queued, or a click on a transcript link) or `bridge` (Remote Control). Never
held: answers to Claude's questions and permission prompts (dialogs, not
prompts), slash commands (`command.run`),
and prompts from notifications, other sessions, scheduled triggers and
plugins.

### How it decides

A streak is identified by its start, `asOf - streakMin` minutes. A streak
that reached 40 minutes is followed by a gap of at least ten, so two streaks
start at least 50 minutes apart; two starts within ten minutes are the same
streak, which absorbs rounding and readings from different sessions.

`$.store` (shared by every session, kept across reloads and restarts):

```ts
restUntil: number | undefined
spent: number | undefined                    // start of the streak that last held
overrides: { at: number; reason: string }[]  // older than 14 days dropped on each write
```

- On each decoded reading, before it is stored (so the redraw it causes
  shows the rest): `streakMin` ≥ 40 or
  `level` Fried, and this start more than ten minutes from `spent` (or no
  `spent`) → `restUntil = now + 10 min`, `spent` = this start, toast. A streak holds once: answering Claude during the rest can
  keep the streak alive, and it must not hold again. A Fried hour holds once
  (`2026-10-07-cognitive-load-fried-rest-once-an-hour-design.md`).
  Extended by `2026-10-08-cognitive-load-one-source-of-numbers-design.md`: a rest is due at `restAt`, lasts `restMin`, and `spent` is the `restAt` that rested.
- On `prompt.submit` from `composer` or `bridge` with `now` before
  `restUntil`: an override deletes `restUntil` and appends `{ at: now, reason }`;
  anything else returns `{ drop: <the reason above> }`. A `restUntil` in the past holds nothing; it is
  overwritten by the next rest.
- The band reads the store when it draws; the hold is checked against
  `$.clock` at Enter. The band is not redrawn on a timer, so it can say
  `rest until 14:32` a little past 14:32.
- Two sessions ending a turn at the same moment can both start a hold with
  the same `until`: one rest, perhaps two toasts. `$.store` has no
  compare-and-set; accepted.

## Tech Stack

- Claude Code 2.1.289 plugin of function hooks (`claude-code` module types),
  plain TypeScript, no JSX, as in the MVP.
- Engine nouns used: `$.process.run`, `$.state`, `$.store`, `$.clock`,
  `$.ui.toast`, `$.command.register`; events `session.start`,
  `turn.complete`, `prompt.submit`, `command.run`, `ui.render`
  (`AbovePrompt`).
- cogload 0.9.0 on `PATH`, read through `cogload status`; unchanged.

## Commands

```
claude plugin validate plugin     # manifest, hooks, $.state/$.store keys
claude plugin test plugin         # plugin/tests/*.test.ts against the engine
bun run check                     # cogload: typecheck, biome + knip, tests (TZ=UTC)
claude --plugin-dir plugin --debug-file /tmp/cl/debug.log   # user scenarios, in tmux
```

CI (`.github/workflows/ci.yml`) already runs `bun run check`, then
`claude plugin validate . && claude plugin validate plugin && claude plugin test plugin`.

## Project Structure

```
plugin/hooks/register.ts        all hooks: refresh, hold, override, /overrides, band
plugin/types/index.d.ts         PluginState for $.state (unchanged)
plugin/tests/register.test.ts   unit cases below, beside the MVP's
plugin/.claude-plugin/plugin.json   version one minor up
README.md, CHANGELOG.md         see Success Criteria
```

No file under `src/` or `tests/` changes.

## Code Style

As the MVP's `register.ts`: module-level constants in caps, small pure
helpers, hooks at the bottom, element constructors from `$.ui.resolve(e)`:

```ts
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
  const s = await read($, status)
  if (e.props.hasSurvey || s === null || s.index === null || s.level === null) return next(e)
  const { Text } = $.ui.resolve(e)
  return Text({ color: COLOR[s.level], children: parts.join(' · ') })
})
```

The 40 and the ten minutes are constants with one comment line each naming
the cogload constant they must equal (`NORMS.streakMin`, `GAP_MS`): the
plugin imports nothing from `src/`, so a recalibration there would leave it
behind silently. No other comments.

## Testing Strategy

Unit: `claude plugin test plugin` with `mock.store` and `mock.clock`. Each
case asserts what differs with and without the behaviour it pins (CLAUDE.md):

1. `streakMin` 40 → `rest.until` ten minutes ahead, one toast; 39 and
   Warming → none.
2. Fried with `streakMin` 5 → a rest.
3. During a rest, `composer` prompts are dropped with the time and go back
   into the box. A `bridge` prompt passes with a note (the skip-and-phrases
   spec, 2026-10-07).
4. During a rest, `peer`, `task-notification`, `scheduled-trigger` and a
   plugin's own prompt pass.
5. At `until` + 1 s a `composer` prompt passes.
6. `override: prod is down` + a second line → the second line is sent,
   the next prompt passes, `/overrides` lists `prod is down`;
   `override: ok` → dropped; `override: prod is down` alone → sent with the
   lifted note, and the next prompt passes.
7. After a rest, the same streak at 55 min → no new rest; a new streak at
   40 → a new rest.
8. Band: `rest until 14:32` at 120 and 40 columns; none for Calm without a
   rest; `overrides this week: 2` for two in seven days, none for one eight
   days old.
9. `/overrides` with overrides 2, 9 and 15 days old → two lines, newest
   first; the 15-day one gone after the next write; none → the empty line.

User scenarios: tmux, `--plugin-dir plugin`, a stub `cogload` first on
`PATH`; they need a logged-in Claude Code, so they run locally and the
implementation PR carries the captured screens.

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub: Heating, `streakMin` 52 | Send a prompt | After the answer, the toast and `rest until HH:MM` |
| 2 | After 1 | Send a prompt | Not sent; the reason with the time |
| 3 | After 1, a second session | Send a prompt | Not sent |
| 4 | After 1 | `/help`; answer an `AskUserQuestion` from a running turn | Both work |
| 5 | After 1 | `override: prod is down, fixing it` + a second line | The second line reaches Claude; `overrides this week: 1` |
| 6 | After 1 | Wait ten minutes, send a prompt | Sent |
| 7 | After 5 | `/overrides` | One line: today, the time, `prod is down, fixing it` |
| 8 | Stub: Calm, `streakMin` 15 | Start, send a prompt | No band, nothing held |

## Boundaries

- Always: run `claude plugin test plugin` and `bun run check` before each
  commit; keep every hold path behind `origin.kind`, so nothing but the
  author's own prompts is ever dropped; leave running turns alone.
- Ask first: changing the 40-minute or 10-minute values, holding anything
  besides `composer` and `bridge`, any change under `src/` or to the status
  line, keeping more of the author's text than the override reason.
- Never: send anything off the machine, interrupt a running turn
  (`turn.abort`), block slash commands (they are how the author reaches
  `/plugin`), store a prompt's text other than the override reason.

## Success Criteria

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  the MVP's cases and 1 to 9, each failing when its behaviour is removed.
- `bun run check` passes; `git diff main -- src tests` is empty.
- User scenarios 1 to 8 pass, with captured screens in the implementation PR.
- README "Inside Claude Code" describes the hold, trigger, ten minutes,
  override, its count, `/overrides` and what is never held; "Privacy" says
  the override reasons of the last 14 days are kept locally in the plugin's
  store and dropped after.
- CHANGELOG `## [Unreleased]` / `### Changed` carries one entry for it.
- The outcome, checked a month after release with `cogload --days 30`: fewer
  Heating and Fried hours and fewer streaks over 40 minutes than the 30 days
  before. This one judges the idea, not the implementation PR.

## Open Questions

- That answers and slash commands bypass `prompt.submit` is read off the
  types, not run; scenario 4 settles it before merge.
