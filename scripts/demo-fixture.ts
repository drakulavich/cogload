#!/usr/bin/env bun
// Builds the sandbox the README screencast is recorded in: a directory holding a
// `bin/cogload` that runs this checkout against `tests/fixtures/busy-week` and nothing
// else. Every number on screen therefore comes from the synthetic fixture, never from
// a real transcript, which is what makes the recording publishable. The full recipe,
// including the WebP step and the budgets, is in the header of assets/demo.tape. Usage:
//
//   bun scripts/demo-fixture.ts            # a fresh directory under the system temp dir
//   bun scripts/demo-fixture.ts <dir>      # a directory of your choosing; see below
//   DIR=$(bun scripts/demo-fixture.ts) && PATH="$DIR/bin:$PATH" TZ=UTC vhs assets/demo.tape
//
// <dir> must not exist yet. The script never deletes anything: a typo such as $HOME must
// not be wiped, and no marker file could make that safe, since a marker can be planted.
//
// The only thing printed on stdout is the directory, so the line above can capture it.
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assistantText, interrupt, mode, nextRequestId, prompt, question, writeTree } from "../tests/helpers/transcript.ts";

// Double-quoted for bash, so a path with spaces still runs; the four characters that
// keep their meaning inside double quotes are escaped.
const shellQuote = (s: string) => `"${s.replace(/[\\$"`]/g, (c) => `\\${c}`)}"`;

const root = resolve(import.meta.dir, "..");

let dir: string;
if (process.argv[2] === undefined) {
  dir = mkdtempSync(join(tmpdir(), "cogload-demo-"));
} else {
  dir = resolve(process.argv[2]);
  if (existsSync(dir)) {
    console.error(`refusing to touch ${dir}: it already exists. Pick a new directory, or run without an argument.`);
    process.exit(1);
  }
  mkdirSync(dir, { recursive: true });
}
mkdirSync(join(dir, "bin"), { recursive: true });

// The projects root is a copy, not the fixture itself, because one session is added to
// it: `cogload status` always reads today, and the fixture's week is fixed in September
// 2026, so on the fixture alone the status step would record a row of nulls. The copy
// keeps every other step's numbers identical, since the recording's window ends at
// 2026-09-20 and never reaches today.
const projects = join(dir, "projects");
cpSync(join(root, "tests", "fixtures", "busy-week", "projects"), projects, { recursive: true });

// Two sessions over the last fifty minutes, the last action four minutes ago, so the
// streak is live when the recording is made right after this script. Synthetic like
// everything else here: no real transcript is ever read.
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const today = new Date(now).toISOString().slice(0, 10);
const a = [mode(A, "auto")];
for (let m = 48; m >= 4; m -= 4) {
  a.push(prompt(ago(m), A));
  a.push(assistantText(ago(m - 1), A, 1500, nextRequestId()));
}
a.push(interrupt(ago(20), A));
a.push(question(ago(10), A));
const b = [mode(B, "auto")];
for (let m = 46; m >= 6; m -= 8) {
  b.push(prompt(ago(m), B));
  b.push(assistantText(ago(m - 1), B, 1500, nextRequestId()));
}
await writeTree(projects, [
  { path: `-Users-me-proj-today-a/${today}-${A}.jsonl`, lines: a, mtime: ago(4) },
  { path: `-Users-me-proj-today-b/${today}-${B}.jsonl`, lines: b, mtime: ago(6) },
]);

// The trailing --projects wins whatever the tape types, and the CLI accepts flags in any
// position, so `cogload 2026-09-14 --explain` in the recording reads the fixture. HOME is
// the sandbox too, because `cogload status` writes `$HOME/.claude/cogload/status.json`:
// without this, recording the status step would overwrite the status line of whoever is
// recording, with a snapshot of a day the fixture knows nothing about.
const wrapper = `#!/bin/bash\nexec env HOME=${shellQuote(dir)} bun ${shellQuote(join(root, "src", "cli", "index.ts"))} "$@" --projects ${shellQuote(projects)}\n`;
writeFileSync(join(dir, "bin", "cogload"), wrapper);
chmodSync(join(dir, "bin", "cogload"), 0o755);

console.log(dir);
