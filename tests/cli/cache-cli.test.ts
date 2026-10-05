import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFile, chmod, cp, mkdir, mkdtemp, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistant, prompt, writeTree } from "../helpers/transcript.ts";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-1111-4111-8111-111111111111";
const C = "cccccccc-1111-4111-8111-111111111111";
const DIR = "-Users-me-proj";
let base: string;
let cwd: string;
const temps: string[] = [];

const temp = async (what: string): Promise<string> => {
  const d = await mkdtemp(join(tmpdir(), `cogload-cache-${what}-`));
  temps.push(d);
  return d;
};

beforeAll(async () => {
  base = await temp("tree");
  cwd = await temp("cwd");
  await writeTree(base, [
    { path: `${DIR}/a.jsonl`, lines: [prompt("2026-09-12T09:00:00.000Z", A), assistant("2026-09-12T09:05:00.000Z", A), prompt("2026-09-12T09:30:00.000Z", A), prompt("2026-09-14T10:00:00.000Z", A), assistant("2026-09-14T11:05:00.000Z", A)], mtime: "2026-09-14T11:05:00.000Z" },
    { path: `${DIR}/b.jsonl`, lines: [prompt("2026-09-13T14:00:00.000Z", B), assistant("2026-09-13T15:10:00.000Z", B)], mtime: "2026-09-13T15:10:00.000Z" },
    { path: `${DIR}/c.jsonl`, lines: [prompt("2026-09-14T16:00:00.000Z", C), assistant("2026-09-14T17:20:00.000Z", C)], mtime: "2026-09-14T17:20:00.000Z" },
  ]);
});
afterAll(async () => { for (const d of temps) await rm(d, { recursive: true, force: true }); });

// Each test changes its own copy of the tree and starts with an empty HOME.
async function setup(): Promise<{ home: string; projects: string }> {
  const projects = await temp("proj");
  await cp(base, projects, { recursive: true, preserveTimestamps: true });
  return { home: await temp("home"), projects };
}

async function spawn(home: string, projects: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", CLI, "--projects", projects, "--to", "2026-09-14", "--json", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}
const uncached = async (projects: string, ...args: string[]) => spawn(await temp("home"), projects, "--no-cache", ...args);

const lineOf = (err: string, label: string) => err.split("\n").find((l) => l.startsWith(`${label} `));
function hitsOf(err: string): { hits: number; misses: number } {
  const m = /^cache   (\d+) hits?, (\d+) miss(?:es)?\s+\d+ ms$/.exec(lineOf(err, "cache") ?? "");
  if (!m) throw new Error("no cache line with counts");
  return { hits: Number(m[1]), misses: Number(m[2]) };
}
const cacheDb = (home: string) => join(home, ".claude", "cogload", "cache.db");
function sql(home: string, statement: string): void {
  const db = new Database(cacheDb(home));
  try { db.run(statement); } finally { db.close(); }
}
function rows(home: string): number {
  const db = new Database(cacheDb(home), { readonly: true });
  try { return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM transcript").get()!.n; } finally { db.close(); }
}
function bucket(out: string, date: string, hour: number): { prompts: number } {
  const day = (JSON.parse(out) as { date: string; buckets: { hour: number; prompts: number }[] }[]).find((d) => d.date === date);
  return day?.buckets.find((b) => b.hour === hour) ?? { prompts: 0 };
}

describe("the transcript cache", () => {
  test("a second run hits every file and prints the first run's output", async () => {
    const { home, projects } = await setup();
    const run1 = await spawn(home, projects, "--verbose");
    const run2 = await spawn(home, projects, "--verbose");
    const off = await spawn(await temp("home"), projects, "--no-cache", "--verbose");
    expect(run2.out).toBe(run1.out);
    expect(run2.out).toBe(off.out);
    expect(run2.code).toBe(0);
    expect(hitsOf(run1.err)).toEqual({ hits: 0, misses: 3 });
    expect(hitsOf(run2.err)).toEqual({ hits: 3, misses: 0 });
    expect(lineOf(run2.err, "read")).toMatch(/^read\s+0 files, /);
    expect(lineOf(off.err, "cache")).toBe("cache   off");
  });

  test("a prompt appended inside the window is counted, and its file is the one miss", async () => {
    const { home, projects } = await setup();
    const a = join(projects, DIR, "a.jsonl");
    const run1 = await spawn(home, projects);
    const { mtime } = await stat(a);
    await appendFile(a, prompt("2026-09-14T10:30:00.000Z", A) + "\n");
    // Same mtime as before, so only the size can tell the file changed.
    await utimes(a, mtime, mtime);
    const run2 = await spawn(home, projects, "--verbose");
    expect(bucket(run2.out, "2026-09-14", 10).prompts).toBe(bucket(run1.out, "2026-09-14", 10).prompts + 1);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 2, misses: 1 });
  });

  test("a wider window after a narrow one prints what --no-cache prints", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects, "--days", "1");
    const wide = await spawn(home, projects, "--days", "7");
    expect(wide.code).toBe(0);
    expect(wide.out).toBe((await uncached(projects, "--days", "7")).out);
  });

  test("a narrow run does not replace the rows a wide run wrote", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects, "--days", "7");
    await spawn(home, projects, "--days", "1");
    const third = await spawn(home, projects, "--days", "7", "--verbose");
    expect(hitsOf(third.err)).toEqual({ hits: 3, misses: 0 });
    expect(third.out).toBe((await uncached(projects, "--days", "7")).out);
  });

  test("a renamed transcript is a hit and its output is unchanged", async () => {
    const { home, projects } = await setup();
    const run1 = await spawn(home, projects);
    await rename(join(projects, DIR, "c.jsonl"), join(projects, DIR, "d.jsonl"));
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.out).toBe(run1.out);
    expect(hitsOf(run2.err)).toEqual({ hits: 3, misses: 0 });
  });

  test("a deleted transcript is skipped", async () => {
    const { home, projects } = await setup();
    const run1 = await spawn(home, projects);
    await rm(join(projects, DIR, "b.jsonl"));
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.code).toBe(0);
    expect(run2.out).not.toBe(run1.out);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 2, misses: 0 });
  });

  test("a same-length rewrite with its mtime set back is a miss", async () => {
    const { home, projects } = await setup();
    const b = join(projects, DIR, "b.jsonl");
    await spawn(home, projects);
    const { mtime } = await stat(b);
    const original = await readFile(b, "utf8");
    // Same length: the prompt's hour moves from 14 to 15, one hour later.
    const rewritten = original.replace("2026-09-13T14:00:00.000Z", "2026-09-13T15:00:00.000Z");
    expect(rewritten.length).toBe(original.length);
    await writeFile(b, rewritten);
    await utimes(b, mtime, mtime);
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 2, misses: 1 });
  });

  test("a transcript cut shorter is a miss", async () => {
    const { home, projects } = await setup();
    const c = join(projects, DIR, "c.jsonl");
    await spawn(home, projects);
    const { mtime } = await stat(c);
    const firstLine = (await readFile(c, "utf8")).split("\n")[0] + "\n";
    await writeFile(c, firstLine);
    await utimes(c, mtime, mtime);
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 2, misses: 1 });
  });

  test("two runs at once both print what --no-cache prints", async () => {
    const { home, projects } = await setup();
    const [narrow, wide] = await Promise.all([spawn(home, projects, "--days", "1"), spawn(home, projects, "--days", "7")]);
    expect([narrow.code, narrow.err, wide.code, wide.err]).toEqual([0, "", 0, ""]);
    expect(narrow.out).toBe((await uncached(projects, "--days", "1")).out);
    expect(wide.out).toBe((await uncached(projects, "--days", "7")).out);
  });

  test("a row with garbage in events is a miss, and the miss rebuilds it", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    sql(home, "UPDATE transcript SET events = 'x'");
    const run2 = await spawn(home, projects, "--verbose");
    const run3 = await spawn(home, projects, "--verbose");
    expect(run2.code).toBe(0);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 0, misses: 3 });
    expect(hitsOf(run3.err)).toEqual({ hits: 3, misses: 0 });
  });

  test("a row from another parser is a miss", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    sql(home, "UPDATE transcript SET parser = x'00'");
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.code).toBe(0);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err).misses).toBe(3);
  });

  test("a cache.db that is plain text is replaced", async () => {
    const { home, projects } = await setup();
    await mkdir(join(home, ".claude", "cogload"), { recursive: true });
    await writeFile(cacheDb(home), "not a db");
    const run1 = await spawn(home, projects, "--verbose");
    const run2 = await spawn(home, projects, "--verbose");
    expect(run1.code).toBe(0);
    expect(run1.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 3, misses: 0 });
  });

  test("a cache.db from another user_version is replaced", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    sql(home, "PRAGMA user_version = 99");
    const run2 = await spawn(home, projects, "--verbose");
    const run3 = await spawn(home, projects, "--verbose");
    expect(run2.code).toBe(0);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(hitsOf(run2.err)).toEqual({ hits: 0, misses: 3 });
    expect(hitsOf(run3.err)).toEqual({ hits: 3, misses: 0 });
  });

  test("a cache.db corrupt past its header is replaced", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    // The header stays valid, so the file opens; the page after it is garbage.
    const bytes = await readFile(cacheDb(home));
    expect(bytes.length).toBeGreaterThan(4096 + 512);
    bytes.fill(0xab, 4096, 4096 + 512);
    await writeFile(cacheDb(home), bytes);
    const run2 = await spawn(home, projects, "--verbose");
    const run3 = await spawn(home, projects, "--verbose");
    expect([run2.code, run2.out]).toEqual([0, (await uncached(projects)).out]);
    expect(hitsOf(run3.err)).toEqual({ hits: 3, misses: 0 });
  });

  test("runs that find the same corrupt cache.db at once all print what --no-cache prints, and leave a working cache", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    const bytes = await readFile(cacheDb(home));
    bytes.fill(0xab, 4096, 4096 + 512);
    await writeFile(cacheDb(home), bytes);
    const runs = await Promise.all([1, 2, 3, 4].map(() => spawn(home, projects)));
    const expected = (await uncached(projects)).out;
    expect(runs.map((r) => [r.code, r.err, r.out === expected])).toEqual(Array(4).fill([0, "", true]));
    // Were a straggler to delete the file another run had just recreated and
    // filled, this run would miss.
    expect(hitsOf((await spawn(home, projects, "--verbose")).err)).toEqual({ hits: 3, misses: 0 });
  });

  test("a transcript with a session id that is not a UUID is never cached", async () => {
    const { home, projects } = await setup();
    const marker = "cogload-private-marker";
    await writeTree(projects, [{ path: `${DIR}/x.jsonl`, lines: [prompt("2026-09-13T08:00:00.000Z", marker), assistant("2026-09-13T08:05:00.000Z", marker)], mtime: "2026-09-13T08:05:00.000Z" }]);
    await spawn(home, projects);
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.code).toBe(0);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(bucket(run2.out, "2026-09-13", 8).prompts).toBe(1);
    expect(hitsOf(run2.err)).toEqual({ hits: 3, misses: 1 });
    const cogload = join(home, ".claude", "cogload");
    const files = (await Array.fromAsync(new Bun.Glob("cache.db*").scan(cogload))).map((f) => join(cogload, f));
    const bytes = Buffer.concat(await Promise.all(files.map((f) => readFile(f))));
    expect(bytes.includes(Buffer.from(marker))).toBe(false);
  });

  test("a failed lookup writes nothing to the cache", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    // A table named json_each shadows the function the lookup needs; the insert does not use it.
    sql(home, "DELETE FROM transcript; CREATE TABLE json_each (x)");
    const run2 = await spawn(home, projects, "--verbose");
    expect(run2.code).toBe(0);
    expect(run2.out).toBe((await uncached(projects)).out);
    expect(rows(home)).toBe(0);
    // Nothing was looked up, so --verbose claims no hits and no misses.
    expect(lineOf(run2.err, "cache")).toBe("cache   off");
  });

  test("an unwritable ~/.claude/cogload leaves the run as it was", async () => {
    const { home, projects } = await setup();
    const claude = join(home, ".claude");
    await mkdir(join(claude, "cogload"), { recursive: true });
    await chmod(join(claude, "cogload"), 0o500);
    const lockedHome = await temp("home");
    await mkdir(join(lockedHome, ".claude"));
    await chmod(join(lockedHome, ".claude"), 0o500);
    try {
      const expected = (await uncached(projects)).out;
      for (const h of [home, lockedHome]) {
        const run = await spawn(h, projects);
        expect([run.code, run.err, run.out]).toEqual([0, "", expected]);
      }
    } finally {
      await chmod(join(claude, "cogload"), 0o700);
      await chmod(join(lockedHome, ".claude"), 0o700);
    }
  });

  test("under an open umask the cache's directories and files are still private", async () => {
    // cogload no longer narrows the process umask (that reached the card), so the
    // cache sets its own modes: umask 000 would otherwise leave 0777 and 0644.
    const { home, projects } = await setup();
    const p = Bun.spawn(["sh", "-c", 'umask 000; exec bun "$0" "$@"', CLI, "--projects", projects, "--to", "2026-09-14", "--json"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
    expect(await p.exited).toBe(0);
    const cogload = join(home, ".claude", "cogload");
    const mode = async (p: string) => (await stat(p)).mode & 0o777;
    expect([await mode(join(home, ".claude")), await mode(cogload)]).toEqual([0o700, 0o700]);
    const files = (await Array.fromAsync(new Bun.Glob("cache.db*").scan(cogload))).sort();
    expect(files).toContain("cache.db");
    for (const f of files) expect([f, await mode(join(cogload, f))]).toEqual([f, 0o600]);
  });

  test("under an open umask a fresh cache.db and its WAL files are never seen with a mode but 0600", async () => {
    // The mode after the run is not enough: SQLite creates a missing database
    // 0644 less the umask, and a chmod after it leaves that mode visible for a
    // moment. A second process stats the three files for the whole run. It can
    // only miss a loose mode, never invent one, so this never fails on a
    // database created 0600; on the chmod-after code it saw 644 in 40 of 40 runs.
    const { home, projects } = await setup();
    const cogload = join(home, ".claude", "cogload");
    await mkdir(cogload, { recursive: true, mode: 0o700 });
    const db = join(cogload, "cache.db");
    const stop = join(home, "stop");
    const poller = join(home, "poll.ts");
    await writeFile(poller, `import { existsSync, statSync } from "node:fs";
const [db, stop] = process.argv.slice(2);
const seen = new Set();
console.log("ready");
for (let i = 0, until = Date.now() + 20000; Date.now() < until; i++) {
  for (const f of [db, db + "-wal", db + "-shm"]) { try { seen.add(f.slice(db.length) + ":" + (statSync(f).mode & 0o777).toString(8)); } catch {} }
  if (i % 100 === 0 && existsSync(stop)) break;
}
console.log([...seen].sort().join(" "));
`);
    const watch = Bun.spawn(["bun", poller, db, stop], { stdout: "pipe" });
    const lines = watch.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let out = (await lines.read()).value ?? "";
    expect(out).toStartWith("ready");
    const run = Bun.spawn(["sh", "-c", 'umask 000; exec bun "$0" "$@"', CLI, "--projects", projects, "--to", "2026-09-14", "--json"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home } });
    expect(await run.exited).toBe(0);
    await writeFile(stop, "");
    for (let r = await lines.read(); !r.done; r = await lines.read()) out += r.value;
    const seen = out.split("\n")[1]!.split(" ");
    expect(seen).toContain(":600"); // the poller did see the database
    expect(seen.filter((s) => !s.endsWith(":600"))).toEqual([]);
  }, 30_000);

  test("the cache directory and file get private modes when created, and keep the modes a person sets later", async () => {
    const { home, projects } = await setup();
    const dir = join(home, ".claude", "cogload");
    await spawn(home, projects);
    expect([(await stat(dir)).mode & 0o777, (await stat(cacheDb(home))).mode & 0o777]).toEqual([0o700, 0o600]);
    await chmod(dir, 0o750);
    await chmod(cacheDb(home), 0o640);
    const run2 = await spawn(home, projects, "--verbose");
    expect(hitsOf(run2.err)).toEqual({ hits: 3, misses: 0 });
    expect([(await stat(dir)).mode & 0o777, (await stat(cacheDb(home))).mode & 0o777]).toEqual([0o750, 0o640]);
  });

  test("with HOME empty the run works and the cache is off", async () => {
    const { projects } = await setup();
    const run = await spawn("", projects, "--verbose");
    expect(run.code).toBe(0);
    expect(run.out).toBe((await uncached(projects)).out);
    expect(lineOf(run.err, "cache")).toBe("cache   off");
  });

  test("rows unused for 90 days are removed", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects);
    expect(rows(home)).toBe(3);
    await rm(join(projects, DIR, "c.jsonl"));
    sql(home, "UPDATE transcript SET used_at = 0");
    const run2 = await spawn(home, projects, "--verbose");
    expect(hitsOf(run2.err)).toEqual({ hits: 2, misses: 0 });
    expect(rows(home)).toBe(2);
  });

  test("the cache keeps no path, no message text and no path hash", async () => {
    const { home, projects } = await setup();
    await spawn(home, projects, "--days", "7");
    const cogload = join(home, ".claude", "cogload");
    const files = (await Array.fromAsync(new Bun.Glob("cache.db*").scan(cogload))).map((f) => join(cogload, f));
    expect(files).toContain(cacheDb(home));
    const bytes = Buffer.concat(await Promise.all(files.map((f) => readFile(f))));
    const paths = ["a", "b", "c"].map((n) => join(projects, DIR, `${n}.jsonl`));
    const needles: Buffer[] = [projects, DIR, "placeholder prompt", "placeholder reply"].map((t) => Buffer.from(t));
    for (const p of paths) {
      const digest = createHash("sha256").update(p).digest();
      needles.push(Buffer.from(p), digest, Buffer.from(digest.toString("hex")));
    }
    for (const n of needles) expect(bytes.includes(n)).toBe(false);
  });
});
