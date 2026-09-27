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

## Surprises

- A PTY merges stdout and stderr. To test one stream in a terminal, send the
  other elsewhere with `runHalfTerminal` (`tests/cli/card-cli.test.ts`).
- Under a full `bun test`, a WebView test can hit its 15 s timeout. Rerun that
  file alone before debugging it.
