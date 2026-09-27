import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { assistant, meta, prompt, sdk, sidechain, transcript } from "../helpers/transcript.ts";

const S = "11111111-1111-4111-8111-111111111111";
const W = { to: "2026-09-14", days: 1 };
const at = (mm: string) => `2026-09-14T13:${mm}:00.000Z`;

describe("noise in transcripts", () => {
  test("isMeta messages are activity but not prompts", () => {
    const b = analyze([transcript([meta(at("00"), S), prompt(at("01"), S)])], W)[0]!.buckets[13]!;
    expect(b.prompts).toBe(1);
    expect(b.activeMin).toBe(5);
    expect(b.sessions).toBe(1);
  });

  test("isSidechain records count nothing, even in a main file", () => {
    const b = analyze([transcript([sidechain(at("00"), S)])], W)[0]!.buckets[13]!;
    expect(b.sessions).toBe(0);
    expect(b.score).toBeNull();
  });

  test("malformed lines and records without type, sessionId or timestamp are skipped", () => {
    const good = prompt(at("10"), S);
    const b = analyze([transcript([
      "{not json",
      "",
      JSON.stringify({ sessionId: S, timestamp: at("01"), message: { content: "no type" } }),
      JSON.stringify({ type: "user", timestamp: at("02"), message: { content: "no session" } }),
      JSON.stringify({ type: "user", sessionId: S, message: { content: "no timestamp" } }),
      JSON.stringify({ type: "user", sessionId: S, timestamp: "yesterday", message: { content: "bad timestamp" } }),
      "[1,2,3]",
      "null",
      good,
    ])], W)[0]!.buckets[13]!;
    expect(b.prompts).toBe(1);
    expect(b.activeMin).toBe(5);
  });

  test("a UTF-8 byte order mark before the first record does not cost that record", () => {
    // A hand-edited file saved by an editor that writes a BOM.
    const t = transcript([prompt(at("00"), S), prompt(at("01"), S)]);
    const b = analyze([{ ...t, text: `\uFEFF${t.text}` }], W)[0]!.buckets[13]!;
    expect(b.prompts).toBe(2);
  });

  test("bookkeeping records are ignored", () => {
    const b = analyze([transcript([
      JSON.stringify({ type: "last-prompt", leafUuid: "x", sessionId: S }),
      JSON.stringify({ type: "custom-title", customTitle: "t", sessionId: S }),
      JSON.stringify({ type: "file-history-snapshot", messageId: "m", snapshot: {}, isSnapshotUpdate: false }),
      JSON.stringify({ type: "attachment", sessionId: S, timestamp: at("00"), attachment: { type: "hook_success" } }),
      JSON.stringify({ type: "system", subtype: "informational", sessionId: S, timestamp: at("00"), content: "x" }),
    ])], W)[0]!.buckets[13]!;
    expect(b.sessions).toBe(0);
  });

  test("an empty transcript yields an empty day", () => {
    const d = analyze([transcript([])], W)[0]!;
    expect(d.peak).toBeNull();
    expect(d.mean).toBeNull();
    expect(d.activeMin).toBe(0);
  });
});

describe("headless runs", () => {
  const T = "22222222-1111-4111-8111-111111111111";
  const U = "33333333-1111-4111-8111-111111111111";

  test("claude -p and Agent SDK sessions count nothing beside the human's session", () => {
    const b = analyze([
      transcript([prompt(at("00"), S), assistant(at("01"), S), prompt(at("30"), S)], "p/s.jsonl"),
      transcript([sdk(prompt(at("10"), T)), sdk(assistant(at("11"), T))], "p/t.jsonl"),
      transcript([sdk(prompt(at("12"), U), "sdk-ts"), sdk(assistant(at("13"), U), "sdk-ts")], "p/u.jsonl"),
    ], W)[0]!.buckets[13]!;
    expect(b.sessions).toBe(1);
    expect(b.prompts).toBe(2);
    expect(b.contextSwitches).toBe(0);
  });

  test("a session opened from the desktop app still counts", () => {
    const b = analyze([transcript([sdk(prompt(at("00"), S), "claude-desktop")])], W)[0]!.buckets[13]!;
    expect(b.sessions).toBe(1);
    expect(b.prompts).toBe(1);
  });
});
