import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { assistantText, assistantTokensLiteral, assistantToolUseOnly, crossSession, prompt, taskNotification, teammate, transcript } from "../helpers/transcript.ts";

const S = "11111111-1111-4111-8111-111111111111";
const W = { to: "2026-09-14", days: 1 };
const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;

describe("inbound agent messages are reports, never prompts", () => {
  const t = transcript([
    teammate(at("13:00"), S),
    crossSession(at("13:01"), S),
    taskNotification(at("13:02"), S),
    prompt(at("13:03"), S),
  ]);
  const day = analyze([t], W)[0]!;
  const b = day.buckets[13]!;

  test("three reports and one prompt", () => {
    expect(b.reports).toBe(3);
    expect(b.prompts).toBe(1);
  });

  test("reports keep the session alive but are not presence", () => {
    expect(b.sessions).toBe(1);
    // The five active minutes are the 13:03 prompt's own slot. The three reports
    // before it add nothing: only what the human typed counts as presence.
    expect(b.activeMin).toBe(5);
  });

  test("an hour of reports and no prompt is a live session with no presence", () => {
    const b2 = analyze([transcript([
      teammate(at("09:00"), S),
      crossSession(at("09:20"), S),
      taskNotification(at("09:40"), S),
    ])], W)[0]!.buckets[9]!;
    expect(b2.sessions).toBe(1);
    expect(b2.reports).toBe(3);
    expect(b2.activeMin).toBe(0);
    expect(b2.streakMin).toBe(0);
  });
});

describe("every marker form is a report and never a prompt", () => {
  const variants: [string, string][] = [
    ["Another Claude session sent a message: lead-in", teammate(at("13:00"), S)],
    ["bare <teammate-message", teammate(at("13:00"), S, true)],
    ["<cross-session-message", crossSession(at("13:00"), S)],
    ["[Cross-session bracket form", crossSession(at("13:00"), S, true)],
    ["<task-notification>", taskNotification(at("13:00"), S)],
  ];

  for (const [name, line] of variants) {
    test(`${name} counts as one report and zero prompts`, () => {
      const day = analyze([transcript([line])], W)[0]!;
      const b = day.buckets[13]!;
      expect(b.reports).toBe(1);
      expect(b.prompts).toBe(0);
    });
  }
});

describe("output tokens are summed once per requestId per file", () => {
  test("three records repeating the same requestId count its tokens once", () => {
    const t = transcript([
      assistantText(at("13:00"), S, 250, "req_1"),
      assistantText(at("13:00"), S, 250, "req_1"),
      assistantText(at("13:00"), S, 250, "req_1"),
    ]);
    const day = analyze([t], W)[0]!;
    expect(day.buckets[13]!.outputTokens).toBe(250);
  });

  test("a response holding only a tool_use block contributes no tokens", () => {
    const t = transcript([assistantToolUseOnly(at("13:00"), S, 500, "req_2")]);
    const day = analyze([t], W)[0]!;
    expect(day.buckets[13]!.outputTokens).toBe(0);
  });

  test("distinct requestIds each contribute their own tokens", () => {
    const t = transcript([
      assistantText(at("13:00"), S, 100, "req_a"),
      assistantText(at("13:01"), S, 200, "req_b"),
    ]);
    const day = analyze([t], W)[0]!;
    expect(day.buckets[13]!.outputTokens).toBe(300);
  });

  test("a count that is not a finite non-negative integer contributes nothing and leaves the index a number", () => {
    // +1e309 and -1e309 parse to Infinity and -Infinity; their sum is NaN, which
    // reached the day table as NaN beside the level Fried and null in the JSON.
    const t = transcript([
      assistantText(at("13:00"), S, 100, "req_ok"),
      assistantTokensLiteral(at("13:01"), S, "1e309", "req_inf"),
      assistantTokensLiteral(at("13:02"), S, "-1e309", "req_neg_inf"),
      assistantTokensLiteral(at("13:03"), S, "-5", "req_negative"),
      assistantTokensLiteral(at("13:04"), S, "1.5", "req_fraction"),
    ]);
    const b = analyze([t], W)[0]!.buckets[13]!;
    expect(b.outputTokens).toBe(100);
    expect(Number.isFinite(b.score!.index)).toBe(true);
  });

  test("a tool-use-only record does not block a later text record of the same requestId", () => {
    // The first record of req_mixed has no text block and must not emit; the
    // dedupe set must therefore stay empty for req_mixed until the second
    // record (which does have a text block) emits and marks it seen.
    const t = transcript([
      assistantToolUseOnly(at("13:00"), S, 300, "req_mixed"),
      assistantText(at("13:00"), S, 300, "req_mixed"),
    ]);
    const day = analyze([t], W)[0]!;
    expect(day.buckets[13]!.outputTokens).toBe(300);
  });
});

describe("day totals sum reports and outputTokens across the day's buckets", () => {
  const t = transcript([
    teammate(at("13:00"), S),
    assistantText(at("13:01"), S, 100, "req_x"),
    teammate(at("14:00"), S),
    teammate(at("14:01"), S),
    assistantText(at("14:02"), S, 200, "req_y"),
  ]);
  const day = analyze([t], W)[0]!;

  test("per-hour buckets", () => {
    expect(day.buckets[13]!.reports).toBe(1);
    expect(day.buckets[13]!.outputTokens).toBe(100);
    expect(day.buckets[14]!.reports).toBe(2);
    expect(day.buckets[14]!.outputTokens).toBe(200);
  });

  test("day totals", () => {
    expect(day.totals.reports).toBe(3);
    expect(day.totals.outputTokens).toBe(300);
  });
});

describe("reports and output tokens enter the index through supervision and reading", () => {
  // Same session, same single timestamp for every event, so sessions, prompts,
  // decisions and context switches are identical between the two buckets; the
  // only difference is 9 inbound agent reports. activeMin and streakMin are
  // identical too, and now for a stronger reason than a shared timestamp:
  // presence follows the one prompt both buckets hold, so reports cannot move
  // either number however many of them arrive or how far apart they land.
  // Both: parallel 0 (1 session), pace 15*(1/20) = 0.75 -> 0.8, reading 0, streak 0, late 0.
  // lonely: supervision 0 -> index round(0.75) = 1.
  // busy: supervision 30*(0 + 9 + 0)/45 = 6.0 -> index round(0.75 + 6) = 7.
  const lonely = analyze([transcript([prompt(at("13:00"), S)])], W)[0]!.buckets[13]!;
  const busy = analyze(
    [transcript([prompt(at("13:00"), S), ...Array.from({ length: 9 }, () => teammate(at("13:00"), S))])],
    W,
  )[0]!.buckets[13]!;

  test("9 reports add exactly 30*9/45 = 6.0 supervision points and nothing else", () => {
    expect(lonely.reports).toBe(0);
    expect(busy.reports).toBe(9);
    expect(busy.score!.parts.supervision - lonely.score!.parts.supervision).toBe(6);
    for (const part of ["parallel", "pace", "reading", "streak", "late"] as const) {
      expect(busy.score!.parts[part]).toBe(lonely.score!.parts[part]);
    }
    expect(lonely.score!.index).toBe(1);
    expect(busy.score!.index).toBe(7);
  });

  // Same session, one prompt and one assistant reply at the same single timestamp
  // in both buckets, so every other metric is identical; the only difference is
  // whether that reply carries a text block (40 000 output tokens) or is
  // tool_use-only (0 tokens). The reports pair above never varies outputTokens
  // away from 0, so this is the pair that pins the reading component.
  // withTokens: reading 10*(40000/80000) = 5.0 -> index round(0.75 + 5) = 6.
  // withoutTokens: reading 0 -> index round(0.75) = 1.
  const withTokens = analyze(
    [transcript([prompt(at("15:00"), S), assistantText(at("15:00"), S, 40_000, "req_tok_a")])],
    W,
  )[0]!.buckets[15]!;
  const withoutTokens = analyze(
    [transcript([prompt(at("15:00"), S), assistantToolUseOnly(at("15:00"), S, 40_000, "req_tok_b")])],
    W,
  )[0]!.buckets[15]!;

  test("40 000 output tokens add exactly 10*40000/80000 = 5.0 reading points and nothing else", () => {
    expect(withTokens.outputTokens).toBe(40_000);
    expect(withoutTokens.outputTokens).toBe(0);
    expect(withTokens.score!.parts.reading - withoutTokens.score!.parts.reading).toBe(5);
    for (const part of ["parallel", "pace", "supervision", "streak", "late"] as const) {
      expect(withTokens.score!.parts[part]).toBe(withoutTokens.score!.parts[part]);
    }
    expect(withoutTokens.score!.index).toBe(1);
    expect(withTokens.score!.index).toBe(6);
  });
});
