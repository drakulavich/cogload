import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { report } from "../../src/lib/report/index.ts";
import { bigToolResult, prompt, writeTree } from "../helpers/transcript.ts";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-1111-4111-8111-111111111111";
const C = "cccccccc-1111-4111-8111-111111111111";
const D = "dddddddd-1111-4111-8111-111111111111";

// window to="2026-09-14" days=1 → local midnight of 2026-09-14 (TZ=UTC) minus
// the 3h look-back = 2026-09-13T21:00:00.000Z; every fixture below is built
// against that fixed cutoff.
async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "zapara-report-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("report", () => {
  test("a subagents/ tree is ignored, a same-named file at the root counts, and a .txt file is ignored", async () => {
    await withTempDir(async (dir) => {
      await writeTree(dir, [
        { path: "proj-a/normal.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A)], mtime: "2026-09-14T13:00:00.000Z" },
        { path: "proj-a/session/subagents/agent-1.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", B)], mtime: "2026-09-14T13:00:00.000Z" },
        { path: "subagents-not-a-dir.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", C)], mtime: "2026-09-14T13:00:00.000Z" },
        // A real, in-window prompt line, so this only stays excluded because of
        // the extension filter: if scan() ever stopped filtering by ".jsonl",
        // this file's prompt would raise the count below and catch it.
        { path: "proj-b/notes.txt", lines: [prompt("2026-09-14T13:00:00.000Z", D)], mtime: "2026-09-14T13:00:00.000Z" },
      ]);
      const days = await report({ projects: dir, to: "2026-09-14", days: 1 });
      // 2, not 3 or 1: the subagents/ tree and the .txt file are both excluded;
      // normal.jsonl and the root-level subagents-not-a-dir.jsonl both count.
      expect(days[0]!.totals.prompts).toBe(2);
    });
  });

  test("a file is chosen by its records, not its mtime: an old mtime with an in-window record counts, a file with no in-window record adds nothing", async () => {
    await withTempDir(async (dir) => {
      await writeTree(dir, [
        // Restored or synced: mtime says August, but the last record is inside
        // the window, so the tail check keeps it.
        { path: "proj/restored.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A)], mtime: "2026-08-01T00:00:00.000Z" },
        // Genuinely old: mtime and the only record both before the window.
        { path: "proj/old.jsonl", lines: [prompt("2026-08-01T13:00:00.000Z", B)], mtime: "2026-08-01T00:00:00.000Z" },
      ]);
      const days = await report({ projects: dir, to: "2026-09-14", days: 1 });
      expect(days[0]!.totals.prompts).toBe(1); // only restored.jsonl; old.jsonl has no in-window record
    });
  });

  test("an old mtime is still rescued when the last record is a 12 KB tool result", async () => {
    await withTempDir(async (dir) => {
      await writeTree(dir, [
        // Synced from another machine, and the conversation ended on a big file
        // read: the last record's own timestamp sits 12 KB from the end of the
        // file, far past the first few kilobytes.
        { path: "proj/bigtail.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A), bigToolResult("2026-09-14T13:05:00.000Z", A, 12_000)], mtime: "2026-08-01T00:00:00.000Z" },
      ]);
      const days = await report({ projects: dir, to: "2026-09-14", days: 1 });
      expect(days[0]!.totals.prompts).toBe(1);
    });
  });

  test("an unreadable file is skipped, not fatal", async () => {
    if (process.getuid?.() === 0) return; // root bypasses file permissions; chmod 0o000 would have no effect
    await withTempDir(async (dir) => {
      const secret = join(dir, "proj/secret.jsonl");
      await writeTree(dir, [
        { path: "proj/a.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A)], mtime: "2026-09-14T13:00:00.000Z" },
        { path: "proj/secret.jsonl", lines: [prompt("2026-09-14T13:05:00.000Z", B), prompt("2026-09-14T13:06:00.000Z", B)], mtime: "2026-09-14T13:05:00.000Z" },
      ]);
      await chmod(secret, 0o000);
      try {
        const days = await report({ projects: dir, to: "2026-09-14", days: 1 });
        expect(days[0]!.totals.prompts).toBe(1); // only the readable file; the unreadable one is skipped
      } finally {
        await chmod(secret, 0o644).catch(() => {});
      }
    });
  });

  test("a missing projects root rejects without printing the path", async () => {
    await withTempDir(async (dir) => {
      await expect(report({ projects: join(dir, "nope"), to: "2026-09-14", days: 1 }))
        .rejects.toThrow("projects directory not found (pass --projects <dir>)");
    });
  });

  test("a non-directory projects root rejects the same way", async () => {
    await withTempDir(async (dir) => {
      await writeTree(dir, [{ path: "notadir.txt", lines: ["x"], mtime: "2026-09-14T13:00:00.000Z" }]);
      await expect(report({ projects: join(dir, "notadir.txt"), to: "2026-09-14", days: 1 }))
        .rejects.toThrow("projects directory not found (pass --projects <dir>)");
    });
  });
});
