import { open } from "node:fs/promises";
import { analyzeEvents, windowBounds } from "../metrics/index.ts";
import { tailHash, type Fresh, type TranscriptCache, parseTranscript, scan, type ScanEntry, type ScanStats } from "../transcripts/index.ts";
import type { Day, Event } from "../types.ts";

export type ReportOptions = { projects: string; to: string; days: number; now?: Date };
// What --verbose prints about a run: counts and milliseconds, never a path.
export type Timing = ScanStats & { inWindow: number; read: number; bytes: number; cache: { hits: number; misses: number } | null; startMs?: number; openMs?: number; scanMs: number; lookupMs: number; readMs: number; analyzeMs: number; saveMs: number; render?: { format: string; ms: number }; writeMs?: number; totalMs?: number };

// Reading one file at a time left the disk idle between files: 1.6 GB took 5.4 s
// sequentially and 0.9 s in parallel. The cap keeps open files well under the limit.
export const READERS = 16;

type Read = { bytes: Buffer; stable: ScanEntry | null };

// `stable` only when both fstat agree and every byte was read: a file written
// during the read is used for this run and never cached.
async function readWhole(entry: ScanEntry): Promise<Read> {
  const fh = await open(entry.path, "r");
  try {
    const before = await fh.stat();
    const bytes = await fh.readFile();
    const after = await fh.stat();
    const same = before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.size === bytes.length;
    return { bytes, stable: same ? { path: entry.path, dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs } : null };
  } finally {
    await fh.close();
  }
}

export async function report(o: ReportOptions, timing?: Timing, cache?: TranscriptCache | null): Promise<Day[]> {
  const window = { to: o.to, days: o.days, now: o.now };
  const { cutoffMs } = windowBounds(window);
  const stats: ScanStats = { files: 0, tailChecks: 0 };
  let t = performance.now();
  const entries = await scan(o.projects, cutoffMs, stats);
  const scanMs = performance.now() - t;
  t = performance.now();
  const hits = cache ? await cache.hits(entries, cutoffMs) : new Map<string, Event[]>();
  const lookupMs = performance.now() - t;
  t = performance.now();
  const misses = entries.filter((e) => !hits.has(e.path));
  const reads = new Map<string, Read>();
  let next = 0;
  let bytes = 0;
  const reader = async (): Promise<void> => {
    while (next < misses.length) {
      const entry = misses[next++]!;
      try {
        const r = await readWhole(entry);
        bytes += r.bytes.length;
        reads.set(entry.path, r);
      } catch { /* vanished or unreadable: skip */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(READERS, misses.length) }, reader));
  const readMs = performance.now() - t;
  t = performance.now();
  const fresh: Fresh[] = [];
  const events = entries.flatMap((e) => {
    const hit = hits.get(e.path);
    if (hit) return hit;
    const r = reads.get(e.path);
    if (!r) return [];
    const parsed = parseTranscript(r.bytes.toString("utf8"), cutoffMs);
    if (r.stable) fresh.push({ entry: r.stable, tail: tailHash(r.bytes), fromMs: cutoffMs, events: parsed });
    return parsed;
  });
  const days = analyzeEvents(events, window);
  const analyzeMs = performance.now() - t;
  t = performance.now();
  cache?.save(entries.filter((e) => hits.has(e.path)), fresh, Date.now());
  const saveMs = performance.now() - t;
  if (timing) Object.assign(timing, { ...stats, inWindow: entries.length, read: reads.size, bytes, cache: cache ? { hits: hits.size, misses: misses.length } : null, scanMs, lookupMs, readMs, analyzeMs, saveMs });
  return days;
}
