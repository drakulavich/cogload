import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WEBVIEW_TEST_TIMEOUT, webviewMissing } from "../helpers/webview.ts";

// The card CLI's runs that draw a picture. The rest are in card-cli.test.ts.
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
const downloads = () => readdir(join(home, "Downloads"));

// The script points one stream away from the terminal; a run still going after `limitMs` is killed (code null).
async function runHalfTerminal(script: string, args: string[], limitMs: number): Promise<{ code: number | null; out: string }> {
  let out = "";
  const decoder = new TextDecoder();
  const p = Bun.spawn(["sh", "-c", script, CLI, "--projects", projects, ...args], {
    cwd,
    env: { ...process.env, TZ: "UTC", NO_COLOR: "1", HOME: home },
    terminal: { cols: 200, rows: 24, data(_t, d) { out += decoder.decode(d); } },
  });
  const code = await Promise.race([p.exited, Bun.sleep(limitMs).then(() => null)]);
  if (code === null) { p.kill(); await p.exited; }
  p.terminal!.close();
  return { code, out };
}

describe("zapara card", () => {
  test.skipIf(webviewMissing !== null)("without --out the card goes to Downloads and the line names the folder, not its path", async () => {
    const r = await run("card", "--to", "2026-09-20");
    expect(r.code).toBe(0);
    expect(r.out).toBe("The Marathoner: Longest streak 7h53m without a break, 68% of your hours calm.\nwrote zapara-card.png to Downloads\n");
    expect(await downloads()).toEqual(["zapara-card.png"]);
    expect(await files()).toEqual([]);
    const bytes = await readFile(join(home, "Downloads", "zapara-card.png"));
    expect(await new Bun.Image(bytes).metadata()).toMatchObject({ width: 2400, height: 1260, format: "png" });
  }, WEBVIEW_TEST_TIMEOUT);

  // The rendered bytes take a different write from the .html page in
  // card-cli.test.ts, so the picture needs its own proof that no path reaches stderr.
  test.skipIf(webviewMissing !== null)("a picture into a missing directory says the same and names no path", async () => {
    const r = await run("card", "--to", "2026-09-20", "--out", join(cwd, "missing", "c.png"));
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toBe("zapara: cannot write the card: check the --out directory\n");
    expect(r.err).not.toContain(cwd);
    expect(r.err).not.toContain("ENOENT");
  }, WEBVIEW_TEST_TIMEOUT);

  // root writes into a 0500 directory anyway
  test.skipIf(webviewMissing !== null || process.getuid?.() === 0)("a picture into a locked directory says the same and names no path", async () => {
    const locked = join(cwd, "locked-png");
    await mkdir(locked);
    await chmod(locked, 0o500);
    try {
      const l = await run("card", "--to", "2026-09-20", "--out", join(locked, "c.png"));
      expect(l.code).toBe(1);
      expect(l.out).toBe("");
      expect(l.err).toBe("zapara: cannot write the card: check the --out directory\n");
      expect(l.err).not.toContain(cwd);
      expect(l.err).not.toContain("EACCES");
    } finally {
      await chmod(locked, 0o700).catch(() => {});
    }
  }, WEBVIEW_TEST_TIMEOUT);

  test.skipIf(webviewMissing !== null)("a picture leaves no page behind in the temporary directory, drawn or not", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "zapara-tmp-"));
    try {
      const drawn = await runWith({ TMPDIR: tmp }, "card", "--to", "2026-09-20", "--out", "c.png");
      expect(drawn.code).toBe(0);
      const unwritable = await runWith({ TMPDIR: tmp }, "card", "--to", "2026-09-20", "--out", join(cwd, "missing", "c.png"));
      expect(unwritable.code).toBe(1);
      expect((await readdir(tmp)).filter((name) => name.startsWith("zapara-card-"))).toEqual([]);
    } finally { await rm(tmp, { recursive: true, force: true }); }
  }, WEBVIEW_TEST_TIMEOUT);

  for (const [name, format] of [["x.png", "png"], ["x.webp", "webp"]] as const) {
    test.skipIf(webviewMissing !== null)(`--out ${name} is a 2400x1260 picture`, async () => {
      const r = await run("card", "--to", "2026-09-20", "--out", name);
      expect(r.code).toBe(0);
      expect(r.out.endsWith(`wrote ${name}\n`)).toBe(true);
      expect(r.err).toBe(""); // a pipe gets no progress line
      const bytes = await readFile(join(cwd, name));
      expect(bytes.length).toBeGreaterThan(20_000);
      expect(await new Bun.Image(bytes).metadata()).toMatchObject({ width: 2400, height: 1260, format });
    }, WEBVIEW_TEST_TIMEOUT);
  }

  test.skipIf(webviewMissing !== null)("in a terminal, a picture says it is being drawn and clears that line before the result", async () => {
    const r = await runHalfTerminal('exec bun "$0" "$@" > out.txt', ["card", "--to", "2026-09-20", "--out", "c.png"], (WEBVIEW_TEST_TIMEOUT * 2) / 3);
    expect(r.code).toBe(0);
    expect(r.out).toBe("drawing the card…\r\x1b[K");
    expect(await readFile(join(cwd, "out.txt"), "utf8")).toMatch(/^The Marathoner:.*\nwrote c\.png\n$/);
  }, WEBVIEW_TEST_TIMEOUT);
});
