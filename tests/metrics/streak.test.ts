import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { assistant, interrupt, prompt, question, reject, teammate, toolResult, toolUse, transcript } from "../helpers/transcript.ts";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-1111-4111-8111-111111111111";
const W = { to: "2026-09-14", days: 1 };

describe("presence streak", () => {
  test("a 9-minute gap continues the streak, an 11-minute gap breaks it", () => {
    const d = analyze([
      transcript([prompt("2026-09-14T10:00:00.000Z", A), prompt("2026-09-14T10:09:00.000Z", A)], "p/a.jsonl"),
      transcript([prompt("2026-09-14T10:20:00.000Z", B), prompt("2026-09-14T10:25:00.000Z", B)], "p/b.jsonl"),
    ], W)[0]!;
    // 10:00 -> 10:09 is 9 minutes, one streak; 10:09 -> 10:20 is 11, so a second
    // one of 5 minutes. The hour reads the longer of the two.
    expect(d.buckets[10]!.streakMin).toBe(9);
  });

  test("a gap of exactly 10 minutes continues the streak", () => {
    const d = analyze([transcript([
      prompt("2026-09-14T10:00:00.000Z", A),
      prompt("2026-09-14T10:10:00.000Z", A),   // gap 10, not > GAP_MS, continues
      prompt("2026-09-14T10:20:00.000Z", A),   // gap 10, continues
    ])], W)[0]!;
    expect(d.buckets[10]!.streakMin).toBe(20);
  });

  test("agent activity does not bridge a gap between prompts", () => {
    const lines = [prompt("2026-09-14T10:00:00.000Z", A)];
    for (let m = 1; m <= 24; m++) lines.push(assistant(`2026-09-14T10:${String(m).padStart(2, "0")}:00.000Z`, A));
    lines.push(teammate("2026-09-14T10:12:00.000Z", A));
    lines.push(prompt("2026-09-14T10:25:00.000Z", A));
    const b = analyze([transcript(lines)], W)[0]!.buckets[10]!;
    // The human was away for 25 minutes; the agent working through them is not
    // presence. The 10:25 prompt starts a fresh streak, measured from itself.
    expect(b.streakMin).toBe(0);
    // Two lone prompts, one slot each: 10:00 and 10:25.
    expect(b.activeMin).toBe(10);
  });

  test("the streak crosses sessions", () => {
    const d = analyze([
      transcript([prompt("2026-09-14T10:00:00.000Z", A), prompt("2026-09-14T10:08:00.000Z", A)], "p/a.jsonl"),
      transcript([prompt("2026-09-14T10:16:00.000Z", B), prompt("2026-09-14T10:24:00.000Z", B)], "p/b.jsonl"),
    ], W)[0]!;
    expect(d.buckets[10]!.streakMin).toBe(24);
  });

  test("the streak carries across the hour boundary", () => {
    const lines = [];
    for (let m = 0; m < 120; m += 5) lines.push(prompt(new Date(Date.UTC(2026, 8, 14, 10, m)).toISOString(), A));
    const d = analyze([transcript(lines)], W)[0]!;
    expect(d.buckets[10]!.streakMin).toBe(55);
    expect(d.buckets[11]!.streakMin).toBe(115);
    expect(d.buckets[11]!.score!.parts.streak).toBe(10); // 10 * clamp(115/40) = 10, past the norm
  });

  test("a streak that started in the look-back before the window is measured, but not bucketed", () => {
    const lines = [];
    // 22:00 on the 13th to 00:30 on the 14th, every 5 minutes
    for (let m = 0; m <= 150; m += 5) lines.push(prompt(new Date(Date.UTC(2026, 8, 13, 22, m)).toISOString(), A));
    const d = analyze([transcript(lines)], W)[0]!;
    expect(d.date).toBe("2026-09-14");
    expect(d.buckets[0]!.prompts).toBe(7);        // 00:00 .. 00:30
    expect(d.buckets[0]!.streakMin).toBe(150);    // since 22:00 the day before
    expect(d.totals.prompts).toBe(7);
  });

  test("a prompt in the look-back more than 10 minutes before the window starts no streak inside it", () => {
    const d = analyze([transcript([
      prompt("2026-09-13T23:40:00.000Z", A),   // 20 minutes before the window
      prompt("2026-09-14T00:05:00.000Z", A),   // gap 25 → a streak of its own
    ])], W)[0]!;
    expect(d.buckets[0]!.streakMin).toBe(0);
    expect(d.buckets[0]!.activeMin).toBe(5);   // the 00:05 slot alone
  });

  test("prompts before the 3-hour look-back are ignored entirely", () => {
    const d = analyze([transcript([
      prompt("2026-09-13T20:00:00.000Z", A),   // 4h before the window: dropped
      prompt("2026-09-13T20:05:00.000Z", A),
      prompt("2026-09-14T00:02:00.000Z", A),
    ])], W)[0]!;
    expect(d.buckets[0]!.streakMin).toBe(0);
  });
});

describe("active minutes", () => {
  test("a lone prompt is five minutes, whatever the agent does after it", () => {
    const lines = [prompt("2026-09-14T10:00:00.000Z", A)];
    for (let m = 1; m <= 30; m++) lines.push(assistant(`2026-09-14T10:${String(m).padStart(2, "0")}:00.000Z`, A));
    const b = analyze([transcript(lines)], W)[0]!.buckets[10]!;
    expect(b.activeMin).toBe(5);
  });

  test("a span fills the slots between two prompts", () => {
    const pair = analyze([transcript([
      prompt("2026-09-14T10:00:00.000Z", A),
      prompt("2026-09-14T10:08:00.000Z", A),   // slots 10:00 and 10:05
    ])], W)[0]!.buckets[10]!;
    expect(pair.activeMin).toBe(10);

    const chain = analyze([transcript([
      prompt("2026-09-14T10:00:00.000Z", A),
      prompt("2026-09-14T10:08:00.000Z", A),
      prompt("2026-09-14T10:17:00.000Z", A),   // 9-minute gaps: one streak
    ])], W)[0]!.buckets[10]!;
    expect(chain.activeMin).toBe(20);          // slots 10:00, 10:05, 10:10, 10:15
    expect(chain.streakMin).toBe(17);
  });

  test("a span across an hour boundary gives each hour its own slots", () => {
    const d = analyze([transcript([
      prompt("2026-09-14T14:58:00.000Z", A),
      prompt("2026-09-14T15:04:00.000Z", A),
    ])], W)[0]!;
    expect(d.buckets[14]!.activeMin).toBe(5);  // slot 14:55
    expect(d.buckets[15]!.activeMin).toBe(5);  // slot 15:00
    expect(d.buckets[15]!.streakMin).toBe(6);
    expect(d.activeMin).toBe(10);
  });

  test("active minutes count 5-minute slots, not events", () => {
    const d = analyze([transcript([
      prompt("2026-09-14T10:00:00.000Z", A),
      assistant("2026-09-14T10:01:00.000Z", A),
      assistant("2026-09-14T10:04:59.000Z", A),
      prompt("2026-09-14T10:05:00.000Z", A),
      prompt("2026-09-14T10:40:00.000Z", B),   // gap 35: its own slot only
    ])], W)[0]!;
    expect(d.buckets[10]!.activeMin).toBe(15);
    expect(d.activeMin).toBe(15);
  });

  test("a span reaching in from the look-back fills only the window's slots", () => {
    // 23:35 on the 13th to 00:11 on the 14th, 9 minutes apart: one streak.
    const lines = ["23:35", "23:44", "23:53"].map((hm) => prompt(`2026-09-13T${hm}:00.000Z`, A));
    lines.push(prompt("2026-09-14T00:02:00.000Z", A), prompt("2026-09-14T00:11:00.000Z", A));
    const d = analyze([transcript(lines)], W)[0]!;
    expect(d.buckets[0]!.streakMin).toBe(36);  // measured from 23:35, in the look-back
    expect(d.buckets[0]!.activeMin).toBe(15);  // slots 00:00, 00:05, 00:10; 23:50 and 23:55 are outside
    expect(d.activeMin).toBe(15);
  });
});

describe("presence is every human action", () => {
  const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;

  test("an interrupt and a rejection hold the streak open between two prompts", () => {
    const d = analyze([transcript([
      prompt(at("10:00"), A),
      interrupt(at("10:08"), A),   // 8 minutes: presence, the streak continues
      reject(at("10:16"), A),      // 8 more: presence again
      prompt(at("10:24"), A),
    ])], W)[0]!;
    const b = d.buckets[10]!;
    // Without the interrupt and the rejection the two prompts are 24 minutes
    // apart and the hour holds two streaks of nothing.
    expect(b.streakMin).toBe(24);
    expect(b.activeMin).toBe(25);   // slots 10:00, 10:05, 10:10, 10:15, 10:20
  });

  test("a human action is presence and still a decision", () => {
    const b = analyze([transcript([
      prompt(at("10:00"), A),
      interrupt(at("10:08"), A),
      reject(at("10:16"), A),
      prompt(at("10:24"), A),
    ])], W)[0]!.buckets[10]!;
    expect([b.prompts, b.interrupts, b.rejects, b.decisions]).toEqual([2, 1, 1, 2]);
  });
});

describe("answering the agent is presence", () => {
  const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;
  const Q = "toolu_question_1";
  // The agent asks at 10:02, the human picks an option at 10:05, and types the
  // next prompt 8 minutes after that. Nothing here is more than 10 minutes from
  // the action before it, so the hour holds one streak.
  const answered = [prompt(at("10:00"), A), question(at("10:02"), A, Q), toolResult(at("10:05"), A, Q), prompt(at("10:13"), A)];

  test("the answer bridges the gap the question opened", () => {
    const b = analyze([transcript(answered)], W)[0]!.buckets[10]!;
    expect(b.streakMin).toBe(13);
    expect(b.activeMin).toBe(15);   // slots 10:00, 10:05, 10:10
  });

  test("without the answer the same hour holds two streaks of nothing", () => {
    const b = analyze([transcript([answered[0]!, answered[1]!, answered[3]!])], W)[0]!.buckets[10]!;
    expect(b.streakMin).toBe(0);
    expect(b.activeMin).toBe(10);   // slots 10:00 and 10:10, the gap uncovered
  });

  test("the result of an ordinary tool is the machine reporting back, not presence", () => {
    const b = analyze([transcript([
      prompt(at("10:00"), A),
      toolUse(at("10:02"), A, "Bash", "toolu_bash_1"),
      toolResult(at("10:05"), A, "toolu_bash_1"),
      prompt(at("10:13"), A),
    ])], W)[0]!.buckets[10]!;
    expect(b.streakMin).toBe(0);
    expect(b.activeMin).toBe(10);
  });

  test("an answer is presence only: not a prompt, not a decision, not a report", () => {
    const b = analyze([transcript(answered)], W)[0]!.buckets[10]!;
    expect([b.prompts, b.reports, b.questions, b.decisions]).toEqual([2, 0, 1, 1]);
  });
});

describe("an hour's streak is the longest it saw", () => {
  test("a prompt after a break does not erase the streak that ended in the same hour", () => {
    // 08:30 to 10:00 unbroken, then a break, then one prompt at 10:50.
    const lines = [];
    for (let m = 0; m <= 90; m += 5) lines.push(prompt(new Date(Date.UTC(2026, 8, 14, 8, 30 + m)).toISOString(), A));
    lines.push(prompt("2026-09-14T10:50:00.000Z", A));
    const d = analyze([transcript(lines)], W)[0]!;
    expect(d.buckets[10]!.streakMin).toBe(90);   // 08:30 to 10:00, not the lone 10:50
    expect(d.buckets[9]!.streakMin).toBe(85);    // 08:30 to 09:55
  });

  test("a prompt 19 minutes after a 40-minute run keeps the hour's 40 minutes", () => {
    const lines = [];
    for (let m = 0; m <= 40; m += 10) lines.push(prompt(new Date(Date.UTC(2026, 8, 14, 10, m)).toISOString(), A));
    lines.push(prompt("2026-09-14T10:59:00.000Z", A));
    expect(analyze([transcript(lines)], W)[0]!.buckets[10]!.streakMin).toBe(40);
  });

  test("an hour inside one long run still reads that run", () => {
    const lines = [];
    for (let m = 0; m < 120; m += 5) lines.push(prompt(new Date(Date.UTC(2026, 8, 14, 10, m)).toISOString(), A));
    const d = analyze([transcript(lines)], W)[0]!;
    expect([d.buckets[10]!.streakMin, d.buckets[11]!.streakMin]).toEqual([55, 115]);
  });

  test("an hour with no presence of its own is still zero", () => {
    const lines = [prompt("2026-09-14T10:00:00.000Z", A)];
    for (let m = 1; m <= 30; m++) lines.push(assistant(`2026-09-14T11:${String(m).padStart(2, "0")}:00.000Z`, A));
    expect(analyze([transcript(lines)], W)[0]!.buckets[11]!.streakMin).toBe(0);
  });
});
