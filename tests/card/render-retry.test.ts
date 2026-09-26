import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderCard, type CardView, type OpenView } from "../../src/image.ts";

const ENGINE_LINE = "card needs a browser engine: install Google Chrome, or write --out card.html";
const shot = await new Bun.Image(await readFile(join(import.meta.dir, "../../assets/characters.webp"))).resize(2400, 1260, { fit: "fill" }).png().bytes();
const never = () => new Promise<never>(() => {});

type Behavior = "renders" | "stalls" | "engine fails";
function views(...behaviors: Behavior[]): { open: OpenView; log: string[] } {
  const log: string[] = [];
  let n = 0;
  const open: OpenView = () => {
    const i = ++n;
    const behavior = behaviors[i - 1] ?? "renders";
    log.push(`open ${i}`);
    const view = {
      navigate: () => behavior === "stalls" ? never() : behavior === "engine fails" ? Promise.reject(new Error("WebKit crashed at /private/secret")) : Promise.resolve(),
      evaluate: (script: string) => Promise.resolve(script === "devicePixelRatio" ? 1 : true),
      resize: () => Promise.resolve(),
      screenshot: () => Promise.resolve(Buffer.from(shot)),
      close: () => { log.push(`close ${i}`); },
    };
    return view as unknown as CardView;
  };
  return { open, log };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zapara-retry-")); });
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("renderCard with a view that stops answering", () => {
  test("a stalled view is closed and a fresh one draws the card", async () => {
    const { open, log } = views("stalls", "renders");
    await renderCard("<p>card</p>", join(dir, "c.png"), 400, open);
    expect(log).toEqual(["open 1", "close 1", "open 2", "close 2"]);
    expect(await new Bun.Image(await readFile(join(dir, "c.png"))).metadata()).toMatchObject({ width: 2400, height: 1260, format: "png" });
  });

  test("an engine failure is not retried and says only the engine line", async () => {
    const { open, log } = views("engine fails", "renders");
    await expect(renderCard("<p>card</p>", join(dir, "c.png"), 400, open)).rejects.toThrow(new Error(ENGINE_LINE));
    expect(log).toEqual(["open 1", "close 1"]);
    expect(await readdir(dir)).toEqual([]);
  });

  test("two stalled views end in the timeout line within the budget, both closed", async () => {
    const { open, log } = views("stalls", "stalls");
    const t = performance.now();
    await expect(renderCard("<p>card</p>", join(dir, "c.png"), 400, open)).rejects.toThrow(/^render timed out$/);
    expect(performance.now() - t).toBeLessThan(500);
    expect(log).toEqual(["open 1", "close 1", "open 2", "close 2"]);
    expect(await readdir(dir)).toEqual([]);
  });
});
