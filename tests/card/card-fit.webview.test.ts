import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CardData, Character, Segment } from "../../src/lib/card/index.ts";
import { cardHtml, loadAssets, renderCard } from "../../src/lib/card/index.ts";
import { openPage, WEBVIEW_STEP_TIMEOUT, WEBVIEW_TEST_TIMEOUT, webviewMissing } from "../helpers/webview.ts";

const assets = await loadAssets();
const strong = (text: string): Segment => ({ text, strong: true });
const plain = (text: string): Segment => ({ text, strong: false });

// Names and mottos are spelled out here on purpose: the test pins the page against
// the spec's copy, not against whatever src/card.ts exports.
const NAMES: Record<Character, string> = { conductor: "The Conductor", supervisor: "The Supervisor", marathoner: "The Marathoner", nightOwl: "The Night Owl" };
const MOTTOS: Record<Character, string> = {
  conductor: "You run agents like an orchestra.",
  supervisor: "Nothing ships without your eyes on it.",
  marathoner: "You do not stop while it compiles.",
  nightOwl: "The best commits happen after midnight.",
};
// Every value at its longest form from the spec's format table.
const SENTENCES: Record<Character, Segment[]> = {
  conductor: [strong("999B+ sessions"), plain(" at once, "), strong("999B+ context switches"), plain(" in one hour.")],
  supervisor: [strong("999B+ agent reports"), plain(" and "), strong("999B+ tokens"), plain(" of output read.")],
  marathoner: [plain("Longest streak "), strong("999h+"), plain(" without a break, "), strong("100%"), plain(" of your hours calm.")],
  nightOwl: [strong("100%"), plain(" of your hours "), strong("after midnight"), plain(".")],
};
const longest = (character: Character): CardData => ({
  days: 90,
  character,
  name: NAMES[character],
  sentence: SENTENCES[character],
  motto: MOTTOS[character],
  shares: { conductor: 1, supervisor: 1, marathoner: 1, nightOwl: 1 },
  peak: { index: 100, level: "Fried" },
  spectrum: { calm: 100, warming: 0, heating: 0, fried: 0 },
  highlights: [
    { key: "interrupts", value: "999B+", caption: "times you stopped Claude" },
    { key: "lateShare", value: "100%", caption: "of hours after midnight" },
    { key: "longestStreak", value: "999h+", caption: "tokens of output read" },
  ],
});

// Measured inside the page, so zoom applies equally to both sides of each comparison.
const MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const sentence = q(".sentence"), panel = q(".panel"), repo = q(".repo"), source = q(".source"), row = q(".row");
  const lineHeight = parseFloat(getComputedStyle(sentence).lineHeight);
  return {
    sentenceLines: Math.round(sentence.offsetHeight / lineHeight),
    panelOverflow: panel.scrollHeight - panel.clientHeight,
    nameOverflow: q(".name").scrollWidth - q(".name").clientWidth,
    rowOverflow: row.scrollWidth - row.clientWidth,
    legendOverflow: q(".legend").scrollWidth - q(".legend").clientWidth,
    valueOverflows: [...document.querySelectorAll(".stat .v, .stat .c")].map((e) => e.scrollWidth - e.clientWidth),
    footerGap: source.getBoundingClientRect().left - repo.getBoundingClientRect().right,
  };
})()`;
type Measure = { sentenceLines: number; panelOverflow: number; nameOverflow: number; rowOverflow: number; legendOverflow: number; valueOverflows: number[]; footerGap: number };

describe("the longest values fit the layout", () => {
  for (const character of ["conductor", "supervisor", "marathoner", "nightOwl"] as const) {
    test.skipIf(webviewMissing !== null)(character, async () => {
      const view = await openPage(cardHtml(longest(character), assets), 2400, 1260);
      try {
        const m = await view.evaluate<Measure>(MEASURE);
        expect(m.sentenceLines).toBeLessThanOrEqual(3);
        expect(m.panelOverflow).toBeLessThanOrEqual(0);
        expect(m.nameOverflow).toBeLessThanOrEqual(0);
        expect(m.rowOverflow).toBeLessThanOrEqual(0);
        expect(m.legendOverflow).toBeLessThanOrEqual(0);
        for (const o of m.valueOverflows) expect(o).toBeLessThanOrEqual(0);
        expect(m.footerGap).toBeGreaterThan(0);
      } finally {
        view.close();
      }
    }, WEBVIEW_TEST_TIMEOUT);
  }
});

describe("renderCard", () => {
  test("writes the page as is for .html without an engine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-render-"));
    try {
      const html = cardHtml(longest("conductor"), assets);
      await renderCard(html, join(dir, "c.html"));
      expect(await readFile(join(dir, "c.html"), "utf8")).toBe(html);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test.skipIf(webviewMissing !== null)("writes a 2400x1260 PNG and a 2400x1260 WebP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-render-"));
    try {
      const html = cardHtml(longest("supervisor"), assets);
      await renderCard(html, join(dir, "c.png"), WEBVIEW_STEP_TIMEOUT);
      await renderCard(html, join(dir, "c.webp"), WEBVIEW_STEP_TIMEOUT);
      const png = await readFile(join(dir, "c.png"));
      const webp = await readFile(join(dir, "c.webp"));
      expect(await new Bun.Image(png).metadata()).toMatchObject({ width: 2400, height: 1260, format: "png" });
      expect(await new Bun.Image(webp).metadata()).toMatchObject({ width: 2400, height: 1260, format: "webp" });
      expect(png.length).toBeGreaterThan(20_000);
      expect(webp.length).toBeGreaterThan(20_000);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, WEBVIEW_TEST_TIMEOUT);

  // A page laid out at 1200x630 with zoom 2, as cardHtml is, fills the whole picture
  // at any screen density: each quadrant's colour lands in its own quarter.
  test.skipIf(webviewMissing !== null)("the whole 1200x630 page fills the 2400x1260 picture", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-render-"));
    const quad = (left: number, top: number, color: string) => `<div style="position:absolute;left:${left}px;top:${top}px;width:600px;height:315px;background:${color}"></div>`;
    const html = `<!doctype html><html><head><style>html{zoom:2}html,body{margin:0}</style></head><body>${quad(0, 0, "#f00")}${quad(600, 0, "#0f0")}${quad(0, 315, "#00f")}${quad(600, 315, "#ff0")}</body></html>`;
    try {
      await renderCard(html, join(dir, "q.png"), WEBVIEW_STEP_TIMEOUT);
      const png = (await readFile(join(dir, "q.png"))).toString("base64");
      const view = await openPage(`<canvas width=2400 height=1260></canvas><img id=i src="data:image/png;base64,${png}">`, 100, 100);
      try {
        const colors = await view.evaluate<string[]>(`(() => {
          const c = document.querySelector("canvas").getContext("2d");
          c.drawImage(document.getElementById("i"), 0, 0);
          return [[600, 315], [1800, 315], [600, 945], [1800, 945]].map(([x, y]) =>
            Array.from(c.getImageData(x, y, 1, 1).data.slice(0, 3)).map((v) => (v > 127 ? "1" : "0")).join(""));
        })()`);
        expect(colors).toEqual(["100", "010", "001", "110"]);
      } finally { view.close(); }
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, WEBVIEW_TEST_TIMEOUT);

  // No page reliably hangs (a broken <img> or @font-face settles on WebKit), so a
  // 1 ms budget, which no render meets, is what reaches the deadline.
  test.skipIf(webviewMissing !== null)("a render past its budget fails with its own line and writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-render-"));
    try {
      await expect(renderCard(cardHtml(longest("conductor"), assets), join(dir, "c.png"), 1)).rejects.toThrow(/^render timed out$/);
      expect(await readdir(dir)).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, WEBVIEW_TEST_TIMEOUT);

  // A view left open keeps its process alive, so the exit is what shows the close.
  test.skipIf(webviewMissing !== null)("a render past its budget closes its view, so the process can exit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zapara-render-"));
    try {
      const child = Bun.spawn(["bun", join(import.meta.dir, "../helpers/render-timeout.ts"), join(dir, "c.png")], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC" } });
      const code = await Promise.race([child.exited, Bun.sleep(5_000).then(() => null)]);
      if (code === null) child.kill();
      expect(code).toBe(0);
      expect(await new Response(child.stdout).text()).toBe("render timed out\n");
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, WEBVIEW_TEST_TIMEOUT);
});
