import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { prompt, transcript } from "../helpers/transcript.ts";

const S = "11111111-1111-4111-8111-111111111111";

describe("hour and day edges", () => {
  test("last millisecond stays in its hour, next millisecond moves on", () => {
    const d = analyze([transcript([
      prompt("2026-09-14T13:59:59.999Z", S),
      prompt("2026-09-14T14:00:00.000Z", S),
    ])], { to: "2026-09-14", days: 1 })[0]!;
    expect(d.buckets[13]!.prompts).toBe(1);
    expect(d.buckets[14]!.prompts).toBe(1);
  });

  test("midnight splits days; the window ends at the end of --to", () => {
    const days = analyze([transcript([
      prompt("2026-09-13T23:59:59.000Z", S),
      prompt("2026-09-14T00:00:00.000Z", S),
      prompt("2026-09-15T00:00:00.000Z", S), // after the window
    ])], { to: "2026-09-14", days: 2 });
    expect(days.map((d) => d.date)).toEqual(["2026-09-13", "2026-09-14"]);
    expect(days[0]!.buckets[23]!.prompts).toBe(1);
    expect(days[1]!.buckets[0]!.prompts).toBe(1);
    expect(days[1]!.totals.prompts).toBe(1);
  });

  test("a window of 7 days lists dates oldest first ending at --to", () => {
    const days = analyze([], { to: "2026-09-14", days: 7 });
    expect(days.map((d) => d.date)).toEqual(["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(days.every((d) => d.peak === null && d.activeMin === 0)).toBe(true);
  });

  test("late-night hours flag 23 and 0-5 only", () => {
    const d = analyze([transcript([prompt("2026-09-14T05:30:00.000Z", S), prompt("2026-09-14T06:30:00.000Z", S), prompt("2026-09-14T23:30:00.000Z", S)])], { to: "2026-09-14", days: 1 })[0]!;
    expect(d.buckets[5]!.lateNight).toBe(true);
    expect(d.buckets[6]!.lateNight).toBe(false);
    expect(d.buckets[23]!.lateNight).toBe(true);
    // one lone prompt in each hour: pace 15*(1/20) = 0.75, everything else 0.
    // 05:00 is late: 10 + 0.75 = 10.75 → 11. 06:00 is not: 0.75 → 1.
    expect(d.buckets[5]!.score!.index).toBe(11);
    expect(d.buckets[6]!.score!.index).toBe(1);
  });
});
