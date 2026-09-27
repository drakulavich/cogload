import { constants, type Dirent } from "node:fs";
import { access, open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// What --verbose reports about the walk: transcripts seen, and how many of them
// were opened only to read the tail of a file older than the window by mtime.
export type ScanStats = { files: number; tailChecks: number };
export type ScanEntry = { path: string; dev: number; ino: number; size: number; mtimeMs: number };

// A `subagents` directory holds the parent agent's conversation, not the human's.
export async function scan(projects: string, cutoffMs: number, stats: ScanStats = { files: 0, tailChecks: 0 }): Promise<ScanEntry[]> {
  // No path in any message: the CLI never prints one. A directory that can be
  // listed but not entered (mode 444) would otherwise read as one with no activity.
  let root;
  try {
    if (!(await stat(projects)).isDirectory()) throw Object.assign(new Error("not a directory"), { code: "ENOTDIR" });
    await access(projects, constants.R_OK | constants.X_OK);
    root = await readdir(projects, { withFileTypes: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "EACCES" || code === "EPERM") throw new Error("projects directory cannot be read (check its permissions)");
    if (code === "ENOTDIR") throw new Error("projects path is not a directory (pass --projects <dir>)");
    throw new Error("projects directory not found (pass --projects <dir>)");
  }
  const out: ScanEntry[] = [];
  await collect(projects, root, cutoffMs, out, stats);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// One unreadable directory costs only itself. Symlinks are not followed: Claude
// Code never writes one, and following one is how a loop or $HOME would get in.
async function collect(dir: string, entries: Dirent[], cutoffMs: number, out: ScanEntry[], stats: ScanStats): Promise<void> {
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "subagents") continue;
      try {
        await collect(full, await readdir(full, { withFileTypes: true }), cutoffMs, out, stats);
      } catch {}
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      stats.files++;
      try {
        const st = await stat(full);
        if (st.mtimeMs < cutoffMs) {
          stats.tailChecks++;
          if ((await lastTimestampMs(full)) < cutoffMs) continue;
        }
        out.push({ path: full, dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs });
      } catch {}
    }
  }
}

// mtime can be older than the records inside (sync, restore, clock skew), so for
// a file mtime would drop, the last "timestamp" in its final 64 KB decides. 64 KB
// because the last record is often a big tool result with its timestamp in front.
const TAIL_BYTES = 65_536;
async function lastTimestampMs(path: string): Promise<number> {
  const fh = await open(path, "r");
  try {
    const size = (await fh.stat()).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const tail = buf.toString("utf8");
    let last = -Infinity;
    for (const m of tail.matchAll(/"timestamp":"([^"]{20,40})"/g)) {
      const ms = Date.parse(m[1]!);
      if (!Number.isNaN(ms)) last = ms;
    }
    return last;
  } finally {
    await fh.close();
  }
}
