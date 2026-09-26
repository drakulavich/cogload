import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { interruptAfterImage, promptAfterImage, promptBlocks, interrupt, transcript } from "../helpers/transcript.ts";

const S = "11111111-1111-4111-8111-111111111111";
const W = { to: "2026-09-14", days: 1 };
const at = (mm: string) => `2026-09-14T13:${mm}:00.000Z`;

describe("a pasted image in front of the typed text", () => {
  test("three prompts read the same whether or not an image block comes first", () => {
    const times = ["00", "05", "10"];
    const plain = analyze([transcript(times.map((mm) => promptBlocks(at(mm), S)))], W)[0]!;
    const pasted = analyze([transcript(times.map((mm) => promptAfterImage(at(mm), S)))], W)[0]!;
    expect(plain.buckets[13]!.prompts).toBe(3);
    expect(pasted.buckets[13]!.prompts).toBe(plain.buckets[13]!.prompts);
    expect(pasted.buckets[13]!.activeMin).toBe(plain.buckets[13]!.activeMin);
    expect(pasted.buckets[13]!.score?.index).toBe(plain.buckets[13]!.score?.index);
    expect(pasted.activeMin).toBe(plain.activeMin);
  });

  test("an interrupt after a pasted image is still an interrupt, not a prompt", () => {
    const b = analyze([transcript([interruptAfterImage(at("00"), S)])], W)[0]!.buckets[13]!;
    const plain = analyze([transcript([interrupt(at("00"), S)])], W)[0]!.buckets[13]!;
    expect(b.interrupts).toBe(1);
    expect(b.prompts).toBe(0);
    expect(b.decisions).toBe(plain.decisions);
  });
});
