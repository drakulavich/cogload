import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cardData, cardHtml, loadAssets } from "../../src/lib/card/index.ts";
import { report } from "../../src/lib/report/index.ts";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const projects = join(import.meta.dir, "../fixtures/busy-week/projects");
let cwd: string;
let home: string;
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "zapara-card-"));
  home = await mkdtemp(join(tmpdir(), "zapara-home-"));
  await mkdir(join(home, "Downloads"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ code: number; out: string; err: string }> {
  return runWith({}, ...args);
}
async function runWith(env: Record<string, string>, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(["bun", CLI, "--projects", projects, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home, ...env } });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}
const files = () => readdir(cwd);

// Warmed once: macOS checks a fresh executable for ~400 ms before running it.
let bin: string;
let log: string;
beforeAll(async () => {
  bin = await mkdtemp(join(tmpdir(), "zapara-bin-"));
  log = join(bin, "opened.log");
  for (const name of ["open", "xdg-open"]) {
    await writeFile(join(bin, name), '#!/bin/sh\nprintf \'%s\\n\' "$@" >> "$ZAPARA_TEST_LOG"\n', { mode: 0o755 });
  }
  Bun.spawnSync([join(bin, "open"), "warm"], { env: { ...process.env, ZAPARA_TEST_LOG: log } });
});
afterAll(() => rm(bin, { recursive: true, force: true }));
beforeEach(() => rm(log, { force: true }));

const opened = async (): Promise<string[]> => {
  const text = await Bun.file(log).text().catch(() => "");
  return text.split("\n").filter(Boolean);
};
async function openedWithin(ms: number): Promise<string[]> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const lines = await opened();
    if (lines.length > 0) return lines;
    await Bun.sleep(25);
  }
  return opened();
}

// A run that exits without asking returns at once: a missing question fails an assertion.
async function runInTerminal(answer: string, args: string[], answerAfterMs = 0): Promise<{ code: number; out: string }> {
  let out = "";
  const decoder = new TextDecoder();
  const p = Bun.spawn(["bun", CLI, "--projects", projects, ...args], {
    cwd,
    env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home, PATH: `${bin}:${process.env.PATH}`, ZAPARA_TEST_LOG: log },
    terminal: { cols: 200, rows: 24, data(_t, d) { out += decoder.decode(d); } },
  });
  while (!out.includes("open it? [Y/n] ") && p.exitCode === null) await Bun.sleep(20);
  await Bun.sleep(answerAfterMs);
  if (p.exitCode === null) p.terminal!.write(answer);
  const code = await p.exited;
  p.terminal!.close();
  return { code, out };
}

// The script points one stream away from the terminal; a run still going after `limitMs` is killed (code null).
async function runHalfTerminal(script: string, args: string[], limitMs = 5000): Promise<{ code: number | null; out: string }> {
  let out = "";
  const decoder = new TextDecoder();
  const p = Bun.spawn(["sh", "-c", script, CLI, "--projects", projects, ...args], {
    cwd,
    env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home, PATH: `${bin}:${process.env.PATH}`, ZAPARA_TEST_LOG: log },
    terminal: { cols: 200, rows: 24, data(_t, d) { out += decoder.decode(d); } },
  });
  const code = await Promise.race([p.exited, Bun.sleep(limitMs).then(() => null)]);
  if (code === null) { p.kill(); await p.exited; }
  p.terminal!.close();
  return { code, out };
}

describe("zapara card", () => {
  test("--out x.html writes exactly the cardHtml string and prints the two lines", async () => {
    const r = await run("card", "--to", "2026-09-20", "--out", "./x.html");
    expect(r.code).toBe(0);
    expect(r.out).toBe("The Marathoner: Longest streak 7h53m without a break, 68% of your hours calm.\nwrote ./x.html\n");
    const expected = cardHtml(cardData(await report({ projects, to: "2026-09-20", days: 14 }), { days: 14 })!, await loadAssets());
    expect(await readFile(join(cwd, "x.html"), "utf8")).toBe(expected);
  });

  test("--out X.HTML is case-insensitive and writes exactly the cardHtml string", async () => {
    const r = await run("card", "--to", "2026-09-20", "--out", "X.HTML");
    expect(r.code).toBe(0);
    expect(r.out.endsWith("wrote X.HTML\n")).toBe(true);
    const expected = cardHtml(cardData(await report({ projects, to: "2026-09-20", days: 14 }), { days: 14 })!, await loadAssets());
    expect(await readFile(join(cwd, "X.HTML"), "utf8")).toBe(expected);
  });

  test("--json prints the data with the window's dates and writes no file", async () => {
    const r = await run("card", "--to", "2026-09-20", "--json");
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(Object.keys(j)).toEqual(["from", "to", "days", "character", "name", "sentence", "motto", "shares", "peak", "spectrum", "highlights"]);
    expect(j.from).toBe("2026-09-07");
    expect(j.to).toBe("2026-09-20");
    expect(j.days).toBe(14);
    expect(j.sentence).toBe("Longest streak 7h53m without a break, 68% of your hours calm.");
    expect(j.motto).toBe("You do not stop while it compiles.");
    expect(j.shares.marathoner).toBe(0.99); // 217.3 of 220 streak points, rounded to two decimals for the JSON
    expect(j.shares.conductor).toBe(0.31);
    expect(j.peak).toEqual({ index: 87, level: "Fried" });
    expect(j.highlights[0]).toEqual({ key: "longestStreak", value: "7h53m", caption: "longest streak" });
    expect(await files()).toEqual([]);
  });

  test("card takes the grid's window flags: --from/--to set from, to and days", async () => {
    const j = JSON.parse((await run("card", "--from", "2026-09-13", "--to", "2026-09-14", "--json")).out);
    expect([j.from, j.to, j.days]).toEqual(["2026-09-13", "2026-09-14", 2]);
    const k = JSON.parse((await run("card", "--days", "3", "--to", "2026-09-14", "--json")).out);
    expect([k.from, k.to, k.days]).toEqual(["2026-09-12", "2026-09-14", 3]);
    // The window changes the picture: the 14-day card reads 7h53m (the test above); Monday alone does not.
    expect(j.sentence).not.toContain("7h53m");
  });

  test("a pipe without --json still writes the picture", async () => {
    // Rule: card ignores the TTY default that makes the grid and a day print JSON in a pipe.
    const r = await run("card", "--to", "2026-09-20", "--out", "p.html");
    expect(r.out.endsWith("wrote p.html\n")).toBe(true);
    expect(await files()).toEqual(["p.html"]);
  });

  test("without a Downloads folder the default exits 1 with one line that names no path, and writes nothing", async () => {
    await rm(join(home, "Downloads"), { recursive: true });
    const r = await run("card", "--to", "2026-09-20");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("zapara: no Downloads folder: pass --out <path>\n");
    expect(await files()).toEqual([]);
    expect(await readdir(home)).not.toContain("Downloads"); // never created
  });

  test("a file named Downloads is not a Downloads folder", async () => {
    await rm(join(home, "Downloads"), { recursive: true });
    await Bun.write(join(home, "Downloads"), "");
    const r = await run("card", "--to", "2026-09-20");
    expect(r.code).toBe(1);
    expect(r.err).toBe("zapara: no Downloads folder: pass --out <path>\n");
  });

  test("--out and --json need no Downloads folder", async () => {
    await rm(join(home, "Downloads"), { recursive: true });
    const o = await run("card", "--to", "2026-09-20", "--out", "c.html");
    expect(o.code).toBe(0);
    expect(o.out.endsWith("wrote c.html\n")).toBe(true);
    expect(await files()).toEqual(["c.html"]);
    const j = await run("card", "--to", "2026-09-20", "--json");
    expect(j.code).toBe(0);
    expect(JSON.parse(j.out).name).toBe("The Marathoner");
    expect(await readdir(home)).not.toContain("Downloads"); // never created
  });

  test("an empty window exits 1 with one line and writes nothing", async () => {
    const r = await run("card", "--to", "2026-08-20", "--days", "3", "--out", "x.html");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("zapara: no activity in the last 3 days\n");
    expect(await files()).toEqual([]);
  });

  test("bad --out values exit 2, print one stderr line without the value, and write nothing", async () => {
    for (const out of ["x.gif", "x", "a\nb.png", "\x1b[31mx.png", "x\x7f.png"]) {
      const r = await run("card", "--to", "2026-09-20", "--out", out);
      expect(r.code).toBe(2);
      expect(r.out).toBe("");
      expect(r.err.startsWith("zapara: --out ")).toBe(true);
      expect(r.err).toContain("run 'zapara --help' for usage");
      expect(r.err).not.toContain("\x1b");
      expect(r.err).not.toContain("a\nb");
      expect(await files()).toEqual([]);
    }
  });

  test("a card that cannot be written exits 1 with one line that names no path", async () => {
    // .html needs no browser engine, so this is the write and nothing else.
    const r = await run("card", "--to", "2026-09-20", "--out", join(cwd, "missing", "c.html"));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("zapara: cannot write the card: check the --out directory\n");
    expect(r.err).not.toContain(cwd);
    expect(r.err).not.toContain("ENOENT");
  });

  test("a directory that refuses the write says the same and still names no path", async () => {
    if (process.getuid?.() === 0) return; // root writes into a 0500 directory anyway
    const locked = join(cwd, "locked");
    await mkdir(locked);
    await chmod(locked, 0o500);
    try {
      const r = await run("card", "--to", "2026-09-20", "--out", join(locked, "c.html"));
      expect(r.code).toBe(1);
      expect(r.out).toBe("");
      expect(r.err).toBe("zapara: cannot write the card: check the --out directory\n");
      expect(r.err).not.toContain(cwd);
      expect(r.err).not.toContain("EACCES");
    } finally {
      await chmod(locked, 0o700).catch(() => {});
    }
  });

  test("a picture with no writable temporary directory exits 1 with one line that names no path", async () => {
    const tmp = join(cwd, "no-such-tmp");
    const r = await runWith({ TMPDIR: tmp }, "card", "--to", "2026-09-20", "--out", "c.png");
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("zapara: cannot draw the card: the temporary directory is not writable\n");
    expect(await files()).toEqual([]);
  });

  test("--out on the grid and --explain on card are usage errors", async () => {
    expect((await run("--out", "x.png")).code).toBe(2);
    expect((await run("card", "--explain")).code).toBe(2);
    expect((await run("card", "--days", "91", "--out", "x.html")).code).toBe(2);
  });

  // Linux uses Bun's Chromium backend; a path to nothing forces its failure path.
  test.skipIf(process.platform !== "linux")("without a browser engine, card names what to install and the way around it", async () => {
    const p = Bun.spawn(["bun", CLI, "--projects", projects, "card", "--to", "2026-09-20", "--out", "c.png"], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home, BUN_CHROME_PATH: join(cwd, "no-such-browser") } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe("zapara: card needs a browser engine: install a Chromium browser such as Chrome or Edge, or write --out card.html\n");
  });

  test("in a terminal, Enter and y open the card by its absolute path", async () => {
    for (const answer of ["\r", "y\r", " YES \r"]) {
      await rm(log, { force: true });
      const r = await runInTerminal(answer, ["card", "--to", "2026-09-20", "--out", "c.html"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("wrote c.html\r\nopen it? [Y/n] ");
      const lines = await openedWithin(2000);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.startsWith("/")).toBe(true);
      expect(await realpath(lines[0]!)).toBe(await realpath(join(cwd, "c.html")));
    }
  }, 20_000);

  test("an --out that starts with a dash reaches the opener as a file, not an option", async () => {
    const r = await runInTerminal("y\r", ["card", "--to", "2026-09-20", "--out=-card.html"]);
    expect(r.code).toBe(0);
    const lines = await openedWithin(2000);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.startsWith("/")).toBe(true);
    expect(lines[0]!.endsWith("/-card.html")).toBe(true);
  }, 10_000);

  test("in a terminal, n and end of input exit 0 and open nothing", async () => {
    for (const answer of ["n\r", "\x04"]) {
      const r = await runInTerminal(answer, ["card", "--to", "2026-09-20", "--out", "c.html"]);
      expect(r.code).toBe(0);
      expect(r.out).toContain("open it? [Y/n] ");
      expect(r.out).not.toContain("drawing"); // a page is written, not drawn
      expect(await files()).toEqual(["c.html"]);
    }
    expect(await openedWithin(2000)).toEqual([]);
  }, 20_000);

  test("--verbose leaves the wait for an answer out of the total", async () => {
    const r = await runInTerminal("n\r", ["card", "--to", "2026-09-20", "--out", "c.html", "--verbose"], 3000);
    expect(r.code).toBe(0);
    const total = Number(/^total\s+(\d+) ms/m.exec(r.out)?.[1]);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThan(3000);
  }, 20_000);

  test("in a pipe there is no question and no read from stdin", async () => {
    // stdin stays open: a run that asked would hang.
    const p = Bun.spawn(["bun", CLI, "--projects", projects, "card", "--to", "2026-09-20", "--out", "c.html"], {
      cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home, PATH: `${bin}:${process.env.PATH}`, ZAPARA_TEST_LOG: log },
    });
    const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    expect(code).toBe(0);
    expect(out.endsWith("wrote c.html\n")).toBe(true);
    expect(out).not.toContain("open it?");
    expect(await openedWithin(1000)).toEqual([]);
  }, 10_000);

  test("with stdin a terminal but stdout a file there is no question and no read", async () => {
    const r = await runHalfTerminal('exec bun "$0" "$@" > out.txt', ["card", "--to", "2026-09-20", "--out", "c.html"]);
    expect(r.code).toBe(0);
    const out = await readFile(join(cwd, "out.txt"), "utf8");
    expect(out.endsWith("wrote c.html\n")).toBe(true);
    expect(out).not.toContain("open it?");
    expect(await openedWithin(1000)).toEqual([]);
  }, 10_000);

  test("with stdout a terminal but stdin a pipe there is no question and no read", async () => {
    // A run that asked would read this "y" and open the card.
    const r = await runHalfTerminal('printf "y\\n" | exec bun "$0" "$@"', ["card", "--to", "2026-09-20", "--out", "c.html"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("wrote c.html\r\n");
    expect(r.out).not.toContain("open it?");
    expect(await openedWithin(1000)).toEqual([]);
  }, 10_000);
});
