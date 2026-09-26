# zapara layout: a library of features and a thin CLI

Extends `2026-09-17-zapara-design.md`. Everything not mentioned here stays as
that spec says. Nothing a user can see changes: the same flags, the same
output bytes, the same files written.

## Purpose

zapara is changed mostly by coding agents. An agent pays for every file it
opens, so the cost of a change is the number of lines it has to read before it
knows where the change goes and what it may touch. Today `src/` is sixteen
files side by side. `src/index.ts` alone mixes the usage text, argument and
date parsing, three commands, the `--verbose` lines and the exit codes, and
the rules that keep the core pure live only in prose.

After this change an agent that changes the card reads `src/lib/card/`. One
that adds a metric reads `src/lib/metrics/` and `src/lib/text/`, and one that
adds a flag reads `src/cli/args.ts`. A boundary it crosses by mistake
fails `bun run check` with a message that names the rule. It does not have to
read the rules first to follow them.

zapara stays a CLI. The library is an internal layer with no public API, no
`exports` field and no semver promise to anyone but the CLI.

## Layout

```
src/
  cli/
    index.ts          the bin: main() and the map from errors to exit codes
    args.ts           USAGE, HINT, Args, the usage errors, parseArgs(argv, now, env, isTTY)
    timing.ts         the --verbose lines
    commands.io.ts    grid and day tables, status, card
  lib/
    types.ts          Event, EventKind, Day, HourBucket, LiveBucket, Metrics, Totals, Window, Transcript
    transcripts/      index.ts, parse.ts, scan.io.ts, cache.io.ts
    metrics/          index.ts, derive.ts, score.ts, analyze.ts
    report/           index.ts, report.io.ts
    text/             index.ts, render.ts, format.ts
    card/             index.ts, card.ts, cardhtml.ts, image.io.ts
    status/           index.ts, status.ts, statusfile.io.ts
tests/
  cli/  metrics/  card/  text/  status/  report/  helpers/  fixtures/
```

Where each current file goes:

| now | after |
|---|---|
| `src/index.ts` | `src/cli/index.ts`, `args.ts`, `timing.ts`, `commands.io.ts` |
| `src/types.ts` | `src/lib/types.ts` |
| `src/parse.ts`, `scan.ts`, `cache.ts` | `src/lib/transcripts/parse.ts`, `scan.io.ts`, `cache.io.ts` |
| `src/derive.ts`, `score.ts`, `analyze.ts` | `src/lib/metrics/` |
| `src/report.ts` | `src/lib/report/report.io.ts` |
| `src/render.ts`, `format.ts` | `src/lib/text/` |
| `src/card.ts`, `cardhtml.ts`, `image.ts` | `src/lib/card/card.ts`, `cardhtml.ts`, `image.io.ts` |
| `src/status.ts`, `statusfile.ts` | `src/lib/status/status.ts`, `statusfile.io.ts` |
| `src/score.test.ts` | `tests/metrics/score.test.ts` |

Two naming rules carry the design:

- A file named `*.io.ts` may touch the world: the file system, the clock,
  the environment, `Bun`, `process`. Every other file under `src/lib/` and
  `src/cli/args.ts`, `src/cli/timing.ts` is pure.
- A feature's `index.ts` is its only door. It re-exports what other features,
  the CLI, scripts and tests use, and nothing else. `lib/types.ts` is shared
  by all features and imported directly.

The functions themselves do not change. Where a function moves with a new
parameter, it is to make it pure: `timingLines` takes the zapara version,
Bun version, platform, arch and CPU count as an argument instead of reading
them.

## Checked by machine

`bun run lint` runs Biome and then Knip over `src`, `tests` and `scripts`,
and `bun run check` runs it between the typecheck and the tests, as CI does.
Neither tool uses the TypeScript compiler API, which TypeScript 7.0 does not
ship. Each rule carries a `message` written for the agent that breaks it:
what the rule protects and where the code should go instead.

### Biome

`biome.json` turns off every rule except these, with `overrides` choosing
the files each one applies to:

| rule | in | forbids | message says |
|---|---|---|---|
| `noNodejsModules` | pure files | `node:` imports | pure code takes data as arguments; move the I/O into a `*.io.ts` file |
| `noRestrictedGlobals` | pure files | `Bun`, `process`, `Buffer` | the same |
| `noRestrictedImports` | pure files | `bun` and `bun:*` imports | the same |
| `noRestrictedImports` | `src/lib/` | `../<feature>/<file>.ts` other than `index.ts` | another feature is reached through its `index.ts` |
| `noRestrictedImports` | `src/lib/` | anything under `cli/` | the library never depends on the CLI |
| `noRestrictedImports` | `src/cli/` | `../lib/<feature>/<file>.ts` other than `index.ts` | import the feature's `index.ts`, and export from it what the CLI needs |
| `noRestrictedImports` | `tests/`, `scripts/` | `src/lib/<feature>/<file>.ts` other than `index.ts` | tests and scripts use a feature's `index.ts` like any caller |
| `noImportCycles` | everywhere, type-only imports included | a cycle | break it by moving the shared piece down, usually into `lib/types.ts` |

Pure files are `src/lib/**/*.ts` except `**/*.io.ts`, plus
`src/cli/args.ts` and `src/cli/timing.ts`. Import patterns match the
specifier as written, so they rely on the layout: a feature's own files
import each other with `./`, and a sibling feature is always `../<feature>/`.
`Date.now()` stays legal to the linter; that rule remains a review item.

### Knip

`knip.json` names the entry points (the `bin` from `package.json`, every
file under `scripts/` and `tests/`) and the project files (`src/**/*.ts`).
`knip --include files` fails on a file under `src/` that no entry point
reaches, since an unused module is deleted, not kept.

## What else moves

- `package.json`: `bin` points at `src/cli/index.ts`; `files` keeps shipping
  `src/` without tests; `scripts` gains `lint`, and `check` runs
  typecheck, `lint` and the tests.
- The cache fingerprint in `cache.io.ts` reads `lib/transcripts/parse.ts`
  and `lib/types.ts`. If the move changes either file's bytes (an import
  path is enough), the first run after it reparses every transcript once.
- `scripts/card-golden.ts` and `scripts/signal-stats.ts` import through the
  feature `index.ts` files.
- Tests move into folders that mirror the features, change only their import
  paths, and keep every assertion. `tests/shell/` becomes `tests/cli/` for the
  CLI tests; `report.test.ts` goes to `tests/report/`.
- The base spec's Architecture section is rewritten for this layout. The
  status-file, card and cache specs keep their text; their file names are
  historical.

`CLAUDE.md` is out of scope for this change. After it, `CLAUDE.md` still
names the old files in its functional-core rule and still says `typescript`
is the only devDependency; that is known and left for a separate change.

## Acceptance

- `bun run check` passes: the typecheck, `lint` with no errors,
  every test.
- No test assertion changes; the diff of `tests/` is file moves and import
  paths.
- `zapara card --json`, `zapara --json` and the card page (`--out card.html`)
  are the same bytes as 0.8.0 over the same projects tree and the same `--to`.
  `zapara status` reads the clock and takes no `--to`, so its tests in
  `tests/cli/` are what holds it.
- Each Biome rule and the Knip check is shown to fire once:
  the plan makes one throwaway violation per rule, runs the check, and
  records the message.

## Later

A public library entry (`exports` in `package.json`) for a status line or
another tool can be added on top of the feature `index.ts` files once there
is a consumer. The `Date.now()` rule could move to a lint rule if it is ever
broken.
