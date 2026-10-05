# Spec: cognitive-load finds cogload in ~/.bun/bin

Extends `2026-10-03-zapara-cognitive-load-plugin-design.md` and
`2026-10-05-cogload-explain-command-design.md`; everything not mentioned here
stays as they say. Tracks [#144](https://github.com/drakulavich/cogload/issues/144).

## Objective

The plugin starts `cogload` from the `PATH` Claude Code was started with.
Two common setups leave it off that `PATH` although it is installed: a
Homebrew Bun, which puts global commands in `~/.bun/bin` without adding it,
and the Desktop app started from the Dock, which does not see a shell's
`PATH`. The new user then meets `cogload is not on Claude Code's PATH`
before anything else.

After this change:

1. When `cogload` cannot be started, the plugin starts
   `$HOME/.bun/bin/cogload` with the same arguments, for `cogload status`
   and for `/cogload`'s `cogload today --json`.
2. When that cannot be started either, or `HOME` is unset, the plugin
   behaves as today: the toast once per install, `/cogload` prints the same
   text, the debug log says `not found`.
3. A timeout, a non-zero exit or a bad line from the first `cogload` does
   not try the second: it was found, so it is the one to fix.
4. No path is printed, logged or kept, the fallback's included.

Not in scope: `bunx` or any download (it would touch the network), a Bun
that is not installed at all, a custom `BUN_INSTALL`, and Windows, where
`HOME` is usually unset and rule 2 applies.

### How

- `run` in `plugin/hooks/register.ts` tries `['cogload', ...args]`; on the
  `not found` outcome it reads `$.env.get('HOME')` and, when set, tries
  `[`${home}/.bun/bin/cogload`, ...args]` under the same 10-second timeout,
  with `PATH` set to `$HOME/.bun/bin` ahead of Claude Code's own `PATH`.
  `cogload` is a `#!/usr/bin/env bun` script, and a Bun installed by its
  script sits in that same directory, so without this the fallback exits
  127 (`env: bun: No such file or directory`); a Homebrew Bun is still found
  through the original `PATH`. The outcome of the second try is the result.
- Nothing is remembered between runs: a failed spawn costs milliseconds, and
  a later `PATH` fix or install takes effect without a restart.

## Tech Stack

As the specs above: Claude Code plugin of function hooks, plain TypeScript.
`$.env.get` is the one engine call this adds; `claude plugin validate` lists
`HOME` and `PATH` as read.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
CLAUDE_CODE_PLUGIN_CACHE_DIR=$(mktemp -d) claude --plugin-dir plugin   # user scenarios, in tmux
```

## Project Structure

```
plugin/hooks/register.ts            run() falls back to $HOME/.bun/bin/cogload
plugin/tests/register.test.ts       cases below; the process.run mock routes by argv[0]
plugin/.claude-plugin/plugin.json   0.7.4 → 0.8.0
README.md, CHANGELOG.md             see Definition of Done
```

No file under `src/` or `tests/` changes.

## Testing Strategy

Unit, `claude plugin test plugin`, with `mock.env`, each case failing when
its behaviour is removed:

1. `cogload` missing, `$HOME/.bun/bin/cogload` answers a reading → the band
   draws; the second call's argv is `[<HOME>/.bun/bin/cogload, 'status']`.
2. The same for `/cogload`: its two lines come from the fallback.
3. Both missing → exactly two calls, `cogload` then the fallback; the toast
   once, `/cogload` prints the toast's text.
4. `HOME` unset → exactly one call, `cogload`; then as 3.
5. The first `cogload` times out, exits 1, or prints a bad line → exactly
   one call; the band keeps no reading and the debug log says `timeout`,
   `exit 1` or `bad line` as today.

Cases 3 to 5 assert the calls made, not only what is shown: the toast and
the output look the same with or without the fallback.
6. In 1 to 5, no toast, command output or debug log line contains `HOME`'s
   value.
7. The fallback call carries `PATH` = `<HOME>/.bun/bin:<PATH>`, or
   `<HOME>/.bun/bin` alone when `PATH` is unset.

User scenarios, tmux, `PATH` without `cogload`, `HOME` a temporary
directory holding a stub at `.bun/bin/cogload`:

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub: Heating, streak 20 | Start | `● Heating · streak 20m`; no missing toast |
| 2 | As 1 | `/cogload` | The hour's line from the stub |
| 3 | No stub | Start | The missing toast, as today |

## Boundaries

- Always: keep the first try on `PATH`; keep one 10-second timeout per try.
- Ask first: any further location, `bunx`, remembering the found path.
- Never: print, log or store a path; download or install anything.

## Definition of Done

- `claude plugin validate plugin` passes and lists `HOME` and `PATH`;
  `claude plugin test plugin` passes the existing cases and 1 to 7.
- `bun run check` passes; `git diff main -- src tests` is empty.
- User scenarios 1 to 3 pass, with captured screens in the PR.
- `plugin/.claude-plugin/plugin.json` says 0.8.0.
- README "Inside Claude Code" says the plugin also looks in `~/.bun/bin`,
  replacing the Homebrew warning; CHANGELOG `## [Unreleased]` has one entry.
