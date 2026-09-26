import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cardData, sentenceText } from "../../src/lib/card/index.ts";
import { report } from "../../src/lib/report/index.ts";
import { analyze } from "../../src/lib/metrics/index.ts";
import { prompt, transcript } from "../helpers/transcript.ts";

// The 7-day fixture seen through the card's default 14-day window ending on the
// fixture's Sunday: 22 active hours (15 Calm, 3 Warming, 1 Heating, 3 Fried).
const projects = join(import.meta.dir, "../fixtures/busy-week/projects");
const days = await report({ projects, to: "2026-09-20", days: 14 });
const card = cardData(days, { days: 14 })!;

describe("busy-week card", () => {
  test("the long calm days make it the Marathoner", () => {
    // Shares: conductor 0.31, supervisor 0.19, marathoner 0.99, night owl 0.14 (3 of 22 hours are late).
    expect(card.character).toBe("marathoner");
    expect(card.name).toBe("The Marathoner");
    expect(card.motto).toBe("You do not stop while it compiles.");
  });

  test("the sentence carries the longest streak and the calm share, in bold", () => {
    // Tuesday's calm 10-18 run of prompts reaches 473 min at hour 17 (10:00 to
    // 17:53) -> 7h53m; 15 of 22 hours are Calm -> 68%.
    expect(sentenceText(card.sentence)).toBe("Longest streak 7h53m without a break, 68% of your hours calm.");
    expect(card.sentence.filter((s) => s.strong).map((s) => s.text)).toEqual(["7h53m", "68%"]);
  });

  test("shares are the fraction of each character's maximum points", () => {
    expect(card.shares.conductor).toBeCloseTo(0.311, 2);
    expect(card.shares.supervisor).toBeCloseTo(0.195, 2);
    // Streak points total 217.3 of a possible 220. Twenty-one of the 22 active
    // hours hold 40 minutes or more of unbroken presence and cap at 10; only
    // Friday's half storm falls short, paying 10*(29/40) = 7.3 (the share sums
    // the displayed one-decimal part, not the raw 7.25).
    expect(card.shares.marathoner).toBeCloseTo(217.3 / 220, 12);
    expect(card.shares.nightOwl).toBeCloseTo(0.136, 2);
  });

  test("peak is Monday's storm", () => {
    expect(card.peak).toEqual({ index: 87, level: "Fried" });
  });

  test("spectrum: 15 / 3 / 1 / 3 of 22 hours -> 68 / 14 / 4 / 14, summing to 100", () => {
    // Raw 68.18 / 13.64 / 4.55 / 13.64, floors 68/13/4/13 = 98; warming and
    // fried hold the two largest remainders (.64 each) and take the two points
    // left over.
    expect(card.spectrum).toEqual({ calm: 68, warming: 14, heating: 4, fried: 14 });
    expect(Object.values(card.spectrum).reduce((a, b) => a + b, 0)).toBe(100);
  });

  test("highlights: the owned pair, then the largest remaining norm", () => {
    // Remaining norms: contextSwitches 54/45 = 1.2 beats peakSessions (5-1)/4 = 1.0,
    // tokensRead 207600/(65000*22) = 0.15 and reportsRead 0; lateShare is not eligible here.
    // Interrupts: 20 in each of Monday's three storm hours, 10 in Friday's half one.
    expect(card.highlights).toEqual([
      { key: "longestStreak", value: "7h53m", caption: "longest streak" },
      { key: "interrupts", value: "70", caption: "times you stopped Claude" },
      { key: "contextSwitches", value: "54", caption: "switches in one hour" },
    ]);
  });

  test("days is the window's", () => {
    expect(card.days).toBe(14);
  });
});

describe("the longest streak on the card is exact", () => {
  // One unbroken run 08:30 to 10:00, a break, then a lone prompt at 10:50. The
  // run's full 90 minutes belong to hour 10, where it ended, so that is what
  // the card shows; hour 9 saw only its first 85.
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  const lines = [];
  for (let m = 0; m <= 90; m += 5) lines.push(prompt(new Date(Date.UTC(2026, 8, 14, 8, 30 + m)).toISOString(), A));
  lines.push(prompt("2026-09-14T10:50:00.000Z", A));
  const day = analyze([transcript(lines)], { to: "2026-09-14", days: 1 });
  const c = cardData(day, { days: 1 })!;

  test("the highlight reads the whole run, not the hour it started in", () => {
    expect(c.highlights[0]).toEqual({ key: "longestStreak", value: "1h30m", caption: "longest streak" });
  });

  test("the sentence carries the same figure", () => {
    expect(sentenceText(c.sentence)).toContain("Longest streak 1h30m without a break");
  });
});
