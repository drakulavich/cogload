#!/usr/bin/env bun
// The share of the person's own actions made at four or more active sessions, for the month's check of the
// active-sessions warning (docs/superpowers/specs/2026-11-24-cogload-active-sessions-warning-design.md). Numbers only.
// usage: bun run crowded-share [days, default 28]
import { homedir } from "node:os";
import { join } from "node:path";
import { ACTIVE_MS, activeSessions, dropCopies, PRESENCE } from "../src/lib/metrics/index.ts";
import { parseTranscript, scan } from "../src/lib/transcripts/index.ts";

const days = Number(process.argv[2] ?? 28);
if (!Number.isInteger(days) || days < 1) {
  console.error("days must be a whole number from 1");
  process.exit(2);
}
const now = Date.now();
const from = now - days * 24 * 60 * 60 * 1000;
// An action in the window's first half hour counts the sessions before it.
const readFrom = from - ACTIVE_MS;
const files = await scan(join(homedir(), ".claude", "projects"), readFrom);
let skipped = 0;
const parsed = await Promise.all(
  files.map(async (f) => {
    try {
      return parseTranscript(await Bun.file(f.path).text(), readFrom);
    } catch {
      skipped++;
      return [];
    }
  }),
);
const own = dropCopies(parsed.flat())
  .filter((e) => PRESENCE.has(e.kind) && e.ts >= readFrom && e.ts <= now)
  .sort((a, b) => a.ts - b.ts);
const counted = own.filter((e) => e.ts >= from);
const crowded = counted.filter((e) => activeSessions(own, e.ts).activeSessions >= 4).length;
const share = counted.length === 0 ? "no actions" : `${Math.round((crowded / counted.length) * 100)}%`;
console.log(`${days} days: ${crowded} of ${counted.length} actions at 4+ sessions, ${share} (${files.length} files, ${skipped} skipped)`);
