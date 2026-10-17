import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { assistant, copiedTo, prompt, transcript } from "../helpers/transcript.ts";

const S = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
const W = { to: "2026-09-14", days: 1 };
const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;
const six = ["10:00", "10:05", "10:10", "10:15", "10:20", "10:25"].flatMap((t) => [prompt(at(t), S), assistant(at(t), S)]);

describe("a history copied under a new session id counts once (#222)", () => {
  test("the copy adds no prompt, switch or session", () => {
    const alone = analyze([transcript(six, "p/a.jsonl")], W)[0]!.buckets[10]!;
    const both = analyze([transcript(six, "p/a.jsonl"), transcript(copiedTo(six, T), "p/b.jsonl")], W)[0]!.buckets[10]!;
    expect(both.prompts).toBe(6);
    expect(both.contextSwitches).toBe(0);
    expect(both.sessions).toBe(1);
    expect(both.score).toEqual(alone.score);
  });

  test("two sessions that share timestamps but no records both count", () => {
    const other = ["10:00", "10:05"].map((t) => prompt(at(t), T));
    const b = analyze([transcript(six, "p/a.jsonl"), transcript(other, "p/b.jsonl")], W)[0]!.buckets[10]!;
    expect(b.prompts).toBe(8);
    expect(b.sessions).toBe(2);
  });

  test("a copied stretch counts once and the original's later records still count", () => {
    const copy = [...copiedTo(six.slice(4, 8), T), prompt(at("10:40"), T)];
    const b = analyze([transcript(copy, "p/a.jsonl"), transcript(six, "p/b.jsonl")], W)[0]!.buckets[10]!;
    expect(b.prompts).toBe(7);
    expect(b.sessions).toBe(2);
  });
});
