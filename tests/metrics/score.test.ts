import { describe, expect, test } from "bun:test";
import { score, levelOf } from "../../src/lib/metrics/index.ts";
import type { Level, Metrics } from "../../src/lib/types.ts";

const base: Metrics = {
  sessions: 1, prompts: 0, reports: 0, outputTokens: 0, interrupts: 0, rejects: 0, questions: 0, plans: 0, modeSwitches: 0,
  decisions: 0, contextSwitches: 0, activeMin: 5, streakMin: 0, lateNight: false,
};
const m = (over: Partial<Metrics>): Metrics => ({ ...base, ...over });

describe("score", () => {
  test.each<[string, Partial<Metrics>, number]>([
    ["idle single session", {}, 0],
    ["3 sessions = half of parallel weight", { sessions: 3 }, 13],                    // 25*(2/4) = 12.5 → 13
    ["5 sessions caps parallel", { sessions: 5 }, 25],                                // 25*(4/4) = 25
    ["9 sessions still capped", { sessions: 9 }, 25],                                 // clamp(8/4) = 1 → 25
    ["10 prompts = half pace", { prompts: 10 }, 8],                                   // 15*(10/20) = 7.5 → 8
    ["20 prompts caps pace", { prompts: 20 }, 15],                                    // 15*(20/20) = 15
    ["40 prompts still capped", { prompts: 40 }, 15],                                 // clamp(40/20) = 1 → 15
    ["5 decisions = a third of supervision", { decisions: 5 }, 10],                   // 30*(3*5/45) = 10
    ["15 decisions cap supervision alone", { decisions: 15 }, 30],                    // 30*(45/45) = 30
    ["30 decisions still capped", { decisions: 30 }, 30],                             // clamp(90/45) = 1 → 30
    ["45 reports cap supervision alone", { reports: 45 }, 30],                        // 30*(45/45) = 30
    ["9 reports = a fifth of supervision", { reports: 9 }, 6],                        // 30*(9/45) = 6
    ["45 context switches cap supervision alone", { contextSwitches: 45 }, 30],       // 30*(45/45) = 30
    ["decisions, reports and switches share one norm", { decisions: 5, reports: 15, contextSwitches: 15 }, 30], // (15+15+15)/45 = 1 → 30
    ["40 000 output tokens = half reading", { outputTokens: 40_000 }, 5],             // 10*(40000/80000) = 5
    ["80 000 output tokens cap reading", { outputTokens: 80_000 }, 10],               // 10*(80000/80000) = 10
    ["200 000 output tokens still capped", { outputTokens: 200_000 }, 10],            // clamp(200000/80000) = 1 → 10
    ["20 min streak = half", { streakMin: 20 }, 5],                                   // 10*(20/40) = 5
    ["40 min streak caps", { streakMin: 40 }, 10],                                    // 10*(40/40) = 10
    ["late night alone", { lateNight: true }, 10],                                    // 10*1 = 10
    // 25 + 15 + 30 + 10 + 10 + 10 = 100
    ["everything at cap", { sessions: 5, prompts: 20, decisions: 15, outputTokens: 80_000, streakMin: 40, lateNight: true }, 100],
    // The same without the late-night flag: 25 + 15 + 30 + 10 + 10 = 90, the daytime maximum.
    ["everything at cap but the hour", { sessions: 5, prompts: 20, decisions: 15, outputTokens: 80_000, streakMin: 40 }, 90],
    // Integer weights keep this exact in floating point: 12.5 + 5 = 17.5, and
    // Math.round takes a mathematical half upwards, so the index is 18, not 17.
    ["an exact half-point sum rounds up", { sessions: 3, streakMin: 20 }, 18],
  ])("%s", (_name, over, expected) => {
    expect(score(m(over))?.index).toBe(expected);
  });

  test("the six weighted parts are reported and add up to the index", () => {
    // parallel 25*(2/4) = 12.5, pace 15*(10/20) = 7.5,
    // supervision 30*(3*3 + 6 + 12)/45 = 30*(27/45) = 18, reading 10*(40000/80000) = 5,
    // streak 10*(20/40) = 5, late 10 → 58 exactly.
    const s = score(m({ sessions: 3, prompts: 10, decisions: 3, reports: 6, contextSwitches: 12, outputTokens: 40_000, streakMin: 20, lateNight: true }));
    expect(s).not.toBeNull();
    expect(s!.parts).toEqual({ parallel: 12.5, pace: 7.5, supervision: 18, reading: 5, streak: 5, late: 10 });
    expect(Math.round(Object.values(s!.parts).reduce((a, b) => a + b, 0))).toBe(s!.index);
    expect(s!.index).toBe(58);
  });

  test("a supervision part that is a whole number displays as one", () => {
    // 30*(9/45) must reach the display as 6, never as 5.9 or 6.000000000000001:
    // the one-decimal rounding of the parts is what guarantees that.
    expect(score(m({ reports: 9 }))?.parts.supervision).toBe(6);
  });

  test("the index rounds the unrounded sum, not the rounded parts", () => {
    // pace 15*(1/20) = 0.75 and reading 10*(5333/80000) = 0.666625 sum to
    // 1.416625, which rounds to 1. The parts as displayed are 0.8 and 0.7, and
    // those sum to 1.5, which would round to 2: an index built from the
    // displayed parts reads one point higher than the formula says.
    const s = score(m({ prompts: 1, outputTokens: 5333 }));
    expect(s!.parts.pace).toBe(0.8);
    expect(s!.parts.reading).toBe(0.7);
    expect(s!.index).toBe(1);
  });

  test("1 min streak rounds its displayed part to 0.3 but the index to 0", () => {
    // 10*(1/40) = 0.25 → part 0.3, index round(0.25) = 0
    expect(score(m({ streakMin: 1 }))?.parts.streak).toBe(0.3);
    expect(score(m({ streakMin: 1 }))?.index).toBe(0);
  });

  test("capped lists the parts at their full weight, heaviest first", () => {
    expect(score(m({ streakMin: 40, sessions: 5 }))?.capped).toEqual(["parallel", "streak"]);
    expect(score(m({ streakMin: 39, sessions: 4 }))?.capped).toEqual([]);
  });

  test("capped breaks a tie in weight by the order of the weights", () => {
    expect(score(m({ lateNight: true, outputTokens: 80_000, streakMin: 40 }))?.capped).toEqual(["reading", "streak", "late"]);
  });

  test("top is the part closest to its weight when nothing is capped", () => {
    // parallel 2/4 = 0.5, pace 12/20 = 0.6, streak 10/40 = 0.25: pace is closest
    // though parallel has more points (12.5 against 9).
    const s = score(m({ sessions: 3, prompts: 12, streakMin: 10 }));
    expect(s?.capped).toEqual([]);
    expect(s?.top).toBe("pace");
  });

  test("top on a tie is the heavier part", () => {
    // parallel 2/4 and streak 20/40 are both halfway.
    expect(score(m({ sessions: 3, streakMin: 20 }))?.top).toBe("parallel");
  });

  test("top compares the fractions before rounding", () => {
    // reading 4/80000 → 0.0005 of its weight rounds to 0 points; pace is 0.
    expect(score(m({ outputTokens: 4 }))?.top).toBe("reading");
  });

  test("no sessions means no score", () => {
    expect(score(m({ sessions: 0, activeMin: 0 }))).toBeNull();
  });

  test.each<[number, Level]>([[0, "Calm"], [29, "Calm"], [30, "Warming"], [59, "Warming"], [60, "Heating"], [84, "Heating"], [85, "Fried"], [100, "Fried"]])(
    "level of %i is %s", (index, level) => expect(levelOf(index)).toBe(level));

  test("level is attached to the score", () => {
    expect(score(m({ sessions: 5, prompts: 20 }))?.level).toBe("Warming"); // 25 + 15 = 40
  });

  test("the daytime maximum of 90 is already Fried", () => {
    // Without the late-night flag the index tops out at 90, which is inside the
    // 85-100 Fried band: a full daytime hour is not merely Heating.
    expect(score(m({ sessions: 5, prompts: 20, decisions: 15, outputTokens: 80_000, streakMin: 40 }))?.level).toBe("Fried");
  });
});
