import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantText, prompt, teammate, writeTree } from "../helpers/transcript.ts";

const SCRIPT = join(import.meta.dir, "../../scripts/signal-stats.ts");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-1111-4111-8111-111111111111";

async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", SCRIPT, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1" } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

// Fixture: 3 active hour buckets over 2026-09-14/15.
//   bucket 2026-09-14 10:00 (session A): 2 prompts, 1 teammate report
//   bucket 2026-09-14 14:00 (session A): 1 prompt, 2 teammate reports, 1 assistant reply (40 tokens)
//   bucket 2026-09-15 09:00 (session B): 3 prompts, 0 reports
// prompts per bucket sorted ascending: [1, 2, 3] -> n=3 p50(floor(0.5*3)=idx1)=2 max=3
// reports per bucket sorted ascending: [0, 1, 2] -> n=3 p50(floor(0.5*3)=idx1)=1 max=2
// records: 10 user/assistant lines, each also emits one `activity` event.
//   prompt events: 2+1+3=6, report events: 1+2+0=3, output events: 1 (the assistant reply), activity events: 10
//   events total = 6+3+1+10 = 20; records with type = 10; events per record with type = 20/10 = 2.00
async function writeFixture(root: string): Promise<void> {
  await writeTree(root, [
    {
      path: "-Users-me-proj/a.jsonl",
      lines: [
        prompt("2026-09-14T10:00:00.000Z", A),
        prompt("2026-09-14T10:01:00.000Z", A),
        teammate("2026-09-14T10:02:00.000Z", A),
        prompt("2026-09-14T14:00:00.000Z", A),
        teammate("2026-09-14T14:01:00.000Z", A),
        teammate("2026-09-14T14:02:00.000Z", A),
        assistantText("2026-09-14T14:03:00.000Z", A, 40, "req-1"),
        prompt("2026-09-15T09:00:00.000Z", B),
        prompt("2026-09-15T09:01:00.000Z", B),
        prompt("2026-09-15T09:02:00.000Z", B),
      ],
      mtime: "2026-09-15T09:02:00.000Z",
    },
  ]);
}

describe("signal-stats", () => {
  test("prints distributions, top hours and a drift line for a tiny fixture, with no path in the output", async () => {
    const root = await mkdtemp(join(tmpdir(), "zapara-stats-"));
    try {
      await writeFixture(root);
      const r = await run("--projects", root, "--to", "2026-09-15", "--days", "2");
      expect(r.code).toBe(0);
      expect(r.err).toBe("");
      expect(r.out).not.toContain(root);

      const lines = r.out.split("\n");
      const promptsLine = lines.find((l) => l.trim().startsWith("prompts"));
      expect(promptsLine).toBeDefined();
      const reportsLine = lines.find((l) => l.trim().startsWith("reports"));
      expect(reportsLine).toBeDefined();

      // Pin the exact numbers for prompts and reports: n, p50, max.
      const nums = (line: string) => line.trim().split(/\s+/).slice(1).map(Number);
      // Header row order is signal n p50 p75 p90 max zero.
      const header = lines.find((l) => l.trim().startsWith("signal"));
      expect(header).toBeDefined();
      const cols = header!.trim().split(/\s+/);
      const nIdx = cols.indexOf("n") - 1;
      const p50Idx = cols.indexOf("p50") - 1;
      const maxIdx = cols.indexOf("max") - 1;
      const promptVals = nums(promptsLine!);
      expect(promptVals[nIdx]).toBe(3);
      expect(promptVals[p50Idx]).toBe(2);
      expect(promptVals[maxIdx]).toBe(3);
      const reportVals = nums(reportsLine!);
      expect(reportVals[nIdx]).toBe(3);
      expect(reportVals[p50Idx]).toBe(1);
      expect(reportVals[maxIdx]).toBe(2);

      expect(r.out).toContain(
        "records with type: 10, events: 20 (prompt 6, report 3, output 1, interrupt 0, reject 0, answer 0, question 0, plan_review 0, mode_change 0, activity 10)",
      );
      expect(r.out).toContain("events per record with type: 2.00");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("--json prints the same figures as JSON, still with no path", async () => {
    const root = await mkdtemp(join(tmpdir(), "zapara-stats-json-"));
    try {
      await writeFixture(root);
      const r = await run("--projects", root, "--to", "2026-09-15", "--days", "2", "--json");
      expect(r.code).toBe(0);
      expect(r.err).toBe("");
      expect(r.out).not.toContain(root);
      const data = JSON.parse(r.out) as {
        distributions: Record<string, { n: number; p50: number; p75: number; p90: number; max: number; zero: number }>;
        drift: { recordsWithType: number; events: number; eventsByKind: Record<string, number>; eventsPerRecordWithType: number };
      };
      expect(data.distributions.prompts).toEqual({ n: 3, p50: 2, p75: 3, p90: 3, max: 3, zero: 0 });
      expect(data.distributions.reports).toEqual({ n: 3, p50: 1, p75: 2, p90: 2, max: 2, zero: 1 });
      expect(data.drift.recordsWithType).toBe(10);
      expect(data.drift.events).toBe(20);
      expect(data.drift.eventsByKind).toEqual({
        prompt: 6, report: 3, output: 1, interrupt: 0, reject: 0, answer: 0, question: 0, plan_review: 0, mode_change: 0, activity: 10,
      });
      expect(data.drift.eventsPerRecordWithType).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("an unknown flag exits 2 with one line on stderr and nothing on stdout", async () => {
    const r = await run("--bogus");
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err.trim().split("\n")).toHaveLength(1);
    expect(r.err).toContain("unknown flag --bogus");
  });

  test("a missing projects directory forwards the CLI's one-line error and exit code, no path", async () => {
    const missing = join(tmpdir(), "zapara-stats-does-not-exist");
    const r = await run("--projects", missing, "--days", "2");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err.trim().split("\n")).toHaveLength(1);
    expect(r.err).not.toContain(missing);
    expect(r.err).toContain("projects directory not found");
  });

  // scan() picks *files* by mtime; a file with a recent mtime can still hold lines from weeks
  // earlier. The drift line must describe the same window the distributions do, so a record or
  // event from outside [cutoffMs, endMs) must not be counted even though its file was scanned.
  test("drift metrics count only records and events inside the analysis window, not every line of a scanned file", async () => {
    const root = await mkdtemp(join(tmpdir(), "zapara-stats-window-"));
    try {
      await writeTree(root, [
        {
          path: "-Users-me-proj/a.jsonl",
          lines: [
            // 20 days before --to: well before cutoffMs (--to minus the 2-day window minus the
            // 3h lookback), but the file's mtime is recent so scan() still returns this file.
            prompt("2026-08-26T10:00:00.000Z", A),
            assistantText("2026-08-26T10:01:00.000Z", A, 40, "req-old"),
            // Inside the --to 2026-09-15 --days 2 window (dates 2026-09-14/15).
            prompt("2026-09-14T10:00:00.000Z", A),
            assistantText("2026-09-14T10:01:00.000Z", A, 40, "req-new"),
          ],
          mtime: "2026-09-14T10:01:00.000Z",
        },
      ]);
      const r = await run("--projects", root, "--to", "2026-09-15", "--days", "2", "--json");
      expect(r.code).toBe(0);
      expect(r.err).toBe("");
      const data = JSON.parse(r.out) as {
        drift: { files: number; lines: number; recordsWithType: number; events: number; eventsByKind: Record<string, number> };
      };
      // 4 raw lines were read (both pairs), but only the 2 in-window records count.
      expect(data.drift.files).toBe(1);
      expect(data.drift.lines).toBe(4);
      expect(data.drift.recordsWithType).toBe(2);
      expect(data.drift.events).toBe(4); // in-window pair only: activity x2, prompt x1, output x1
      expect(data.drift.eventsByKind).toEqual({
        prompt: 1, report: 0, output: 1, interrupt: 0, reject: 0, answer: 0, question: 0, plan_review: 0, mode_change: 0, activity: 2,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // A `type` value is untrusted input straight from someone else's JSONL; it must never be
  // able to write a raw control byte to the terminal or split the "top types" line in two.
  test("an unusual record type with control characters is escaped and length-capped in the drift line", async () => {
    const root = await mkdtemp(join(tmpdir(), "zapara-stats-weird-type-"));
    try {
      const weirdType = "x\n[31my";
      const longType = "z".repeat(50);
      await writeTree(root, [
        {
          path: "-Users-me-proj/a.jsonl",
          lines: [
            prompt("2026-09-14T09:00:00.000Z", A),
            JSON.stringify({ type: weirdType, sessionId: A, timestamp: "2026-09-14T09:30:00.000Z" }),
            JSON.stringify({ type: longType, sessionId: A, timestamp: "2026-09-14T09:31:00.000Z" }),
          ],
          mtime: "2026-09-14T09:31:00.000Z",
        },
      ]);
      const r = await run("--projects", root, "--to", "2026-09-15", "--days", "2");
      expect(r.code).toBe(0);
      expect(r.err).toBe("");
      expect(r.out).not.toContain(""); // no raw ESC byte anywhere in stdout
      expect(r.out).toContain(JSON.stringify(weirdType)); // printed escaped, not raw
      expect(r.out).toContain(JSON.stringify(longType.slice(0, 40))); // capped to 40 chars before encoding
      expect(r.out).not.toContain(JSON.stringify(longType)); // the untruncated 50-char form must not appear
      const topTypesLine = r.out.split("\n").find((l) => l.startsWith("top types:"));
      expect(topTypesLine).toBeDefined(); // the control chars did not split this into two lines
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
