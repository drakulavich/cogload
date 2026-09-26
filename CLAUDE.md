# CLAUDE.md

Project rules for every coding agent working here. The design is in
`docs/superpowers/specs/2026-09-17-zapara-design.md`; when this file and the
spec disagree, say so instead of picking one. Below the rules is the list of
mistakes actually made in this repo that nothing yet prevents; a line leaves
when a test or CI step comes to catch it.

## Rules

- **Bun runs the TypeScript directly.** No build step, no `dist/`, no bundler.
  `bin` points at `src/cli/index.ts` with a `#!/usr/bin/env bun` shebang. The
  devDependencies are `typescript` for `bun run typecheck`, and Biome and Knip
  for `bun run lint`. No runtime dependencies.
- **Releases go through `npm-publish.yml` only.** On `main`, bump `version`
  in `package.json` and move the CHANGELOG's Unreleased entries under
  `## [X.Y.Z]`, then push the tag `vX.Y.Z`. The workflow re-runs the check,
  publishes with OIDC provenance and creates the GitHub release from that
  block, and refuses anything that does not line up. Never publish from a
  laptop.
- **Functional core, imperative shell.** The library is `src/lib/<feature>/`,
  the command line is `src/cli/`. Only files named `*.io.ts` and
  `src/cli/index.ts` touch argv, stdout, the environment, the file system or
  the clock; everything else is pure functions over plain data. Callers reach
  a feature only through its `index.ts`; `src/lib/types.ts` is imported
  directly. `bun run lint` enforces this, and each message says where the code
  goes instead. What it does not check: `card/image.io.ts` is the only file
  that may use `Bun.WebView` or `Bun.Image`, read the card assets or start
  another program (the opener that shows the card); `transcripts/cache.io.ts`
  is the only one that may use `bun:sqlite`, and it reads `parse.ts` and
  `../types.ts` to fingerprint the parser. Three files write to disk:
  `card/image.io.ts` (the card, and its page in a temporary directory it
  removes), `status/statusfile.io.ts` (the status file) and
  `transcripts/cache.io.ts` (the transcript cache). `analyze()` takes
  transcript text already in memory and a window with an explicit `now`, and
  returns the `Day[]` the CLI prints. `Date.now()` in a pure file is a bug the
  linter does not catch.
- **Tests are fixture-driven, in the real transcript format.** A test builds or
  loads transcripts (in memory for `analyze()`, or a projects tree on disk for
  the CLI) shaped exactly like Claude Code writes them (`type`, `timestamp`, `sessionId`, `isMeta`, `isSidechain`,
  `message.content` blocks, `permission-mode` records, `<session>/subagents/`),
  runs the pipeline through `analyze()`, `report()` or the CLI, and asserts the
  statistics that come out. Edge cases and negative cases (malformed lines,
  subagent trees, mtime cutoffs, missing roots) are fixtures too. Tests import
  only a feature's `index.ts` and `src/lib/types.ts`, and never parse or scan
  on their own; refactoring internals must not touch a test. Unit tests are the exception, not the norm: `score.test.ts` is the one
  allowed, because a formula table reads better than a fixture.
- **Follow Kent Beck's Test Desiderata**: behavioral, structure-insensitive,
  deterministic, fast, readable, specific. A failure must name the behavior
  that broke, not the function that changed. Fixed `--to` and `now`, `TZ=UTC`,
  explicit mtimes.
- **A test asserts what differs with and without the behavior it pins.** A test
  that would still pass without that behavior is a bug.
- **Never print a stack trace.** The CLI prints one line to stderr and exits 1,
  or one line plus a hint to --help and exits 2. A bad transcript line, an
  unreadable file or a broken directory is skipped, never fatal.
- **Privacy contract.** Message text is compared against fixed markers and
  discarded. No text, prompt length, file path or title is kept, written or
  printed. A change to this needs the spec updated first.
- **Index weights and norms live in one constant in `src/lib/metrics/score.ts`.** Calibration
  is one diff there plus a CHANGELOG line. The card's ranking norms
  (`CARD_NORMS` in `src/lib/card/card.ts`) order highlights on a picture and never enter
  the index.

## Mistakes made here

(none yet)
