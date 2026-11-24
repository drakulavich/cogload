#!/usr/bin/env bun
// The share of the person's own actions made at four or more active sessions, for the month's check of the
// active-sessions warning (docs/superpowers/specs/2026-11-24-cogload-active-sessions-warning-design.md). Numbers only.
// usage: bun run crowded-share [days, default 28]
import { homedir } from "node:os";
import { join } from "node:path";
import { activeSessions, dropCopies, PRESENCE } from "../src/lib/metrics/index.ts";
import { parseTranscript, scan } from "../src/lib/transcripts/index.ts";

const days = Number(process.argv[2] ?? 28);
if (!Number.isInteger(days) || days < 1) {
  console.error("days must be a whole number from 1");
  process.exit(2);
}
const now = Date.now();
const from = now - days * 24 * 60 * 60 * 1000;
const files = await scan(join(homedir(), ".claude", "projects"), from);
let skipped = 0;
const parsed = await Promise.all(
  files.map(async (f) => {
    try {
      return parseTranscript(await Bun.file(f.path).text(), from);
    } catch {
      skipped++;
      return [];
    }
  }),
);
const own = dropCopies(parsed.flat())
  .filter((e) => PRESENCE.has(e.kind) && e.ts >= from && e.ts <= now)
  .sort((a, b) => a.ts - b.ts);
const crowded = own.filter((e) => activeSessions(own, e.ts).sessions >= 4).length;
const share = own.length === 0 ? "no actions" : `${Math.round((crowded / own.length) * 100)}%`;
console.log(`${days} days: ${crowded} of ${own.length} actions at 4+ sessions, ${share} (${files.length} files, ${skipped} skipped)`);
