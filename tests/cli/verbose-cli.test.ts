import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistant, bigToolResult, prompt, sidechain, writeTree } from "../helpers/transcript.ts";

// --verbose is for a person diagnosing someone else's machine: where the time
// goes and how much was read, as numbers only, on stderr.
const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
let root: string;
let cwd: string;
let home: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cogload-verbose-"));
  cwd = await mkdtemp(join(tmpdir(), "cogload-verbose-cwd-"));
  home = await mkdtemp(join(tmpdir(), "cogload-verbose-home-"));
  await writeTree(root, [
    { path: "-Users-me-proj/a.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A), assistant("2026-09-14T13:02:00.000Z", A), bigToolResult("2026-09-14T13:03:00.000Z", A, 300_000)], mtime: "2026-09-14T13:03:00.000Z" },
    { path: "-Users-me-proj/b.jsonl", lines: [prompt("2026-09-14T15:00:00.000Z", A)], mtime: "2026-09-14T15:00:00.000Z" },
    { path: "-Users-me-proj/a/subagents/agent-1.jsonl", lines: [sidechain("2026-09-14T13:01:00.000Z", A)], mtime: "2026-09-14T13:01:00.000Z" },
    { path: "-Users-me-old/old.jsonl", lines: [prompt("2026-09-01T13:00:00.000Z", A)], mtime: "2026-09-01T13:00:00.000Z" },
  ]);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); await rm(cwd, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); });

async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", CLI, "--projects", root, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

const MS = String.raw`\s+\d+ ms$`;
const lineOf = (err: string, label: string) => err.split("\n").find((l) => l.startsWith(`${label} `));

describe("--verbose", () => {
  test("adds timings on stderr and leaves stdout as it was", async () => {
    const plain = await run("--to", "2026-09-14", "--days", "2", "--json");
    const r = await run("--to", "2026-09-14", "--days", "2", "--json", "--verbose");
    expect(r.code).toBe(0);
    expect(r.out).toBe(plain.out);
    expect(plain.err).toBe("");
    const lines = r.err.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^cogload \d+\.\d+\.\d+ · bun \d+\.\d+\.\d+ · \w+ \w+ · \d+ cpus$/);
    expect(lines.slice(1).map((l) => l.split(" ")[0])).toEqual(["start", "open", "scan", "cache", "read", "analyze", "save", "total"]);
    for (const l of lines.slice(1)) expect(l).toMatch(new RegExp(MS));
  });

  test("without the cache there is nothing to open, look up or save", async () => {
    const r = await run("--to", "2026-09-14", "--days", "2", "--json", "--verbose", "--no-cache");
    expect(r.err.trimEnd().split("\n").slice(1).map((l) => l.split(" ")[0])).toEqual(["start", "scan", "cache", "read", "analyze", "total"]);
    expect(lineOf(r.err, "cache")).toBe("cache   off");
  });

  test("the rows add up to the total", async () => {
    // Rounding costs half a millisecond a row, and a loaded machine stalls the untimed lines.
    const r = await run("status", "--verbose");
    const rows = r.err.trimEnd().split("\n").slice(1).map((l) => [l.split(" ")[0]!, Number(/(\d+) ms$/.exec(l)![1])] as const);
    const total = rows.pop()![1];
    const sum = rows.reduce((n, [, ms]) => n + ms, 0);
    expect(total - sum).toBeLessThanOrEqual(rows.length / 2 + total / 10);
  });

  test("status adds the write of its file", async () => {
    const r = await run("status", "--verbose");
    expect(r.code).toBe(0);
    expect(lineOf(r.err, "write")).toMatch(new RegExp(String.raw`^write\s+status file` + MS));
    expect(r.err).not.toContain("/");
    const grid = await run("--to", "2026-09-14", "--days", "2", "--json", "--verbose");
    expect(lineOf(grid.err, "write")).toBeUndefined();
  });

  test("counts what was scanned and read, and names no path", async () => {
    const r = await run("--to", "2026-09-14", "--days", "2", "--json", "--verbose", "--no-cache");
    // a and b are in the window by mtime; old.jsonl is opened only for its tail; the subagent file is never counted.
    expect(lineOf(r.err, "scan")).toMatch(new RegExp(String.raw`^scan\s+3 files, 2 in window, 1 tail check` + MS));
    const bytes = (await stat(join(root, "-Users-me-proj/a.jsonl"))).size + (await stat(join(root, "-Users-me-proj/b.jsonl"))).size;
    expect(lineOf(r.err, "read")).toMatch(new RegExp(String.raw`^read\s+2 files, ${(bytes / 1e6).toFixed(1)} MB, \d+ at a time` + MS));
    expect(r.err).not.toContain("/");
  });

  test("counts the unreadable files and directories it skipped, and names neither", async () => {
    const tree = await mkdtemp(join(tmpdir(), "cogload-verbose-locked-"));
    const at = "2026-09-14T13:00:00.000Z";
    await writeTree(tree, [
      { path: "-Users-me-ok/a.jsonl", lines: [prompt(at, A)], mtime: at },
      { path: "-Users-me-lockedfile/b.jsonl", lines: [prompt(at, A)], mtime: at },
      { path: "-Users-me-secretdir/c.jsonl", lines: [prompt(at, A)], mtime: at },
    ]);
    await chmod(join(tree, "-Users-me-lockedfile/b.jsonl"), 0o000);
    await chmod(join(tree, "-Users-me-secretdir"), 0o000);
    try {
      const p = Bun.spawn(["bun", CLI, "--projects", tree, "--to", "2026-09-14", "--days", "1", "--json", "--verbose", "--no-cache"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
      const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
      expect(code).toBe(0);
      // b is seen and fails to read; the locked directory is never entered, so c is not counted as a file.
      expect(lineOf(err, "scan")).toMatch(new RegExp(String.raw`^scan\s+2 files, 2 in window, 0 tail checks, 2 unreadable skipped` + MS));
      expect(err).not.toContain("lockedfile");
      expect(err).not.toContain("secretdir");
    } finally {
      await chmod(join(tree, "-Users-me-secretdir"), 0o755);
      await rm(tree, { recursive: true, force: true });
    }
  });

  test("card adds the render, --json has none to report", async () => {
    const page = await run("card", "--to", "2026-09-14", "--days", "2", "--out", "c.html", "--verbose");
    expect(page.code).toBe(0);
    expect(lineOf(page.err, "render")).toMatch(new RegExp(String.raw`^render\s+html` + MS));
    const data = await run("card", "--to", "2026-09-14", "--days", "2", "--json", "--verbose");
    expect(lineOf(data.err, "render")).toBeUndefined();
    expect(lineOf(data.err, "analyze")).toBeDefined();
  });

  test("is a bare flag", async () => {
    const r = await run("--verbose=1");
    expect(r.code).toBe(2);
  });
});
