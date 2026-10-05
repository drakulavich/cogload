import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistant, prompt, writeTree } from "../helpers/transcript.ts";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-1111-4111-8111-111111111111";
const utcDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
let projects: string;
// A throwaway working directory for every run: with HOME empty, bun puts its
// own cache under the working directory, and the suite must not leave that in
// the checkout.
let cwd: string;

// Every run gets its own HOME, so the file each test asserts on is only ever
// written by that test's own runs.
const spawn = (home: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> => {
  const p = Bun.spawn(["bun", CLI, "status", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
  return Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ code, out, err }));
};
const run = (home: string, ...args: string[]) => spawn(home, "--projects", projects, ...args);
// The same run, under a umask that would narrow every mode cogload asks for.
const masked = (home: string): Promise<{ code: number; out: string; err: string }> => {
  const p = Bun.spawn(["sh", "-c", 'umask 0277; exec bun "$0" "$@"', CLI, "status", "--projects", projects], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
  return Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ code, out, err }));
};
const home = () => mkdtemp(join(tmpdir(), "cogload-status-home-"));
const dirOf = (h: string) => join(h, ".claude", "cogload");
const statusPath = (h: string) => join(dirOf(h), "status.json");
const tmps = async (h: string) => (await readdir(dirOf(h))).filter((n) => n.endsWith(".tmp"));

beforeAll(async () => {
  projects = await mkdtemp(join(tmpdir(), "cogload-status-proj-"));
  cwd = await mkdtemp(join(tmpdir(), "cogload-status-cwd-"));
  const d = utcDay(0);
  await writeTree(projects, [{ path: "-Users-me-proj/t.jsonl", lines: [prompt(`${d}T00:00:00.000Z`, A), assistant(`${d}T00:02:00.000Z`, A)], mtime: `${d}T00:02:00.000Z` }]);
});
afterAll(async () => {
  await rm(projects, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

describe("cogload status", () => {
  test("writes one JSON line to ~/.claude/cogload/status.json and prints it", async () => {
    const h = await home();
    const r = await run(h);
    expect([r.code, r.err]).toEqual([0, ""]);
    const file = await readFile(statusPath(h), "utf8");
    expect(r.out).toBe(file);
    expect(file.endsWith("\n") && file.split("\n").length === 2).toBe(true);
    const s = JSON.parse(file);
    expect(Object.keys(s)).toEqual(["schema", "asOf", "date", "hour", "index", "level", "peak", "activeMin", "streakMin"]);
    expect(s.schema).toBe(1);
    expect(s.date).toBe(utcDay(0));
    expect(s.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect((await stat(statusPath(h))).mode & 0o777).toBe(0o600);
    expect((await stat(dirOf(h))).mode & 0o777).toBe(0o700);
    expect(await tmps(h)).toEqual([]);
  });

  test("a directory whose mode was set by hand keeps it; the file is still 0600", async () => {
    const h = await home();
    await mkdir(dirOf(h), { recursive: true });
    await chmod(dirOf(h), 0o750);
    expect((await run(h)).code).toBe(0);
    expect((await stat(dirOf(h))).mode & 0o777).toBe(0o750);
    expect((await stat(statusPath(h))).mode & 0o777).toBe(0o600);
  });

  test("a restrictive umask does not narrow the file or the directory", async () => {
    const h = await home();
    // The modes passed to mkdir and open are a request the umask narrows, so a
    // run under umask 0277 would otherwise leave a 0400 file and a 0400 directory.
    const r = await masked(h);
    expect([r.code, r.err]).toEqual([0, ""]);
    expect((await stat(statusPath(h))).mode & 0o777).toBe(0o600);
    expect((await stat(dirOf(h))).mode & 0o777).toBe(0o700);
  });

  test("four runs at once under a restrictive umask on a fresh HOME all succeed", async () => {
    // The four race to create ~/.claude. A run that made that directory too
    // narrow to enter would strand the others inside it, so this is the
    // concurrency promise and the umask rule at the same time.
    const h = await home();
    const rs = await Promise.all([masked(h), masked(h), masked(h), masked(h)]);
    expect(rs.map((r) => [r.code, r.err])).toEqual([[0, ""], [0, ""], [0, ""], [0, ""]]);
    expect((await stat(dirOf(h))).mode & 0o777).toBe(0o700);
    expect((await stat(statusPath(h))).mode & 0o777).toBe(0o600);
    const file = await readFile(statusPath(h), "utf8");
    expect(JSON.parse(file).schema).toBe(1);
    expect(file.endsWith("\n") && file.split("\n").length === 2).toBe(true);
    expect(await tmps(h)).toEqual([]);
  });

  test("an event after the run's clock is not in the file", async () => {
    // The same day twice: once from the suite fixture, once from a tree that
    // adds a session five and six minutes in the future. The snapshot rule says
    // the two must agree, because events after the run's own clock do not count
    // yet. In the last six minutes of a UTC day the extra session lands on
    // tomorrow, so the two agree for that reason instead and the test still
    // passes; only the mutation goes unnoticed in that window.
    const tree = await mkdtemp(join(tmpdir(), "cogload-status-future-"));
    try {
      const d = utcDay(0);
      const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
      await writeTree(tree, [
        { path: "-Users-me-proj/t.jsonl", lines: [prompt(`${d}T00:00:00.000Z`, A), assistant(`${d}T00:02:00.000Z`, A)], mtime: `${d}T00:02:00.000Z` },
        { path: "-Users-me-proj/later.jsonl", lines: [prompt(ahead(5), B), assistant(ahead(6), B)], mtime: ahead(6) },
      ]);
      const [hc, hf] = [await home(), await home()];
      const [control, withFuture] = await Promise.all([run(hc), spawn(hf, "--projects", tree)]);
      expect([control.code, withFuture.code]).toEqual([0, 0]);
      const load = (line: string) => { const { index, level, peak, activeMin, streakMin } = JSON.parse(line); return { index, level, peak, activeMin, streakMin }; };
      expect(load(withFuture.out)).toEqual(load(control.out));
      // The fixture does count when it is behind the clock, so equality above
      // is the cutoff at work and not two empty days.
      expect(JSON.parse(control.out).activeMin).toBeGreaterThan(0);
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  });

  // A prompt every five minutes for the given hours, the last one five minutes
  // ago, read by `status` in the zone where the clock now shows `localHour`.
  // Returns the line and the instant of the streak's first prompt.
  const statusOfRun = async (hours: number, localHour: number): Promise<{ s: { asOf: string; hour: number; streakMin: number }; start: number }> => {
    const d = (((localHour - new Date().getUTCHours()) % 24) + 24) % 24;
    const off = d > 14 ? d - 24 : d;
    const tz = off >= 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`; // POSIX signs: Etc/GMT-3 is UTC+3
    const start = Math.floor(Date.now() / 60_000) * 60_000 - hours * 3_600_000;
    const at = (i: number) => new Date(start + i * 300_000).toISOString();
    const n = hours * 12;
    const tree = await mkdtemp(join(tmpdir(), "cogload-status-streak-"));
    try {
      await writeTree(tree, [{ path: "-Users-me-proj/t.jsonl", lines: Array.from({ length: n }, (_, i) => prompt(at(i), A)), mtime: at(n - 1) }]);
      const p = Bun.spawn(["bun", CLI, "status", "--projects", tree], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: tz, NO_COLOR: "1", HOME: await home() } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      expect([code, err]).toEqual([0, ""]);
      return { s: JSON.parse(out), start };
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  };

  test("just after local midnight a six-hour streak reads six hours, not what the day's look-back sees", async () => {
    // The day's window looks back only to 21:00 the evening before, three to
    // five hours from now: the status line used to show that much, and to
    // jump back up once the next hour had passed.
    const { s, start } = await statusOfRun(6, 0);
    expect(s.hour).toBeLessThanOrEqual(1);
    expect(s.streakMin).toBe(Math.round((Date.parse(s.asOf) - start) / 60_000));
  });

  test("a 28-hour streak is written as 1500 minutes, the reader contract's ceiling, late in the evening and at noon", async () => {
    // At 23:xx the day's look-back alone reaches 26 hours back, so the line
    // used to say 1560 or more, and a strict reader dropped the whole file.
    // At noon only the streak's own look-back reaches that far, and it must
    // reach past the ceiling, or the line says a few minutes under it.
    expect((await statusOfRun(28, 23)).s.streakMin).toBe(1500);
    expect((await statusOfRun(28, 12)).s.streakMin).toBe(1500);
  });

  test("four runs at once leave one complete line and no temp file", async () => {
    const h = await home();
    const rs = await Promise.all([run(h), run(h), run(h), run(h)]);
    expect(rs.map((r) => r.code)).toEqual([0, 0, 0, 0]);
    const file = await readFile(statusPath(h), "utf8");
    expect(JSON.parse(file).schema).toBe(1);
    expect(await tmps(h)).toEqual([]);
  });

  test("a temp file it did not create is left alone", async () => {
    const h = await home();
    await run(h);
    const foreign = join(dirOf(h), "status.json.1.abc.tmp");
    await writeFile(foreign, "not ours\n");
    await utimes(foreign, new Date(0), new Date(0));
    expect((await run(h)).code).toBe(0);
    expect(await readFile(foreign, "utf8")).toBe("not ours\n");
  });

  test("a symlink at the target is replaced, its target untouched", async () => {
    const h = await home();
    await run(h);
    const elsewhere = join(h, "elsewhere.json");
    await writeFile(elsewhere, "keep\n");
    await rm(statusPath(h));
    await symlink(elsewhere, statusPath(h));
    expect((await run(h)).code).toBe(0);
    expect((await lstat(statusPath(h))).isSymbolicLink()).toBe(false);
    expect(await readFile(elsewhere, "utf8")).toBe("keep\n");
  });

  test("a failed read leaves the last good file untouched and names no path", async () => {
    if (process.getuid?.() === 0) return; // root bypasses file permissions
    const h = await home();
    await run(h);
    const before = await readFile(statusPath(h), "utf8");
    const locked = await mkdtemp(join(tmpdir(), "cogload-status-locked-"));
    try {
      await chmod(locked, 0o000);
      const r = await spawn(h, "--projects", locked);
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err.split("\n").filter(Boolean)).toHaveLength(1);
      expect(r.err).not.toContain(locked);
    } finally {
      await chmod(locked, 0o700).catch(() => {});
      await rm(locked, { recursive: true, force: true });
    }
    expect(await readFile(statusPath(h), "utf8")).toBe(before);
  });

  test("an empty HOME is the write error", async () => {
    const r = await run("");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("cogload: cannot write the status file\n");
  });

  test("window flags, --explain and --out are usage errors on status", async () => {
    const h = await home();
    for (const [args, msg] of [
      [["--days", "3"], "--days, --from and --to do not apply to status"],
      [["--from", "2026-09-14"], "--days, --from and --to do not apply to status"],
      [["--to", "2026-09-14"], "--days, --from and --to do not apply to status"],
      [["--explain"], "--explain applies to a named day only"],
      [["--out", "x.png"], "--out applies to card only"],
    ] as const) {
      const r = await run(h, ...args);
      expect([args.join(" "), r.code, r.out, r.err.split("\n")[0]]).toEqual([args.join(" "), 2, "", `cogload: ${msg}`]);
    }
  });
});
