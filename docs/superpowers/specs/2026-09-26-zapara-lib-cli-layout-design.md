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

### Imports: dependency-cruiser

`dependency-cruiser` becomes a devDependency, configured in
`.dependency-cruiser.cjs`, run as `bun run lint:deps` (`depcruise src tests
scripts`), and added to `bun run check` and to CI. Each rule's `comment` is
written for the agent that breaks it: what the rule protects and where the
code should go instead.

| rule | from | to | comment says |
|---|---|---|---|
| `pure-no-builtins` | `src/` files not named `*.io.ts`, except `src/cli/index.ts` | `dependencyTypes: core` | pure code takes data as arguments; move the I/O into a `*.io.ts` file |
| `cli-via-index` | `^src/cli/` | `^src/lib/[^/]+/` not ending `index.ts` | import the feature's `index.ts`, and export from it what the CLI needs |
| `feature-via-index` | `^src/lib/([^/]+)/` | `^src/lib/(?!$1)[^/]+/` not ending `index.ts` | another feature is reached through its `index.ts` |
| `outside-via-index` | `^(tests\|scripts)/` | `^src/lib/[^/]+/` not ending `index.ts` | tests and scripts use a feature's `index.ts` like any caller |
| `lib-not-cli` | `^src/lib/` | `^src/cli/` | the library never depends on the CLI |
| `no-circular` | any | `circular: true` | break the cycle by moving the shared piece down, usually into `lib/types.ts` |
| `no-orphans` | `^src/` except `src/cli/index.ts` | `orphan: true` | an unused module is deleted, not kept |

### Globals: a second typecheck

dependency-cruiser sees imports, and `Bun.WebView`, `process.env` and
`Buffer` are globals. `tsconfig.pure.json` extends the main config, sets
`"types": []` so no Bun or Node types load, and includes exactly the pure
files: `src/lib/**/*.ts` except `**/*.io.ts`, plus `src/cli/args.ts` and
`src/cli/timing.ts`. `bun run typecheck` runs `tsc --noEmit` and then
`tsc --noEmit -p tsconfig.pure.json`, so a pure file that names `Bun`,
`process` or `Buffer` fails the check. `Date.now()` stays legal to the
compiler; that rule remains a review item.

## What else moves

- `package.json`: `bin` points at `src/cli/index.ts`; `files` keeps shipping
  `src/` without tests; `scripts` gains `lint:deps`, and `check` runs
  typecheck, `lint:deps` and the tests.
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

- `bun run check` passes: both typechecks, `lint:deps` with zero violations,
  every test.
- No test assertion changes; the diff of `tests/` is file moves and import
  paths.
- `zapara card --json`, `zapara --json` and the card page (`--out card.html`)
  are the same bytes as 0.8.0 over the same projects tree and the same `--to`.
  `zapara status` reads the clock and takes no `--to`, so its tests in
  `tests/cli/` are what holds it.
- Each dependency-cruiser rule and the pure typecheck is shown to fire once:
  the plan makes one throwaway violation per rule, runs the check, and
  records the message.

## Later

A public library entry (`exports` in `package.json`) for a status line or
another tool can be added on top of the feature `index.ts` files once there
is a consumer. The `Date.now()` rule could move to a lint rule if it is ever
broken.
