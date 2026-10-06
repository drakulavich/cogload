# Spec: /cogload says why the load is what it is

Extends `2026-10-04-zapara-forced-rest-design.md` and
`2026-10-05-cogload-first-meeting-design.md`; everything not mentioned here
stays as they say. Tracks [#132](https://github.com/drakulavich/cogload/issues/132),
which merged #99 and #125.

## Objective

Since #120 the band shows only the level and the streak. When it turns
Heating mid-day, the author asks why, and the answer lives in a terminal
(`cogload today --explain`). `/overrides` has a generic name another plugin
could take.

After this change:

1. `/cogload` prints what drives the current hour, in counts the author
   recognises:

   ```
   Heating 80 this hour, at the cap: 16 decisions and 13 context switches, 32 prompts, a 57m streak.
   This week: 1 rest taken, 1 pushed through (last: "prod is down, fixing it").
   ```

2. The first line names every part at its cap (its points equal its
   weight), heaviest weight first. When no part is at its cap, it names the
   one with the largest share of its weight: `Warming 45 this hour, mostly 3
   sessions at once.` A tie on share goes to the heavier weight.
3. One phrase per part, from the live hour of `cogload today --json`:

   | Part | Phrase |
   |---|---|
   | parallel | `N sessions at once` |
   | pace | `N prompts` |
   | supervision | `N decisions and M context switches` |
   | reading | `Nk output tokens` (rounded to thousands) |
   | streak | `a 57m streak` (the band's minute format) |
   | late | `late at night` |

   The streak is the band's number: from `presence.streakStartAt` to the
   day's `asOf` while `presence.lastAt` is within ten minutes of `asOf`, as
   `cogload status` counts it; otherwise the live hour's `streakMin`. The live
   hour's streak stops at your last action, so it ran a few minutes behind the
   band while you read ([#171](https://github.com/drakulavich/cogload/issues/171)).

4. The second line counts, over the last seven days, the rests taken and
   the ones pushed through, and quotes the newest override's reason, marked `last:`:
   `This week: 18 rests taken, 2 pushed through (last: "prod is down").` An
   override can only lift a running rest, so an override is pushed through
   when a rest in the window started at most ten minutes before it, and the
   window's other rests are taken. An override with no such rest (its rest
   fell out of the window, or started before rests were kept) is left out,
   reason included. With no override it is
   `This week: 5 rests taken.` With neither, the line is left out. It used
   to read `20 rests, 20 overrides`, which looked like two unrelated counts
   ([#174](https://github.com/drakulavich/cogload/issues/174)).
5. With no scored live hour, the first line is `Nothing scored this hour.`
6. `/overrides` is gone. Overrides are kept seven days instead of fourteen.

The 14-day count behind rule 2 is in the
[issue comment](https://github.com/drakulavich/cogload/issues/132#issuecomment-5994685765):
ranked by points, supervision leads 8 of 9 hot hours; parts at the cap come
in six different sets.

### How

- `/cogload` runs `cogload today --json` with the 10-second timeout
  `refresh` uses and reads `live` (counts and `score.parts`).
- The plugin keeps a copy of `WEIGHTS` from `src/lib/metrics/score.ts`, with
  a comment pointing there, as it does for `REST_AFTER_MIN`.
- `$.store` gains `rests: number[]`, the start of each rest, written by
  `startRestIfDue`; entries older than seven days are dropped on each write,
  and `overrides` follows the same rule.
- When `cogload` is missing, the command prints the `MISSING` text the
  toast uses. Any other failure (a non-zero exit, a timeout, output that
  does not parse) prints `cogload gave no reading.` Neither echoes a path or
  the output.

## Tech Stack

As the specs above: Claude Code plugin of function hooks, plain TypeScript,
`cogload` on `PATH`. No new engine noun; no change to the CLI.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
CLAUDE_CODE_PLUGIN_CACHE_DIR=$(mktemp -d) claude --plugin-dir plugin   # user scenarios, in tmux
```

## Project Structure

```
plugin/hooks/register.ts            /cogload, rests in the store, /overrides removed
plugin/tests/register.test.ts       cases below
plugin/.claude-plugin/plugin.json   0.6.1 → 0.7.0
README.md, CHANGELOG.md             see Definition of Done
```

No file under `src/` or `tests/` changes.

## Testing Strategy

Unit, `claude plugin test plugin`, each case failing when its behaviour is
removed:

1. Each of the six parts alone at its cap → its phrase from the table.
2. supervision, pace and streak at their cap → all three, in weight order
   (supervision, pace, streak).
3. Nothing at its cap, parallel 18.8 of 25 and supervision 20 of 30 →
   `mostly 4 sessions at once` (share 0.75 beats 0.67).
4. A share tie between pace and reading → pace.
5. `live` null → `Nothing scored this hour.`
6. Two rests in the window, one overridden within its ten minutes →
   `This week: 1 rest taken, 1 pushed through (last: "<reason>").`; two
   overrides → the newest reason; rests and no override → `N rests taken.`;
   a rest started seven days and five minutes ago, overridden in the window,
   and a fresh rest → `This week: 1 rest taken.`
7. No rests or overrides → one line.
8. `cogload` missing → the `MISSING` text; exit 1 and unparsable output →
   `cogload gave no reading.`
9. A started rest adds to `rests`; an entry eight days old is dropped on
   that write.
10. `/overrides` is not registered.

User scenarios, tmux, stub `cogload` first on `PATH`:

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub: today's live hour above | `/cogload` | The first line with the three capped parts |
| 2 | Stub: streak 40 | Send a prompt and let its turn end (the reading starts the rest), then `override: prod is down` while the rest holds, then `/cogload` | Second line `This week: 0 rests taken, 1 pushed through (last: "prod is down").` |
| 3 | No `cogload` on `PATH` | `/cogload` | The `MISSING` text |
| 4 | Any | `/overrides` | Claude Code's unknown-command reply |

## Boundaries

- Always: print counts and the override reason only; keep each line within
  what the author reads at a glance.
- Ask first: advice on what to do; a pane or table; more than two lines.
- Never: print a path, a prompt or another session's text; change the CLI.

## Definition of Done

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  the existing cases and 1 to 10.
- `bun run check` passes; `git diff main -- src tests` is empty.
- User scenarios 1 to 4 pass, with captured screens in the PR.
- `plugin/.claude-plugin/plugin.json` says 0.7.0.
- README "Inside Claude Code" documents `/cogload` and no longer mentions
  `/overrides`; the marketplace note about the store says the rest ends and
  the week's counts start over; "Privacy" says the plugin keeps the start of
  each rest and keeps override reasons 7 days, not 14. CHANGELOG `## [Unreleased]` carries one entry.

## Open Questions

- Several overrides in a week: quote the newest reason only, or all of
  them? This spec quotes the newest; the first assumption in #132 (does the
  phrase match how the hour felt) is checked by a week of use after merge.
