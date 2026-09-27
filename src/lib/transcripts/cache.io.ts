// The only module that uses bun:sqlite or writes the cache. The transcripts are
// the system of record: every doubt here resolves to a miss, and no error leaves.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { ScanEntry } from "./scan.io.ts";
import type { Event, EventKind } from "../types.ts";

export type Fresh = { entry: ScanEntry; tail: Uint8Array; fromMs: number; events: Event[] };
export type TranscriptCache = {
  // null: the cache failed and is off for this run.
  hits(entries: ScanEntry[], cutoffMs: number): Promise<Map<string, Event[]> | null>;
  save(hit: ScanEntry[], fresh: Fresh[], nowMs: number): void;
  close(): void;
};

const USER_VERSION = 1;
const TAIL_BYTES = 4096;
const READERS = 16;
const KEEP_MS = 90 * 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: Record<EventKind, true> = { prompt: true, report: true, output: true, interrupt: true, reject: true, answer: true, question: true, plan_review: true, mode_change: true, activity: true };

export function tailHash(bytes: Uint8Array): Uint8Array {
  return createHash("sha256").update(bytes.subarray(Math.max(0, bytes.length - TAIL_BYTES))).digest();
}

function fingerprint(): Uint8Array {
  const h = createHash("sha256");
  h.update(readFileSync(new URL("./parse.ts", import.meta.url)));
  h.update(readFileSync(new URL("../types.ts", import.meta.url)));
  h.update(String((JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: unknown }).version));
  return h.digest();
}

function encode(events: Event[]): Uint8Array {
  const sessions: string[] = [];
  const index = new Map<string, number>();
  const rows = events.map((e) => {
    let i = index.get(e.sessionId);
    if (i === undefined) { i = sessions.length; index.set(e.sessionId, i); sessions.push(e.sessionId); }
    return e.tokens === undefined ? [e.ts, e.kind, i] : [e.ts, e.kind, i, e.tokens];
  });
  return new TextEncoder().encode(JSON.stringify({ sessions, events: rows }));
}

function decode(blob: Uint8Array): Event[] | null {
  try {
    const d: unknown = JSON.parse(new TextDecoder().decode(blob));
    if (typeof d !== "object" || d === null) return null;
    const { sessions, events } = d as { sessions?: unknown; events?: unknown };
    if (!Array.isArray(sessions) || !sessions.every((s) => typeof s === "string") || !Array.isArray(events)) return null;
    const out: Event[] = [];
    for (const r of events) {
      if (!Array.isArray(r) || r.length < 3 || r.length > 4) return null;
      const [ts, kind, i, tokens] = r as unknown[];
      if (typeof ts !== "number" || typeof kind !== "string" || !Object.hasOwn(KINDS, kind) || typeof i !== "number" || sessions[i] === undefined) return null;
      const e: Event = { ts, sessionId: sessions[i] as string, kind: kind as EventKind };
      if (r.length === 4) {
        if (kind !== "output" || typeof tokens !== "number") return null;
        e.tokens = tokens;
      }
      out.push(e);
    }
    return out;
  } catch {
    return null;
  }
}

// The bytes just before the stored offset, like a log consumer's check; the
// size comparison is what notices a file that grew.
async function readTail(path: string, size: number): Promise<Uint8Array | null> {
  try {
    const fh = await open(path, "r");
    try {
      const n = Math.min(TAIL_BYTES, size);
      const buf = new Uint8Array(n);
      const { bytesRead } = await fh.read(buf, 0, n, size - n);
      return bytesRead === n ? buf : null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

type Row = { dev: number; ino: number; size: number; mtime_ms: number; tail: Uint8Array; from_ms: number; events: Uint8Array };

class Foreign extends Error {}

// Only a file that is not ours is replaced; a locked or unopenable one is left alone.
const replaceable = (e: unknown): boolean =>
  e instanceof Foreign || /^SQLITE_(NOTADB|CORRUPT)/.test(String((e as { code?: unknown } | null)?.code));

// Modes are set on what zapara creates; a mode the person set later is theirs.
function connect(path: string): Database {
  // Made 0600 before SQLite sees it: SQLite would create it 0644 less the
  // umask, and gives -wal and -shm the database file's mode.
  let created = false;
  try {
    closeSync(openSync(path, "wx", 0o600));
    created = true;
  } catch (e) {
    if ((e as { code?: unknown }).code !== "EEXIST") throw e;
  }
  const db = new Database(path, { create: true, strict: true });
  try {
    if (created) chmodSync(path, 0o600);
    db.run("PRAGMA busy_timeout = 2000");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.transaction(() => {
      const { user_version } = db.query<{ user_version: number }, []>("PRAGMA user_version").get()!;
      if (user_version === USER_VERSION) return;
      if (user_version !== 0) throw new Foreign();
      db.run(`CREATE TABLE transcript (
        dev INTEGER NOT NULL, ino INTEGER NOT NULL, parser BLOB NOT NULL, size INTEGER NOT NULL, mtime_ms REAL NOT NULL,
        tail BLOB NOT NULL, from_ms REAL NOT NULL, used_at INTEGER NOT NULL, events BLOB NOT NULL, PRIMARY KEY (dev, ino))`);
      db.run(`PRAGMA user_version = ${USER_VERSION}`);
    }).immediate();
    return db;
  } catch (e) {
    try { db.close(); } catch {}
    throw e;
  }
}

export function openCache(env: NodeJS.ProcessEnv): TranscriptCache | null {
  const home = env.HOME;
  if (!home) return null;
  try {
    const parser = fingerprint();
    // No process-wide umask: it would also narrow the card this run writes.
    // Each directory is chmodded the moment it is made, so a restrictive umask
    // cannot leave a parent the next level cannot be made in; `connect`
    // creates the database 0600 itself, and SQLite gives its WAL files the
    // database's mode.
    const dir = join(home, ".claude", "zapara");
    // An existing directory keeps the mode it has.
    for (const d of [join(home, ".claude"), dir]) {
      try {
        mkdirSync(d, { mode: 0o700 });
        chmodSync(d, 0o700);
      } catch (e) {
        if ((e as { code?: unknown }).code !== "EEXIST") throw e;
      }
    }
    const path = join(dir, "cache.db");
    try {
      return cacheOn(connect(path), parser, path);
    } catch (e) {
      if (!replaceable(e)) return null;
    }
    remove(path);
    return cacheOn(connect(path), parser, path);
  } catch {
    return null;
  }
}

const remove = (path: string): void => { for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true }); };

const fileId = (path: string): string | null => { try { const s = statSync(path); return `${s.dev}:${s.ino}`; } catch { return null; } };

// A file found corrupt only once it is queried (the header was fine) is
// replaced like one that fails to open, once; this run then misses every file.
function cacheOn(db: Database, parser: Uint8Array, path: string): TranscriptCache {
  let failed = false;
  const opened = fileId(path);
  // Rows whose events did not decode: the conditional upsert would keep them.
  const broken: { dev: number; ino: number }[] = [];
  return {
    async hits(entries, cutoffMs) {
      const found = new Map<string, Event[]>();
      try {
        const keyed = entries.filter((e) => e.ino !== 0);
        const rows = db.query<Row, [Uint8Array, string]>(
          `SELECT dev, ino, size, mtime_ms, tail, from_ms, events FROM transcript
           WHERE parser = ? AND (dev, ino) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))`,
        ).all(parser, JSON.stringify(keyed.map((e) => [e.dev, e.ino])));
        const byKey = new Map(rows.map((r) => [`${r.dev}:${r.ino}`, r]));
        const candidates = keyed.flatMap((entry) => {
          const row = byKey.get(`${entry.dev}:${entry.ino}`);
          return row && row.size === entry.size && row.mtime_ms === entry.mtimeMs && row.from_ms <= cutoffMs ? [{ entry, row }] : [];
        });
        let next = 0;
        const reader = async (): Promise<void> => {
          while (next < candidates.length) {
            const { entry, row } = candidates[next++]!;
            const tail = await readTail(entry.path, row.size);
            if (tail === null || !equal(tailHash(tail), row.tail)) continue;
            const events = decode(row.events);
            if (events !== null) found.set(entry.path, events);
            else broken.push({ dev: row.dev, ino: row.ino });
          }
        };
        await Promise.all(Array.from({ length: Math.min(READERS, candidates.length) }, reader));
      } catch (e) {
        found.clear();
        broken.length = 0;
        if (!replaceable(e)) { failed = true; return null; }
        try { db.close(); } catch {}
        try {
          // Only the file this run opened: a different one at the path is
          // another run's fresh cache. Unlinking a file another run still has
          // open is fine for a cache: its descriptors stay valid, its writes are lost.
          if (opened !== null && fileId(path) === opened) remove(path);
          db = connect(path);
        } catch {
          failed = true;
          return null;
        }
      }
      return found;
    },

    save(hit, fresh, nowMs) {
      if (failed) return;
      try {
        const upsert = db.query(
          `INSERT INTO transcript (dev, ino, parser, size, mtime_ms, tail, from_ms, used_at, events)
           VALUES ($dev, $ino, $parser, $size, $mtime, $tail, $from, $now, $events)
           ON CONFLICT(dev, ino) DO UPDATE SET parser = excluded.parser, size = excluded.size, mtime_ms = excluded.mtime_ms,
             tail = excluded.tail, from_ms = excluded.from_ms, used_at = excluded.used_at, events = excluded.events
           WHERE NOT (transcript.parser = excluded.parser AND transcript.size = excluded.size
                      AND transcript.mtime_ms = excluded.mtime_ms AND transcript.tail = excluded.tail
                      AND transcript.from_ms <= excluded.from_ms)`,
        );
        const touch = db.query("UPDATE transcript SET used_at = $now WHERE dev = $dev AND ino = $ino");
        const drop = db.query("DELETE FROM transcript WHERE dev = $dev AND ino = $ino");
        db.transaction(() => {
          for (const k of broken) drop.run(k);
          for (const { entry: e, tail, fromMs, events } of fresh) {
            if (e.ino === 0 || !events.every((ev) => UUID.test(ev.sessionId))) continue;
            upsert.run({ dev: e.dev, ino: e.ino, parser, size: e.size, mtime: e.mtimeMs, tail, from: fromMs, now: nowMs, events: encode(events) });
          }
          for (const e of hit) if (e.ino !== 0) touch.run({ now: nowMs, dev: e.dev, ino: e.ino });
          db.run("DELETE FROM transcript WHERE used_at < ?", [nowMs - KEEP_MS]);
        }).immediate();
      } catch {}
    },

    close() {
      try { db.close(); } catch {}
    },
  };
}
