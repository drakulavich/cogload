import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { cardData, sentenceText } from "../../src/lib/card/index.ts";
import { assistantText, nextRequestId, prompt, teammate, transcript } from "../helpers/transcript.ts";

const sid = (c: string) => `${c.repeat(8)}-1111-4111-8111-111111111111`;
const at = (h: number, m: number, day = 14, ms = 0) => new Date(Date.UTC(2026, 8, day, h, m, 0, ms)).toISOString();
const W = { to: "2026-09-14", days: 1 };
const cardOf = (lines: string[]) => cardData(analyze([transcript(lines)], W), { days: W.days })!;
const keys = (lines: string[]) => cardOf(lines).highlights.map((h) => h.key);

// Five sessions, one prompt each, in one hour: parallel 25 + pace 3.75 of 40 -> 0.72.
const conductor = ["a", "b", "c", "d", "e"].map((c, i) => prompt(at(10, i), sid(c)));
// One session, 45 agent reports in 45 minutes and one 5000-token reply: supervision 30 + reading 0.6 of 40 -> 0.77.
const supervisor = [
  ...Array.from({ length: 45 }, (_, i) => teammate(at(10, i), sid("s"))),
  assistantText(at(10, 45), sid("s"), 5000, nextRequestId()),
];
// One session, a prompt every 5 minutes from 10:00 to 12:55: streak 55/115/175 min, all past the 40-minute norm -> 10 + 10 + 10 of 30 -> 1.0.
const marathoner = Array.from({ length: 36 }, (_, i) => prompt(at(10 + Math.floor(i / 12), (i % 12) * 5), sid("m")));
// Two prompts at 01:00 and 01:05: late 10 of 10 -> 1.0.
const nightOwl = [prompt(at(1, 0), sid("n")), prompt(at(1, 5), sid("n"))];

describe("one character per fixture", () => {
  test("exactly one session and no switches read in the singular", () => {
    // One prompt in one session: pace alone gives the Conductor a share; every other share is 0.
    const c = cardOf([prompt(at(10, 0), sid("a"))]);
    expect(c.character).toBe("conductor");
    expect(sentenceText(c.sentence)).toBe("1 session at once, 0 context switches in one hour.");
    expect(c.highlights[0]).toEqual({ key: "peakSessions", value: "1", caption: "session at once" });
  });

  test("Conductor: sessions at once and switches in one hour", () => {
    const c = cardOf(conductor);
    expect(c.character).toBe("conductor");
    expect(c.name).toBe("The Conductor");
    expect(c.motto).toBe("You run agents like an orchestra.");
    expect(sentenceText(c.sentence)).toBe("5 sessions at once, 4 context switches in one hour.");
    expect(c.sentence.filter((s) => s.strong).map((s) => s.text)).toEqual(["5 sessions", "4 context switches"]);
    expect(c.highlights.slice(0, 2)).toEqual([
      { key: "peakSessions", value: "5", caption: "sessions at once" },
      { key: "contextSwitches", value: "4", caption: "switches in one hour" },
    ]);
  });

  test("Supervisor: reports and tokens read", () => {
    const c = cardOf(supervisor);
    expect(c.character).toBe("supervisor");
    expect(c.name).toBe("The Supervisor");
    expect(c.motto).toBe("Nothing ships without your eyes on it.");
    expect(sentenceText(c.sentence)).toBe("45 agent reports and 5k tokens of output read.");
    expect(c.sentence.filter((s) => s.strong).map((s) => s.text)).toEqual(["45 agent reports", "5k tokens"]);
    expect(c.highlights.slice(0, 2)).toEqual([
      { key: "reportsRead", value: "45", caption: "agent reports read" },
      { key: "tokensRead", value: "5k", caption: "tokens of output read" },
    ]);
  });

  test("Marathoner: longest streak and calm share", () => {
    const c = cardOf(marathoner);
    expect(c.character).toBe("marathoner");
    expect(c.name).toBe("The Marathoner");
    expect(c.motto).toBe("You do not stop while it compiles.");
    expect(sentenceText(c.sentence)).toBe("Longest streak 2h55m without a break, 100% of your hours calm.");
    expect(c.sentence.filter((s) => s.strong).map((s) => s.text)).toEqual(["2h55m", "100%"]);
    expect(c.highlights.slice(0, 2)).toEqual([
      { key: "longestStreak", value: "2h55m", caption: "longest streak" },
      { key: "interrupts", value: "0", caption: "times you stopped Claude" },
    ]);
    // Every remaining norm is 0 (one session, no switches, reports or tokens), so there is no third.
    expect(c.highlights).toHaveLength(2);
  });

  test("Night Owl: share of hours late at night", () => {
    const c = cardOf(nightOwl);
    expect(c.character).toBe("nightOwl");
    expect(c.name).toBe("The Night Owl");
    expect(c.motto).toBe("The best commits happen late at night.");
    expect(sentenceText(c.sentence)).toBe("100% of your hours late at night.");
    expect(c.sentence.filter((s) => s.strong).map((s) => s.text)).toEqual(["100%", "late at night"]);
    expect(c.highlights.slice(0, 2)).toEqual([
      { key: "lateShare", value: "100%", caption: "of hours late at night" },
      { key: "longestStreak", value: "5m", caption: "longest streak" },
    ]);
  });
});

describe("the Night Owl's words", () => {
  test("a card whose late hours are all 23:xx never says after midnight", () => {
    // Two prompts at 23:10 and 23:40: hour 23 is late (lateNight covers 23 and
    // 0-5), so this is the Night Owl at 100%, and none of it is after midnight.
    const c = cardOf([prompt(at(23, 10), sid("n")), prompt(at(23, 40), sid("n"))]);
    expect(c.character).toBe("nightOwl");
    const words = [sentenceText(c.sentence), c.motto, ...c.highlights.map((h) => h.caption)].join(" ");
    expect(words).not.toContain("midnight");
    expect(sentenceText(c.sentence)).toBe("100% of your hours late at night.");
  });
});

describe("ties and eligibility", () => {
  test("equal shares go to the earlier character: Marathoner over Night Owl", () => {
    // A prompt every 5 minutes from 22:00 on the 13th to 01:55 on the 14th. Only the
    // 14th is in the window; the look-back makes hours 0 and 1 carry a streak past
    // the 40-minute cap (10 points each) while both are late (10 each): 1.0 = 1.0.
    // Mutation: `>=` in the character reduce flips this to nightOwl.
    const lines = Array.from({ length: 48 }, (_, i) => {
      const m = 22 * 60 + i * 5;
      return prompt(at(Math.floor(m / 60) % 24, m % 60, m < 24 * 60 ? 13 : 14), sid("t"));
    });
    const c = cardOf(lines);
    expect(c.shares.marathoner).toBe(1);
    expect(c.shares.nightOwl).toBe(1);
    expect(c.character).toBe("marathoner");
  });

  test("lateShare is never the third highlight on someone else's card", () => {
    // Five sessions at 01:00-01:04 and again at 13:00-13:04: Conductor (0.72) over
    // Night Owl (0.5). lateShare's norm 50/25 = 2.0 would beat longestStreak's
    // 4/40, but it is not eligible, so the streak wins.
    const lines = [1, 13].flatMap((h) => ["a", "b", "c", "d", "e"].map((c, i) => prompt(at(h, i), sid(c))));
    const c = cardOf(lines);
    expect(c.character).toBe("conductor");
    expect(keys(lines)).toEqual(["peakSessions", "contextSwitches", "longestStreak"]);
    expect(c.highlights[2]!.value).toBe("4m");
  });

  test("the streak candidate is ranked by the index's streak norm, so a recalibration moves the third highlight", () => {
    // One active hour: 11 prompts three minutes apart from 10:00 to 10:30 across
    // five sessions, and one reply of 32 500 output tokens. The Conductor's own
    // pair takes the first two slots, so the third is a race between the two
    // candidates that score anything:
    //   longestStreak  30 / NORMS.streakMin = 30/40  = 0.75
    //   tokensRead     32500 / (65000 x 1 hour)      = 0.5
    // The streak wins. Under the old norm of 120 it would rank 30/120 = 0.25 and
    // tokensRead would take the slot instead, so this row is what keeps the
    // card's ranking honest when src/lib/metrics/score.ts is recalibrated.
    // Conductor 0.83 = (parallel 25 + pace 15 x 11/20 = 8.25) / 40 beats
    // Marathoner 0.75 (the streak part) and Supervisor 0.27, and 10:00 is not
    // late, so the character is the Conductor and the pair is its own.
    const lines = [
      ...Array.from({ length: 11 }, (_, i) => prompt(at(10, i * 3), sid("abcde"[i % 5]!))),
      assistantText(at(10, 31), sid("a"), 32_500, nextRequestId()),
    ];
    const c = cardOf(lines);
    expect(c.character).toBe("conductor");
    expect(keys(lines)).toEqual(["peakSessions", "contextSwitches", "longestStreak"]);
    expect(c.highlights[2]).toEqual({ key: "longestStreak", value: "30m", caption: "longest streak" });
  });
});

describe("third highlight", () => {
  test("a card whose remaining candidates all score zero shows the character's pair alone", () => {
    // One session, a prompt every 15 minutes, each followed by a 22 500-token
    // reply and 7 agent reports: the Supervisor. The prompts are more than 10
    // minutes apart, so there is no streak; one session, so no switches; no
    // interrupts. Every candidate for the third slot scores 0, and the one the
    // pool order used to pick read "1 / sessions at once".
    const lines = [0, 15, 30, 45].flatMap((m) => [
      prompt(at(10, m), sid("s")),
      assistantText(at(10, m + 1), sid("s"), 22_500, nextRequestId()),
      ...Array.from({ length: 7 }, (_, r) => teammate(at(10, m + 2, 14, r * 1000), sid("s"))),
    ]);
    const c = cardOf(lines);
    expect(c.character).toBe("supervisor");
    expect(c.highlights).toEqual([
      { key: "reportsRead", value: "28", caption: "agent reports read" },
      { key: "tokensRead", value: "90k", caption: "tokens of output read" },
    ]);
  });
});

describe("one figure per fact", () => {
  // Three hours on three days, each an unbroken run of 40 minutes or more, so the
  // streak makes it the Marathoner: a calm hour of one session; a warming hour of
  // two; a heating hour of three sessions and 30 agent reports. Calm is 1 of 3.
  const a: string[] = [], b: string[] = [], c: string[] = [], d: string[] = [];
  for (let i = 0; i < 12; i++) a.push(prompt(at(9, i * 5, 14), sid("a")));
  for (let i = 0; i < 20; i++) (i % 4 === 0 ? b : a).push(prompt(at(9, i * 3, 15), sid(i % 4 === 0 ? "b" : "a")));
  for (let i = 0; i < 20; i++) [a, c, d][i % 3]!.push(prompt(at(9, i * 3, 16), sid("acd"[i % 3]!)));
  for (let r = 0; r < 30; r++) a.push(teammate(at(9, 30, 16, r * 1000), sid("a")));
  const card = cardData(analyze([transcript(a, "p/a.jsonl"), transcript(b, "p/b.jsonl"), transcript(c, "p/c.jsonl"), transcript(d, "p/d.jsonl")], { to: "2026-09-16", days: 3 }), { days: 3 })!;

  test("the sentence's calm share is the legend's, 34% for one hour in three", () => {
    expect(card.character).toBe("marathoner");
    expect(card.spectrum).toEqual({ calm: 34, warming: 33, heating: 33, fried: 0 });
    expect(sentenceText(card.sentence)).toBe("Longest streak 57m without a break, 34% of your hours calm.");
  });
});

describe("spectrum rounding", () => {
  test("a level with hours never reads 0%: one fried hour among 200 calm ones is 1%", () => {
    // 200 lone calm hours over 7-19 Sep, then one fried hour on the 20th: five
    // sessions, a prompt every 2 minutes, 3000-token replies, 40 agent reports.
    // Raw 99.5 / 0 / 0 / 0.5 rounds to 100 / 0 / 0 / 0 by largest remainder;
    // the fried hour takes its 1 from calm. Its peak reads Fried on the same card.
    const lines: string[] = [];
    let n = 0;
    for (let day = 7; day <= 19 && n < 200; day++) for (let h = 6; h <= 21 && n < 200; h++, n++) lines.push(prompt(at(h, 0, day), sid("a")));
    for (let i = 0; i < 30; i++) lines.push(prompt(at(10, i * 2, 20), sid("bcdef"[i % 5]!)), assistantText(at(10, i * 2, 20, 5000), sid("bcdef"[i % 5]!), 3000, nextRequestId()));
    for (let r = 0; r < 40; r++) lines.push(teammate(at(10, 30, 20, r * 1000), sid("b")));
    const c = cardData(analyze([transcript(lines)], { to: "2026-09-20", days: 14 }), { days: 14 })!;
    expect(c.peak.level).toBe("Fried");
    expect(c.spectrum).toEqual({ calm: 99, warming: 0, heating: 0, fried: 1 });
  });

  test("33.3 / 33.3 / 33.3 / 0 rounds to 34 / 33 / 33 / 0 by largest remainder", () => {
    // Three active hours: one prompt (Calm, index 1); five sessions x 3 prompts one
    // minute apart (index 47, Warming); five sessions x 6 prompts two minutes apart
    // (index 64, Heating). Gaps over 10 minutes between them, so no streak carries.
    const storm = (h: number, prompts: number, step: number) =>
      Array.from({ length: prompts }, (_, i) => prompt(at(h, i * step), sid("abcde"[i % 5]!)));
    const c = cardOf([prompt(at(10, 0), sid("a")), ...storm(12, 15, 1), ...storm(14, 30, 2)]);
    expect(c.spectrum).toEqual({ calm: 34, warming: 33, heating: 33, fried: 0 });
  });
});

describe("compact formats", () => {
  test("counts step to k at 10 000 and tokens to M with a truncated decimal", () => {
    // 10 000 reports 300 ms apart (50 minutes) and 1 999 replies of 1 000 tokens:
    // supervision and reading both at cap, so this is the Supervisor's sentence.
    // 1 999 000 tokens is "1.9M", not "2.0M": decimals truncate.
    const lines = [
      ...Array.from({ length: 10_000 }, (_, i) => teammate(at(10, 0, 14, i * 300), sid("s"))),
      ...Array.from({ length: 1999 }, (_, i) => assistantText(at(10, 55, 14, i * 2), sid("s"), 1000, nextRequestId())),
    ];
    const c = cardOf(lines);
    expect(sentenceText(c.sentence)).toBe("10k agent reports and 1.9M tokens of output read.");
  });

  test("a streak of ten hours or more shows whole hours", () => {
    // A prompt every 5 minutes from 10:00 to 21:00 inclusive: 660 minutes at hour 21 -> "11h".
    const lines = Array.from({ length: 133 }, (_, i) => prompt(at(10 + Math.floor(i / 12), (i % 12) * 5), sid("m")));
    const c = cardOf(lines);
    expect(sentenceText(c.sentence)).toBe("Longest streak 11h without a break, 100% of your hours calm.");
  });
});

describe("empty window", () => {
  test("no transcripts is null", () => {
    expect(cardData(analyze([], W), { days: 1 })).toBeNull();
  });

  test("transcripts with no event inside the window is null", () => {
    expect(cardData(analyze([transcript([prompt(at(10, 0, 1), sid("a"))])], W), { days: 1 })).toBeNull();
  });
});
