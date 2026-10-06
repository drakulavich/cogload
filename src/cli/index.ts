#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join } from "node:path";
import { openCache } from "../lib/transcripts/index.ts";
import type { Timing } from "../lib/report/index.ts";
import { HelpRequested, HINT, parseArgs, USAGE, UsageError, VersionRequested } from "./args.ts";
import { card, status, table } from "./commands.io.ts";
import { timingLines } from "./timing.ts";

// Read only when --version is handled, so a broken package.json fails inside
// the guarded catch instead of at module load.
function version(): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  if (typeof parsed === "object" && parsed !== null && typeof (parsed as { version?: unknown }).version === "string") {
    return (parsed as { version: string }).version;
  }
  throw new Error("package.json has no version");
}

function runEnv() {
  let ver = "?";
  try { ver = version(); } catch {}
  return { version: ver, bun: Bun.version, platform: process.platform, arch: process.arch, cpus: cpus().length, nowMs: performance.now() };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const now = new Date();
  const a = parseArgs(argv, now, process.env, process.stdout.isTTY === true, join(homedir(), ".claude", "projects"));
  const timing = a.verbose ? ({ startMs: performance.now() } as Timing) : undefined;
  const t = performance.now();
  const cache = a.cache ? openCache(process.env) : null;
  if (timing && a.cache) timing.openMs = performance.now() - t;
  try {
    const code = a.command === "card" ? await card(a, now, cache, timing) : a.command === "status" ? await status(a, now, cache, timing) : await table(a, now, cache, timing);
    if (timing) process.stderr.write(timingLines(timing, runEnv()));
    return code;
  } finally {
    cache?.close();
  }
}

export function start(): void {
  process.stdout.on("error", (e: NodeJS.ErrnoException) => {
    if (e.code === "EPIPE") process.exit(0);
    throw e;
  });
  // exitCode, not exit(): exit() drops output still queued for a pipe.
  main().then((code) => { process.exitCode = code; }, (e: unknown) => {
    if (e instanceof HelpRequested) { console.log(USAGE); process.exit(0); }
    if (e instanceof VersionRequested) {
      try { console.log(version()); process.exit(0); }
      catch (err) { console.error(`cogload: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof UsageError) { console.error(`cogload: ${msg}\n${HINT}`); process.exit(2); }
    console.error(`cogload: ${msg}`);
    process.exit(1);
  });
}

if (import.meta.main) start();
