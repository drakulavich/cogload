# cognitive-load: zapara's load above the Claude Code prompt

Extends `2026-09-19-zapara-status-file-design.md` and
`2026-09-22-zapara-live-index-design.md`. Everything not mentioned here stays
as those say.

## Purpose

The status line reader that exists, pult, lives outside Claude Code and
refreshes a file every few minutes. Claude Code mods (plugins of function
hooks, `claude plugin validate` and `claude plugin test`) can draw a band
above the prompt from inside the session that produces the load. This change
adds an optional plugin, `cognitive-load`, that shows the person their current
load there, always, without a second program.

It shows one line and nothing else: no toasts, no pane, no command, no
blocking. Those are listed under Later.

## What the person sees

A band above the prompt, one line:

```
▓ Heating 68 · peak 81 · streak 2h40 · active 6h15
```

- The glyph and colour come from `level`, with the grid's glyphs: `░` Calm,
  `▒` Warming, `▓` Heating, `█` Fried. The number is `index`. `peak`,
  `streakMin` and `activeMin` are the status line's fields, minutes printed
  as `XhMM`, under an hour as `Mm`.
- `streak` is left out when `streakMin` is 0.
- When the band is narrower than 50 columns (`e.props.bodyColumns`), only the
  glyph, the level and the index are drawn: `▓ Heating 68`.
- No band at all when `index` is `null` (the reader contract: `null` draws
  nothing), before the first good reading, or while a survey holds the band
  (`e.props.hasSurvey`). In each case the hook returns `next(e)`.
- English, as the CLI is.

## How the number gets there

The plugin is a second kind of reader of the status contract. pult reads the
file, judges staleness from `asOf` and starts a detached run. The plugin
instead runs `zapara status` itself and reads the line it prints, which the
status spec already makes equal to the file's content.

1. On `session.start`, after `next(e)` resolves, and on `turn.complete`, after
   `next(e)` resolves, the plugin calls
   `$.process.run(["zapara", "status"], { timeoutMs: 10000 })`.
2. It decodes stdout by the status spec's reader rules, unchanged: one JSON
   object, `schema` 1, `asOf` no later than 60 seconds after the plugin's
   clock (`$.clock.now()`), every field in its range, `level` `null` exactly
   when `index` is. The plugin has its own decoder; it imports nothing from
   `src/`, whose code runs under Bun and not in the plugin's environment.
3. A line that decodes is stored with `$.state` under `cognitive-load.status`:
   the nine fields, nothing else. A ui.render read of that state redraws the
   band when it changes.
4. Anything else (`zapara` not found, a non-zero exit, the timeout, a line
   that does not decode) keeps the last good reading, or no band when there is
   none, and writes one line with `$.ui.log(..., { to: "debug" })` naming the
   kind of failure: `not found`, `exit <code>`, `timeout`, `bad line`. Never
   stderr, never stdout, never a path.

No timer and no staleness check. The number changes when the person acts, and
every turn ends with a run. Between turns `streakMin` stands still; the streak
itself ends after ten minutes away, so the band is at most one turn behind.

A run took 117 to 262 ms on 2026-10-03 (`$.process.run` from a throwaway mod,
zapara 0.8.1, warm and cold cache). Time inside `$` calls does not count
against a hook's 10-second budget, and the hooks call `next(e)` first, so a
slow run never holds the person's turn. Runs from several sessions at once
are harmless: the status file is written atomically, as the status spec says.

`zapara` is found on the `PATH` Claude Code was started with. A Homebrew Bun
does not put `~/.bun/bin` there; the README says so, as it already does for
the CLI. No `bunx` fallback.

## Privacy

The plugin keeps the nine values of the status line in session state and
nothing more. It reads no transcript, no file, no prompt and no tool call. It
sends nothing anywhere; it runs one local command. The README's sentence "It
sends nothing anywhere, installs nothing into Claude Code" becomes true of
the CLI only, and the paragraph says what the optional plugin does.

## Layout

```
.claude-plugin/marketplace.json     marketplace "zapara", one plugin: ./plugin
plugin/
  .claude-plugin/plugin.json        name "cognitive-load", version 0.1.0, types
  hooks/hooks.json                  { "modules": ["./register.tsx"] }
  hooks/register.tsx                the hooks above and the band
  types/index.d.ts                  PluginState["cognitive-load"]: { status }
  tests/register.test.ts
```

Install:

```
/plugin marketplace add drakulavich/zapara
/plugin install cognitive-load@zapara
```

`plugin/` is not in `package.json`'s `files`, so the npm package does not
change. The plugin has its own version, starting at 0.1.0, not tied to
zapara's.

## Testing

`claude plugin test plugin` runs `plugin/tests/register.test.ts` against the
engine. The test's own `process.run` hook sits beneath the plugin and answers
for `zapara`, so no binary is needed. Each case asserts what differs with and
without the behaviour it pins (CLAUDE.md, #69):

1. `session.start` with a Heating line: the band holds `Heating 68`, `peak 81`,
   `streak 2h40`, `active 6h15`. On `terminal` and `desktop`.
2. `turn.complete` with a second line: the band shows the second index, not
   the first.
3. `schema` 2, a broken line, exit 1: no band when nothing came before; the
   earlier reading when one did.
4. `index` `null`: no band. On `terminal` and `desktop`.
5. `bodyColumns` 40: only `▓ Heating 68`. On `terminal` and `desktop`.
6. A failing run whose stderr holds `/Users/secret/path`: the string is in
   neither the band nor the state.
7. `asOf` two minutes ahead of the test clock: treated as a bad line.

Checks:

- `plugin/` is excluded from the root `tsconfig.json` and from Knip: its types
  are the engine's `claude-code` module, which Bun does not have. Biome lints
  it with the rest.
- `ci.yml` gets a step that installs Claude Code and runs
  `claude plugin validate plugin` and `claude plugin test plugin`.
  `bun run check` does not run them, so it still passes on a machine without
  Claude Code. The first task of the plan confirms both commands run in CI
  without credentials; if they do not, the step stays local and the PR says
  so.

## README, CHANGELOG, status spec

- README: a section "Inside Claude Code" with the two install commands, what
  the band shows, and that `zapara` must be on Claude Code's `PATH`. "Status
  line" names the plugin as a second reader beside pult. "Privacy" as above.
- CHANGELOG `## [Unreleased]`, `### Added`: "The `cognitive-load` Claude Code
  plugin shows the current load above the prompt. Install it from this
  repository's marketplace; the npm package is unchanged."
- `2026-09-19-zapara-status-file-design.md`, "Contract for a reader": one
  paragraph saying a reader may instead run `zapara status` and decode its
  stdout by the same rules, linking this spec.

## Later

Not in this change: an hourly sparkline in the band (needs hours the status
line does not carry), toasts when the level crosses into Heating or Fried, a
`/zapara` command with the day in a pane, a `bunx` fallback, and a timer that
refreshes between turns.

## Definition of done

- `claude plugin validate plugin` passes with no error.
- `claude plugin test plugin` passes all seven cases above; each fails when
  the behaviour it pins is removed.
- `bun run check` passes, and `plugin/` is in none of `tsc`'s or Knip's
  inputs.
- CI runs validate and test, or the PR states why it cannot.
- Loaded with `claude --plugin-dir plugin` on a machine with zapara 0.9.0 on
  `PATH`: the band appears after the first turn, its index equals
  `zapara status`'s, and it changes after a later turn.
- `bun pm pack --dry-run` lists no file under `plugin/` or
  `.claude-plugin/`.
- README, CHANGELOG and the status spec carry the changes listed above.
