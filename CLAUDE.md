# CLAUDE.md

This file holds only what an agent got wrong here and no check catches yet.
`bun run check` (typecheck, Biome, Knip, tests) enforces the layout, the pure
core and how tests import, and its messages say where code goes. When a check
starts catching a line below, delete the line. If something here surprises or
confuses you, add one line under Surprises. The design is in
`docs/superpowers/specs/`; when it and the code disagree, say so.

## Rules

- **Privacy.** No message text, prompt length, file path or title is kept,
  written or printed, and that includes an error message that echoes a flag's
  value (#3 printed the `--projects` path). Changing this needs the spec first.
- **A flag lands with its behavior.** #3 parsed `--explain` before it did
  anything. A value flag rejects a value that starts with `-`.
- **A test asserts what differs with and without the behavior it pins** (#69).
  Tests use fixtures in the real transcript format, through `analyze()`,
  `report()` or the CLI.
- **CHANGELOG at release only.** A PR leaves `CHANGELOG.md` alone and puts
  its user-facing line in the PR body; the release PR collects them. PRs that
  each added a line under `### Fixed` conflicted in turn (#160 to #163).

## Surprises

- A PTY merges stdout and stderr. To test one stream in a terminal, send the
  other elsewhere with `runHalfTerminal` (`tests/cli/card-cli.test.ts`).
- Every `claude --plugin-dir` run shares one plugin store (`<name>@inline`),
  so a scenario inherits the last run's rest and `phrase`. Start each with
  `CLAUDE_CODE_PLUGIN_CACHE_DIR=$(mktemp -d)`.
