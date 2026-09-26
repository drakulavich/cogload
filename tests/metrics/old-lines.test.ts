import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { assistant, assistantText, mode, prompt, question, reject, toolResult, transcript, withNestedTimestamp } from "../helpers/transcript.ts";

// A long session's file holds its whole history, most of it older than the
// window's three-hour look-back. With `to` 2026-09-14 and TZ=UTC the window
// starts at 00:00 and the look-back at 2026-09-13T21:00.
const S = "11111111-1111-4111-8111-111111111111";
const W = { to: "2026-09-14", days: 1 };
const old = (hhmm: string) => `2026-09-13T${hhmm}:00.000Z`;
const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;

describe("history older than the look-back", () => {
  test("changes nothing the window reports", () => {
    const recent = [
      prompt(old("22:30"), S),        // look-back
      assistant(old("22:31"), S),
      prompt(old("23:44"), S),        // a streak that starts in the look-back
      prompt(old("23:52"), S),
      prompt(at("00:00"), S),
      prompt(at("00:08"), S),
      assistant(at("00:09"), S),
      reject(at("01:00"), S),
    ];
    const history = [
      mode(S, "default"),
      prompt(old("08:00"), S),
      assistant(old("08:01"), S),
      mode(S, "plan"),
      question(old("09:00"), S, "toolu_old"),
      toolResult(old("09:01"), S, "toolu_old"),
      mode(S, "default"),
      prompt(old("20:59"), S),
    ];
    expect(analyze([transcript([...history, ...recent])], W)).toEqual(analyze([transcript([mode(S, "default"), ...recent])], W));
    expect(analyze([transcript(recent)], W)[0]!.buckets[0]!.streakMin).toBe(24); // 23:44 → 00:08: the look-back is read
  });

  test("a question asked before the look-back is still answered inside the window", () => {
    const day = analyze([transcript([
      prompt(old("19:00"), S),
      question(old("20:00"), S, "toolu_early"),
      toolResult(at("01:00"), S, "toolu_early"),
    ])], W)[0]!;
    expect(day.buckets[1]!.activeMin).toBe(5); // the answer is the human's action
  });

  test("a mode switch before the first timestamped record stays before the window", () => {
    const day = analyze([transcript([
      mode(S, "default"),
      mode(S, "plan"),                // waits for the first timestamped record, 19:00
      prompt(old("19:00"), S),
      prompt(at("01:00"), S),
    ])], W)[0]!;
    expect(day.totals.modeSwitches).toBe(0);
  });

  test("a mode set in old history is remembered, so repeating it is no switch", () => {
    const day = analyze([transcript([
      mode(S, "default"),
      prompt(old("19:00"), S),
      mode(S, "plan"),                // a switch at 19:00, before the window
      prompt(at("01:00"), S),
      mode(S, "plan"),                // the same mode again: nothing
      prompt(at("01:05"), S),
    ])], W)[0]!;
    expect(day.totals.modeSwitches).toBe(0);
  });

  test("an old response still reserves its requestId for token deduplication", () => {
    const day = analyze([transcript([
      prompt(old("07:59"), S),
      assistantText(old("08:00"), S, 100, "req_repeated"),
      assistantText(at("01:00"), S, 100, "req_repeated"),
    ])], W)[0]!;
    expect(day.buckets[1]!.outputTokens).toBe(0);
  });

  test("a record inside the window is read even when it carries an older time inside it", () => {
    const day = analyze([transcript([
      prompt(old("19:00"), S),
      withNestedTimestamp(reject(at("01:00"), S), old("18:00")),
    ])], W)[0]!;
    expect(day.buckets[1]!.rejects).toBe(1);
  });
});
