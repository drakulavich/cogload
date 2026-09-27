import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistant, interrupt, mode, prompt, sidechain, writeTree } from "../helpers/transcript.ts";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-1111-4111-8111-111111111111";
let root: string;
let home: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "zapara-cli-"));
  home = await mkdtemp(join(tmpdir(), "zapara-cli-home-"));
  await writeTree(root, [
    { path: "-Users-me-proj/a.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A), assistant("2026-09-14T13:02:00.000Z", A), interrupt("2026-09-14T13:03:00.000Z", A)], mtime: "2026-09-14T13:03:00.000Z" },
    { path: "-Users-me-proj/b.jsonl", lines: [prompt("2026-09-14T13:05:00.000Z", B)], mtime: "2026-09-14T13:05:00.000Z" },
    { path: "-Users-me-proj/a/subagents/agent-1.jsonl", lines: [sidechain("2026-09-14T13:01:00.000Z", A)], mtime: "2026-09-14T13:01:00.000Z" },
    { path: "-Users-me-old/old.jsonl", lines: [prompt("2026-09-01T13:00:00.000Z", A)], mtime: "2026-09-01T13:00:00.000Z" },
  ]);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

// The exit code and the first stderr line, so a failure names both.
const first = async (...args: string[]): Promise<[number, string]> => { const r = await run(...args); return [r.code, r.err.split("\n")[0]!]; };
const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", CLI, "--projects", root, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

describe("cli", () => {
  test("--to and --days print one entry per day with the hour buckets", async () => {
    const r = await run("--to", "2026-09-14", "--days", "2", "--json");
    expect(r.code).toBe(0);
    const days = JSON.parse(r.out);
    expect(days.map((d: { date: string }) => d.date)).toEqual(["2026-09-13", "2026-09-14"]);
    const b = days[1].buckets[13];
    expect(b.sessions).toBe(2);
    expect(b.prompts).toBe(2);
    expect(b.reports).toBe(0); // no inbound agent-message lines in this fixture
    expect(b.outputTokens).toBe(100); // one assistant() reply at 100 tokens
    expect(b.interrupts).toBe(1);
    expect(b.contextSwitches).toBe(1);
    // 2 sessions, 2 prompts, 0 reports, 1 interrupt (so decisions 1), 1 context
    // switch, 100 output tokens, streak 5 min (13:00 to 13:05), hour 13 not late:
    // parallel 25*(1/4) = 6.25 + pace 15*(2/20) = 1.5
    // + supervision 30*(3*1 + 0 + 1)/45 = 2.667 + reading 10*(100/80000) = 0.0125
    // + streak 10*(5/40) = 1.25 + late 0 = 11.679 -> 12
    expect(b.score.index).toBe(12);
  });

  test("a date names one day", async () => {
    const r = await run("2026-09-14", "--json");
    expect(r.code).toBe(0);
    const d = JSON.parse(r.out);
    expect(d.date).toBe("2026-09-14");
    expect(d.totals.prompts).toBe(2);
    expect(d.totals.reports).toBe(0);
    expect(d.totals.outputTokens).toBe(100);
  });

  test("stdout in a pipe is JSON even without --json", async () => {
    const r = await run("2026-09-14");
    expect(() => JSON.parse(r.out)).not.toThrow();
  });

  test("a day with --explain in a pipe still prints JSON", async () => {
    const r = await run("2026-09-14", "--explain");
    expect(() => JSON.parse(r.out)).not.toThrow();
  });

  test("a window with no data prints empty days and exits 0", async () => {
    const r = await run("--to", "2026-08-20", "--days", "1", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)[0].peak).toBeNull();
  });

  test("a usage error is one line and a hint, exit 2, nothing on stdout", async () => {
    for (const args of [
      ["2026-13-40"], ["2026-02-30"], ["14.09.2026"], ["month"], ["week"], ["day"],
      ["--days", "0"], ["--days", "91"], ["--bogus"], ["--projects", "--json"], ["--to", "--days", "3"], ["--days"],
      ["--explain"], ["today", "--days", "3"], ["yesterday", "--to", "2026-09-14"],
      ["--from", "2026-09-10", "--days", "3"], ["--from", "2026-09-20", "--to", "2026-09-14"], ["--from", "2026-06-01", "--to", "2026-09-14"],
      ["--to", "tomorrow"], ["--json=1"], ["today", "card"],
    ]) {
      const r = await run(...args);
      expect([args.join(" "), r.code, r.out]).toEqual([args.join(" "), 2, ""]);
      const lines = r.err.trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[0]!.startsWith("zapara: ")).toBe(true);
      expect(lines[1]).toBe("run 'zapara --help' for usage");
    }
    // The window rules each have their own line.
    const line = async (...args: string[]) => (await first(...args))[1];
    expect(await line("--from", "2026-09-10", "--days", "3")).toBe("zapara: --from sets the length; drop --days");
    expect(await line("--from", "2026-09-20", "--to", "2026-09-14")).toBe("zapara: --from 2026-09-20 is after --to 2026-09-14");
    expect(await line("--from", "2026-06-01", "--to", "2026-09-14")).toBe("zapara: --from 2026-06-01 to 2026-09-14 is 106 days; the most is 90");
    expect(await line("today", "--days", "3")).toBe("zapara: --days, --from and --to do not apply to a named day");
    expect(await line("week")).toBe("zapara: unknown command week (try today, yesterday, a date, card or status)");
  });

  test("a usage error never echoes a path or an escape, only a short plain value", async () => {
    const line = async (...args: string[]) => (await first(...args))[1];
    expect(await line(join(root, "secret"))).toBe("zapara: unknown command (try today, yesterday, a date, card or status)");
    expect(await line("--to", "/Users/someone/2026-09-14")).toBe("zapara: --to must be YYYY-MM-DD, today or yesterday");
    expect(await line("--days", "\x1b[31m7")).toBe("zapara: --days must be 1..90");
    expect(await line("--bogus\n")).toBe("zapara: unknown flag");
    expect(await line("--days", "seven")).toBe("zapara: --days must be 1..90, got seven");
  });

  test("the window: --days ends today, --to ends there, --from sets the length", async () => {
    const dates = async (...args: string[]) => JSON.parse((await run(...args, "--json")).out).map((d: { date: string }) => d.date);
    expect(await dates("--from", "2026-09-13", "--to", "2026-09-14")).toEqual(["2026-09-13", "2026-09-14"]);
    expect(await dates("--from", "2026-09-14", "--to", "2026-09-14")).toEqual(["2026-09-14"]);
    expect(await dates("--to", "2026-09-14")).toHaveLength(7);
    expect(await dates("--days=2", "--to=2026-09-14")).toEqual(["2026-09-13", "2026-09-14"]);
    // The CLI reads its own clock (TZ=UTC in run()); bracketing the call keeps a
    // run that straddles midnight from failing.
    const before = utcDay(0);
    const only = (await dates("--days", "1"))[0];
    expect([before, utcDay(0)]).toContain(only);
    expect((await dates("--from", only)).length).toBe(1);
  });

  test("today and yesterday name a day, in the local zone", async () => {
    for (const [word, offset] of [["today", 0], ["yesterday", -1]] as const) {
      const before = utcDay(offset);
      const date = JSON.parse((await run(word, "--json")).out).date;
      expect([before, utcDay(offset)]).toContain(date);
      // --to accepts the same words.
      expect(JSON.parse((await run("--to", word, "--days", "1", "--json")).out)[0].date).toBe(date);
    }
  });

  test("missing projects directory exits 1 with one line, no path and no stack trace", async () => {
    const missing = join(root, "nope");
    const p = Bun.spawn(["bun", CLI, "--projects", missing, "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
    const [err, code] = await Promise.all([new Response(p.stderr).text(), p.exited]);
    expect(code).toBe(1);
    expect(err.trim().split("\n")).toHaveLength(1);
    expect(err).not.toContain("    at ");
    expect(err).not.toContain(missing); // the CLI never prints a filesystem path, even one the user passed
    expect(err.trim()).toBe("zapara: projects directory not found (pass --projects <dir>)");
  });

  test("--help exits 0 and --version prints the version", async () => {
    const help = await run("--help");
    expect(help.code).toBe(0);
    // Mutation this pins: dropping the levels line from USAGE (the ranges
    // moved out of the week footer and into --help).
    expect(help.out).toContain("levels: calm 0-29");
    expect(help.out).toContain("bugs, ideas and a star: github.com/drakulavich/zapara");
    for (const line of ["zapara today|yesterday|<date>", "zapara card [window]", "zapara status", "--from <date>", "--days <N>"]) expect(help.out).toContain(line);
    expect(help.out.split("\n").every((l) => l.length <= 80)).toBe(true);
    expect((await run("--version")).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await run("-V")).out).toBe((await run("--version")).out);
    expect((await run("-h")).out).toBe(help.out);
  });

  test("--help and --version are only recognized at a flag position, not as a value", async () => {
    expect((await run("card", "--help")).code).toBe(0);
    // "--help" here is consumed as --to's value, not treated as the --help flag.
    const bad = await run("--to", "--help");
    expect(bad.code).toBe(2);
    expect(bad.out).toBe("");
    expect(bad.err).toContain("--to needs a value");
  });

  test("a symlink loop under the projects root is skipped, and every other transcript still counts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-cli-loop-"));
    try {
      await writeTree(dir, [
        { path: "-Users-me-proj/a.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A)], mtime: "2026-09-14T13:00:00.000Z" },
        { path: "-Users-me-tangled/b.jsonl", lines: [prompt("2026-09-14T13:05:00.000Z", B)], mtime: "2026-09-14T13:05:00.000Z" },
      ]);
      await symlink(".", join(dir, "-Users-me-tangled/loop"));
      const p = Bun.spawn(["bun", CLI, "--projects", dir, "2026-09-14", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(err).toBe("");
      expect(code).toBe(0);
      expect(JSON.parse(out).totals.prompts).toBe(2); // both files, including the one beside the loop
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--days -1 is a bad range, not a missing value", async () => {
    expect(await first("--days", "-1")).toEqual([2, "zapara: --days must be 1..90, got -1"]);
    // A real flag in the value position is still a missing value, and no other
    // flag takes a negative number: -1 is not a directory, a date or a file name.
    expect(await first("--days", "--json")).toEqual([2, "zapara: --days needs a value"]);
    for (const [flag, cmd] of [["--projects", ""], ["--to", ""], ["--from", ""], ["--out", "card"]] as const) {
      expect(await first(...(cmd ? [cmd] : []), flag, "-1")).toEqual([2, `zapara: ${flag} needs a value`]);
    }
  });

  test("an empty --projects is a usage error, not a directory that is not found", async () => {
    const p = Bun.spawn(["bun", CLI, "--projects", "", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
    const q = Bun.spawn(["bun", CLI, "--projects=", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
    for (const s of [p, q]) {
      const [err, code] = await Promise.all([new Response(s.stderr).text(), s.exited]);
      expect([code, err]).toEqual([2, "zapara: --projects needs a value\nrun 'zapara --help' for usage\n"]);
    }
  });

  test("a value flag given twice is a usage error, not the last value winning", async () => {
    for (const [flag, v] of [["--days", "3"], ["--from", "2026-09-10"], ["--to", "2026-09-14"], ["--projects", root]] as const) {
      expect(await first(flag, v, flag, v)).toEqual([2, `zapara: ${flag} given twice`]);
    }
    expect(await first("card", "--out", "a.png", "--out", "b.png")).toEqual([2, "zapara: --out given twice"]);
    // A bare flag repeated is harmless.
    const r = await run("--to", "2026-09-14", "--json", "--json");
    expect(r.code).toBe(0);
  });

  test("a projects directory that cannot be read says so, without a path", async () => {
    if (process.getuid?.() === 0) return; // root bypasses file permissions
    const dir = await mkdtemp(join(tmpdir(), "zapara-cli-noread-"));
    try {
      await chmod(dir, 0o000);
      const p = Bun.spawn(["bun", CLI, "--projects", dir, "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(code).toBe(1);
      expect(out).toBe("");
      expect(err.trim()).toBe("zapara: projects directory cannot be read (check its permissions)");
      expect(err).not.toContain(dir);
    } finally {
      await chmod(dir, 0o755).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a projects directory that can be listed but not entered says it cannot be read", async () => {
    if (process.getuid?.() === 0) return; // root bypasses file permissions
    const dir = await mkdtemp(join(tmpdir(), "zapara-cli-listonly-"));
    try {
      await writeTree(dir, [{ path: "-Users-me-proj/a.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A)], mtime: "2026-09-14T13:00:00.000Z" }]);
      await chmod(dir, 0o444);
      const p = Bun.spawn(["bun", CLI, "--projects", dir, "2026-09-14", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect([code, out, err]).toEqual([1, "", "zapara: projects directory cannot be read (check its permissions)\n"]);
    } finally {
      await chmod(dir, 0o755).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a projects path that is a file says it is not a directory, without the path", async () => {
    const file = join(root, "-Users-me-proj/a.jsonl");
    const p = Bun.spawn(["bun", CLI, "--projects", file, "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, HOME: home } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect([code, out, err]).toEqual([1, "", "zapara: projects path is not a directory (pass --projects <dir>)\n"]);
  });

  test("a calendar day the zone skipped is its own empty day, and the next day is listed once", async () => {
    // Samoa jumped from 29 to 31 December 2011; 10:00-10:30 on the 31st is 20:00-20:30Z on the 30th.
    const dir = await mkdtemp(join(tmpdir(), "zapara-cli-apia-"));
    try {
      const ts = [0, 5, 10, 15, 20, 25, 30].map((m) => `2011-12-30T20:${String(m).padStart(2, "0")}:00.000Z`);
      await writeTree(dir, [{ path: "-Users-me-proj/a.jsonl", lines: ts.map((t) => prompt(t, A)), mtime: ts.at(-1)! }]);
      const args = ["bun", CLI, "--projects", dir, "--to", "2011-12-31", "--days", "3", "--no-color"];
      const env = { ...process.env, TZ: "Pacific/Apia", HOME: home };
      const p = Bun.spawn([...args, "--json"], { stdout: "pipe", stderr: "pipe", env });
      const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
      expect(code).toBe(0);
      const days = JSON.parse(out).map((d: { date: string; totals: { prompts: number } }) => [d.date, d.totals.prompts]);
      expect(days).toEqual([["2011-12-29", 0], ["2011-12-30", 0], ["2011-12-31", 7]]);
      let text = "";
      const t = Bun.spawn(args, { env, terminal: { cols: 200, rows: 24, data(_t, d) { text += new TextDecoder().decode(d); } } });
      await t.exited;
      t.terminal!.close();
      expect(text.split("\r\n").slice(1, 4).map((l) => l.slice(0, 9))).toEqual(["Thu 29/12", "Fri 30/12", "Sat 31/12"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a transcript whose mtime is older than the window is still read when its last record is inside it", async () => {
    // A per-test tree via direct Bun.spawn, not the run() helper: run() already
    // fixes --projects to the suite root, and a second --projects here would be
    // a duplicate flag (a usage error), not a way to point at a different tree.
    const dir = await mkdtemp(join(tmpdir(), "zapara-restored-"));
    try {
      await writeTree(dir, [
        // Restored from a backup: content from 14 Sept, mtime rewritten to 1 Aug.
        { path: "-Users-me-proj/restored.jsonl", lines: [prompt("2026-09-14T13:10:00.000Z", A), assistant("2026-09-14T13:12:00.000Z", A), mode(A, "default")], mtime: "2026-08-01T00:00:00.000Z" },
        // Genuinely old: last record in August, mtime in August. Must stay out.
        { path: "-Users-me-old/old.jsonl", lines: [prompt("2026-08-01T13:00:00.000Z", B)], mtime: "2026-08-01T13:00:00.000Z" },
      ]);
      const p = Bun.spawn(["bun", CLI, "--projects", dir, "2026-09-14", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(err).toBe("");
      expect(code).toBe(0);
      const day = JSON.parse(out);
      expect(day.totals.prompts).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("today's JSON carries asOf; a past day's does not", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-today-"));
    try {
      await writeTree(dir, [{ path: "-Users-me-proj/t.jsonl", lines: [prompt(`${utcDay(0)}T00:00:00.000Z`, A)], mtime: `${utcDay(0)}T00:00:00.000Z` }]);
      const spawn = (...args: string[]) => Bun.spawn(["bun", CLI, "--projects", dir, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
      const p1 = spawn("today", "--json");
      const [out1, code1] = await Promise.all([new Response(p1.stdout).text(), p1.exited]);
      expect(code1).toBe(0);
      const today = JSON.parse(out1);
      expect(today.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      const p2 = spawn("2026-09-14", "--json");
      const [out2, code2] = await Promise.all([new Response(p2.stdout).text(), p2.exited]);
      expect(code2).toBe(0);
      const past = JSON.parse(out2);
      expect(past.asOf).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unreadable transcript file is skipped, not fatal", async () => {
    if (process.getuid?.() === 0) return; // root bypasses file permissions; chmod 0o000 would have no effect
    const dir = await mkdtemp(join(tmpdir(), "zapara-cli-unreadable-"));
    const secret = join(dir, "-Users-me-proj/secret.jsonl");
    try {
      await writeTree(dir, [
        { path: "-Users-me-proj/a.jsonl", lines: [prompt("2026-09-14T13:00:00.000Z", A)], mtime: "2026-09-14T13:00:00.000Z" },
        { path: "-Users-me-proj/secret.jsonl", lines: [prompt("2026-09-14T13:05:00.000Z", B), prompt("2026-09-14T13:06:00.000Z", B)], mtime: "2026-09-14T13:05:00.000Z" },
      ]);
      await chmod(secret, 0o000);
      const p = Bun.spawn(["bun", CLI, "--projects", dir, "2026-09-14", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect(code).toBe(0);
      expect(err).toBe("");
      const d = JSON.parse(out);
      expect(d.totals.prompts).toBe(1); // only the readable file's prompt is counted; the unreadable one is skipped
    } finally {
      await chmod(secret, 0o644).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    }
  });
});
