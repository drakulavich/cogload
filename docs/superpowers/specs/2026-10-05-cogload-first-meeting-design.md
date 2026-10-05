# Spec: cognitive-load explains itself to a new person

Extends `2026-10-05-cogload-rest-moment-design.md` and the plugin specs it
extends; everything not mentioned here stays as they say. Tracks
[#124](https://github.com/drakulavich/cogload/issues/124),
[#121](https://github.com/drakulavich/cogload/issues/121) and
[#120](https://github.com/drakulavich/cogload/issues/120), for the public
announcement of the current 0.x.

## Objective

A person installs the plugin from the marketplace. Today they most likely
see nothing: the band hides while the last hour is calm, and without
`cogload` on the `PATH` the plugin is silent (a Homebrew Bun leaves
`~/.bun/bin` off it). When the band does show, `▓ Heating 77 · peak 77 ·
streak 35m · active 2h20` does not say what 77 is. When an override is too
short, the refusal reads like any other hold.

After this change:

1. The first session after install shows one toast:
   `cognitive-load shows your load above the prompt when it rises above Calm.`
2. When the refresh classifies a run as `not found` (as today: any error
   from `$.process.run` before the timeout), one toast, once per install: `cognitive-load needs cogload on Claude Code's PATH: bun add -g @drakulavich/cogload`.
   It names no path. A later successful run does not clear the flag.
3. The band shows the level and the streak: `▓ Heating · streak 35m`. The
   index, peak and active time leave the band; `cogload` in a terminal
   keeps them. With a zero streak, or under 50 columns, it is `▓ Heating`
   alone. The warning (`rest in N min`), the rest countdown and the
   overrides count replace or follow the tail as they do today.
4. During a rest, a prompt whose first line is `override:` with a reason of
   fewer than three words, an empty reason included, is dropped with
   `An override needs a reason of three words or more.`, plus
   ` Your prompt is saved.` for a `composer` prompt, which goes back into
   the box as other held prompts do. It does not take the one-time override
   hint.

The rest's toast keeps its text, index included.

### How

- `$.store` gains `welcomed: true` and `missingShown: true`, each written
  with its toast. Both start over with a new marketplace, like the rest of
  the store.
- The welcome fires on `session.start`, before the first refresh, so a
  person who also lacks `cogload` sees the welcome first.
- The missing toast fires from the `not found` branch of the refresh, after
  the debug log line it already writes.
- "Once per install" is read-then-write on the shared store: two sessions
  starting or failing at the same moment may both show a toast. Accepted,
  as two rest toasts are.

## Tech Stack

As the specs above. No new engine noun.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
CLAUDE_CODE_PLUGIN_CACHE_DIR=$(mktemp -d) claude --plugin-dir plugin   # user scenarios, in tmux
```

## Project Structure

```
plugin/hooks/register.ts            welcome, missing hint, band, short override
plugin/tests/register.test.ts       cases below; existing band strings updated
plugin/.claude-plugin/plugin.json   0.5.0 → 0.6.0
README.md, CHANGELOG.md             see Definition of Done
docs/how-the-numbers-are-made.md    the band in the diagram
```

No file under `src/` or `tests/` changes.

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing when its behaviour is
removed:

1. First `session.start` → the welcome toast; a second one → none.
2. A run that cannot start → the missing toast once; a second failing run →
   none; a run that exits 1 → none.
3. Band at 120 columns → `▓ Heating · streak 20m`; streak 0 → `▓ Heating`;
   40 columns → `▓ Heating`; no `peak` or `active` at any width. While
   Calm, the warning reads `░ Calm · rest in 3 min` and a rest
   `░ Calm · rest until HH:MM (10 min)`.
4. Warning, rest countdown and overrides count still follow the head:
   `▓ Heating · rest in 3 min`, `▓ Heating · rest until HH:MM (10 min)`,
   `▓ Heating · streak 20m · overrides this week: 1`.
5. `override: ok` + a second line during a rest, `composer` →
   `An override needs a reason of three words or more. Your prompt is saved.`,
   the text back in the box, the rest still on; `bridge` → without the
   saved sentence; `override:` with nothing after it → the same reply.
6. A short override as the first held prompt → no hint, and `taught` stays
   unset, so the next ordinary held prompt still carries it.

User scenarios, tmux, `CLAUDE_CODE_PLUGIN_CACHE_DIR=$(mktemp -d)`:

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub `cogload`, Heating, streak 20 | Start | The welcome toast; `▓ Heating · streak 20m` |
| 2 | No `cogload` on `PATH` | Start | The welcome toast, then the missing toast; no band |
| 3 | Stub streak 40 | `override: ok` | The short-override drop; the text back in the box |
| 4 | Stub, Heating | Open in the Desktop Code tab | The band reads well; the person checks this one |

## Boundaries

- Always: no path, prompt text or stdout in any toast; each toast once per
  install.
- Ask first: more toasts; changing what the rest's toast says.
- Never: a toast on every session; hold anything new.

## Definition of Done

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  the updated existing cases and 1 to 6.
- `bun run check` passes; `git diff main -- src tests` is empty.
- User scenarios 1 to 3 pass, with captured screens in the PR; scenario 4
  is checked by the person before the announcement.
- `plugin/.claude-plugin/plugin.json` says 0.6.0.
- README "Inside Claude Code" shows the new band, the two toasts and the
  short-override reply, and its band examples (the status line section's
  sample and "keeps only `▓ Heating 68`") use the new format, as does the
  band in the diagram of `docs/how-the-numbers-are-made.md`; CHANGELOG
  `## [Unreleased]` carries one entry.
