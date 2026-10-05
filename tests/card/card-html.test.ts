import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cardData, type CardData, cardHtml, loadAssets } from "../../src/lib/card/index.ts";
import { report } from "../../src/lib/report/index.ts";

const projects = join(import.meta.dir, "../fixtures/busy-week/projects");
const days = await report({ projects, to: "2026-09-20", days: 14 });
const card = cardData(days, { days: 14 })!;
const assets = await loadAssets();
const html = cardHtml(card, assets);
const count = (s: string, needle: string): number => s.split(needle).length - 1;

// Regenerate with: bun scripts/card-golden.ts
const GOLDEN = "1ef85879d67cad5243703baa9fc9a7f1fad9b81ad656ac3f049c7a2fdd642506";

describe("card page for busy-week", () => {
  test("name and sentence appear once, the motto follows the sentence", () => {
    expect(count(html, "The Marathoner")).toBe(1);
    expect(count(html, "Longest streak <b>7h53m</b> without a break, <b>68%</b> of your hours calm. You do not stop while it compiles.")).toBe(1);
  });

  test("the window label and the peak pill", () => {
    expect(html).toContain('<div class="label mono">Last 14 days</div>');
    expect(html).toContain('<b class="fried">87 · Fried</b>');
  });

  test("the spectrum bar has one segment per nonzero level, with the pinned widths, in level order", () => {
    // busy-week reaches all four levels: 15 Calm, 3 Warming, 1 Heating (Friday's
    // half storm) and 3 Fried of 22 hours, so every segment is drawn. The rule
    // for a level at 0% is pinned separately below.
    const segments = [...html.matchAll(/<div class="(calm|warm|heat|fried)" style="width:(\d+)%"><\/div>/g)].map((m) => `${m[1]} ${m[2]}%`);
    expect(segments).toEqual(["calm 68%", "warm 14%", "heat 4%", "fried 14%"]);
  });

  test("three highlight panels in the pinned order", () => {
    const keys = [...html.matchAll(/<div class="stat" data-key="(\w+)">/g)].map((m) => m[1]);
    expect(keys).toEqual(["longestStreak", "interrupts", "contextSwitches"]);
    expect(html).toContain('<div class="v">7h53m</div><div class="c mono">longest streak</div>');
  });

  test("the character box carries the marathoner's class", () => {
    expect(html).toMatch(/<div class="char marathoner" style="background-size:/);
  });

  test("fonts and the sheet are embedded, nothing is referenced", () => {
    expect(count(html, "data:font/woff2;base64,")).toBe(4);
    expect(count(html, "data:image/webp;base64,")).toBe(1);
    // Base64 contains "//" and the grain tile's SVG namespace is not a reference.
    // The namespace literal is removed first: stripping data: URIs down to their
    // first quote would otherwise eat the "xmlns=" prefix and leave "http:" behind.
    const stripped = html.replace("xmlns='http://www.w3.org/2000/svg'", "").replace(/data:[^"')]+/g, "data:");
    expect(stripped).not.toContain("http:");
    expect(stripped).not.toContain("https:");
    expect(stripped).not.toContain("//");
  });

  test("no date reaches the page", () => {
    expect(html).not.toContain("2026-");
  });

  test("the page is laid out at 1200x630 and zoomed twice", () => {
    expect(html).toContain("html{zoom:2}");
    expect(html).toContain(".card{position:relative;width:1200px;height:630px;");
  });

  test("golden: any change to the look is acknowledged here", () => {
    expect(new Bun.CryptoHasher("sha256").update(html).digest("hex")).toBe(GOLDEN);
  });
});

describe("card page rules", () => {
  test("a 0% level has no bar segment but keeps its legend entry", () => {
    const solo: CardData = { ...card, spectrum: { calm: 100, warming: 0, heating: 0, fried: 0 } };
    const page = cardHtml(solo, assets);
    expect([...page.matchAll(/style="width:(\d+)%"/g)].map((m) => m[1])).toEqual(["100"]);
    expect(page).toContain("<b>0%</b> fried");
  });

  test("Last 1 day for a one-day window", () => {
    expect(cardHtml({ ...card, days: 1 }, assets)).toContain(">Last 1 day<");
  });

  test("each character gets its own accent and sprite rectangle", () => {
    const pages = (["conductor", "supervisor", "marathoner", "nightOwl"] as const).map((character) => cardHtml({ ...card, character }, assets));
    const positions = pages.map((p) => /background-position:([^;]+);/.exec(p)![1]);
    expect(new Set(positions).size).toBe(4);
    expect(pages[0]).toContain("--accent:#8b5cf6;");
    expect(pages[1]).toContain("--accent:#22d3ee;");
    expect(pages[2]).toContain("--accent:#f59e0b;");
    expect(pages[3]).toContain("--accent:#60a5fa;");
  });

  test("each character's sprite box is 360px on its long side, centred at (195,300), inside the card", () => {
    for (const character of ["conductor", "supervisor", "marathoner", "nightOwl"] as const) {
      const page = cardHtml({ ...card, character }, assets);
      const style = new RegExp(`<div class="char ${character}" style="([^"]+)">`).exec(page)![1]!;
      const px = (name: string): number => Number(new RegExp(`${name}:(-?\\d+\\.\\d)px`).exec(style)![1]);
      const width = px("width");
      const height = px("height");
      const left = px("left");
      const top = px("top");
      expect(Math.abs(Math.max(width, height) - 360.0)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(left + width / 2 - 195.0)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(top + height / 2 - 300.0)).toBeLessThanOrEqual(0.1);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(1200);
      expect(top + height).toBeLessThanOrEqual(630);
    }
  });
});

describe("loadAssets", () => {
  test("returns five non-empty base64 strings and the sheet decodes to 1024x1024", async () => {
    for (const s of [assets.fonts.inter400, assets.fonts.inter700, assets.fonts.inter800, assets.fonts.mono500, assets.characters]) {
      expect(s.length).toBeGreaterThan(1000);
      expect(s).toMatch(/^[A-Za-z0-9+/]+=*$/);
    }
    expect(await new Bun.Image(Buffer.from(assets.characters, "base64")).metadata()).toMatchObject({ width: 1024, height: 1024 });
  });
});
