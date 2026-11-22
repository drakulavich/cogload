import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prompt, writeTree } from "../helpers/transcript.ts";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const projects = join(import.meta.dir, "../fixtures/busy-week/projects");
let home: string;
let empty: string;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "cogload-trend-home-"));
  empty = await mkdtemp(join(tmpdir(), "cogload-trend-empty-"));
});
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
  await rm(empty, { recursive: true, force: true });
});

async function runIn(dir: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", CLI, "--projects", dir, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home },
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}
const run = (...args: string[]) => runIn(projects, ...args);

async function runInTerminal(env: Record<string, string>, ...args: string[]): Promise<{ code: number; out: string }> {
  let out = "";
  const decoder = new TextDecoder();
  const p = Bun.spawn(["bun", CLI, "--projects", projects, ...args], {
    env: { ...process.env, TZ: "UTC", HOME: home, ...env },
    terminal: {
      cols: 200,
      rows: 40,
      data(_t, d) {
        out += decoder.decode(d);
      },
    },
  });
  const code = await p.exited;
  p.terminal!.close();
  return { code, out: out.replace(/\r\n/g, "\n") };
}

const WEEK = [
  "Mon 14/09 to Sun 20/09, 7 days: 22 hours with a session, 21h10 active",
  "",
  "level      hours  share",
  "calm          15    68%",
  "warming        3    14%",
  "heating        1     5%",
  "fried          3    14%",
  "",
  "week from   days  hours  active  heating+  prompts",
  "Mon 14/09      7     22   21h10         4      323",
  "",
  "sessions  hours  mean index",
  "1            15          17",
  "2             3          33",
  "3             0           -",
  "4             0           -",
  "5+            4          86",
];

describe("cogload trend", () => {
  test("a week of the fixture: the level shares, one week line and the means by sessions", async () => {
    const r = await run("trend", "--days", "7", "--to", "2026-09-20", "--no-color");
    expect([r.code, r.err]).toEqual([0, ""]);
    expect(r.out.split("\n")).toEqual([...WEEK, ""]);
  });

  test("--json holds the counts the text is made from", async () => {
    const r = await run("trend", "--days", "7", "--to", "2026-09-20", "--json");
    expect([r.code, r.err]).toEqual([0, ""]);
    expect(JSON.parse(r.out)).toEqual({
      from: "2026-09-14",
      to: "2026-09-20",
      days: 7,
      hours: 22,
      activeMin: 1270,
      levels: { Calm: 15, Warming: 3, Heating: 1, Fried: 3 },
      weeks: [{ from: "2026-09-14", to: "2026-09-20", days: 7, hours: 22, activeMin: 1270, hot: 4, prompts: 323 }],
      bySessions: [
        { sessions: 1, hours: 15, mean: 17 },
        { sessions: 2, hours: 3, mean: 33 },
        { sessions: 3, hours: 0, mean: null },
        { sessions: 4, hours: 0, mean: null },
        { sessions: 5, hours: 4, mean: 86 },
      ],
    });
  });

  test("weeks are counted back from --to: a 9-day window ending Friday opens with a 2-day block", async () => {
    const r = await run("trend", "--days", "9", "--to", "2026-09-18", "--no-color");
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    const at = lines.indexOf("week from   days  hours  active  heating+  prompts");
    expect(lines.slice(at, at + 4)).toEqual([
      "week from   days  hours  active  heating+  prompts",
      "Thu 10/09      2      0    0h00         0        0",
      "Sat 12/09      7     20   19h15         4      311",
      "",
    ]);
  });

  test("28 days by default, four whole weeks ending at --to", async () => {
    const j = JSON.parse((await run("trend", "--to", "2026-09-20", "--json")).out);
    expect([j.from, j.to, j.days, j.weeks.map((w: { from: string; days: number }) => `${w.from} ${w.days}`)]).toEqual([
      "2026-08-24",
      "2026-09-20",
      28,
      ["2026-08-24 7", "2026-08-31 7", "2026-09-07 7", "2026-09-14 7"],
    ]);
  });

  test("a window with no hour scored prints two lines and exits 0", async () => {
    const r = await runIn(join(projects, ".."), "trend", "--from", "2026-01-01", "--to", "2026-01-02", "--no-color");
    expect([r.code, r.err, r.out]).toEqual([
      0,
      "",
      "Thu 01/01 to Fri 02/01, 2 days: 0 hours with a session, 0h00 active\nno activity from 2026-01-01 to 2026-01-02\n",
    ]);
  });

  test("the empty window's JSON: zeros, one week, five entries with a null mean", async () => {
    const r = await run("trend", "--from", "2026-01-01", "--to", "2026-01-02", "--json");
    expect(JSON.parse(r.out)).toEqual({
      from: "2026-01-01",
      to: "2026-01-02",
      days: 2,
      hours: 0,
      activeMin: 0,
      levels: { Calm: 0, Warming: 0, Heating: 0, Fried: 0 },
      weeks: [{ from: "2026-01-01", to: "2026-01-02", days: 2, hours: 0, activeMin: 0, hot: 0, prompts: 0 }],
      bySessions: [1, 2, 3, 4, 5].map((sessions) => ({ sessions, hours: 0, mean: null })),
    });
  });

  test("a window that holds today ends with the as-of line, and its JSON carries asOf", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const text = await runIn(empty, "trend", "--days", "1", "--no-color");
    const lines = text.out.trimEnd().split("\n");
    expect(lines.slice(1)).toEqual([`no activity on ${today}`, expect.stringMatching(/^ {2}as of \d\d:\d\d, this hour is still running$/)]);
    const j = JSON.parse((await runIn(empty, "trend", "--days", "1", "--json")).out);
    expect(j.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  // One prompt from each of six sessions, at 10:00 to 10:05.
  const sixSessions = async (day: string, hour: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "cogload-trend-six-"));
    const at = (i: number) => `${day}T${hour}:0${i}:00.000Z`;
    await writeTree(
      dir,
      [1, 2, 3, 4, 5, 6].map((n, i) => ({
        path: `-Users-me-six/${n}.jsonl`,
        lines: [prompt(at(i), `${String(n).repeat(8)}-6666-4666-8666-666666666666`)],
        mtime: at(i),
      })),
    );
    return dir;
  };

  test("an hour of six sessions lands in the 5+ row", async () => {
    const dir = await sixSessions("2026-09-14", "10");
    try {
      const text = await runIn(dir, "trend", "--days", "1", "--to", "2026-09-14", "--no-color");
      expect(text.out.trimEnd().split("\n").at(-1)).toBe("5+            1          34");
      const j = JSON.parse((await runIn(dir, "trend", "--days", "1", "--to", "2026-09-14", "--json")).out);
      expect(j.bySessions[4]).toEqual({ sessions: 5, hours: 1, mean: 34 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a window that holds today and has hours ends with the as-of line after the tables", async () => {
    const now = new Date(Date.now() - 6 * 60_000).toISOString();
    const dir = await sixSessions(now.slice(0, 10), now.slice(11, 13));
    try {
      const lines = (await runIn(dir, "trend", "--days", "2", "--no-color")).out.trimEnd().split("\n");
      expect(lines.slice(-2)).toEqual([expect.stringMatching(/^5\+ {12}1 /), expect.stringMatching(/^ {2}as of \d\d:\d\d, this hour is still running$/)]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("--explain and --out are usage errors with trend", async () => {
    for (const [args, msg] of [
      [["--explain"], "cogload: --explain applies to a named day only"],
      [["--out", "x.png"], "cogload: --out applies to card only"],
    ] as const) {
      const r = await run("trend", ...args);
      expect([args.join(" "), r.code, r.out, r.err]).toEqual([args.join(" "), 2, "", `${msg}\nrun 'cogload --help' for usage\n`]);
    }
  });

  test("a pipe gets text without --json", async () => {
    const r = await run("trend", "--days", "7", "--to", "2026-09-20");
    expect(r.out.split("\n")[0]).toBe(WEEK[0]);
  });

  test("a terminal gets JSON with --json, and painted level names without it", async () => {
    const j = await runInTerminal({ NO_COLOR: "1" }, "trend", "--days", "7", "--to", "2026-09-20", "--json");
    expect(JSON.parse(j.out).hours).toBe(22);
    const t = await runInTerminal({ NO_COLOR: "" }, "trend", "--days", "7", "--to", "2026-09-20");
    expect(t.out.split("\n").slice(3, 7)).toEqual([
      "\x1b[32mcalm\x1b[0m          15    68%",
      "\x1b[33mwarming\x1b[0m        3    14%",
      "\x1b[38;5;208mheating\x1b[0m        1     5%",
      "\x1b[31mfried\x1b[0m          3    14%",
    ]);
  });

  test("--help names trend", async () => {
    const r = await run("--help");
    expect(r.out).toContain("cogload trend [window]");
  });
});
