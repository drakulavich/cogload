import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { assistant, prompt, transcript } from "../helpers/transcript.ts";

const sid = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
const W = { to: "2026-09-14", days: 1 };
const at = (mm: string) => `2026-09-14T13:${mm}:00.000Z`;

describe("parallel sessions", () => {
  test("one session, several prompts: no context switches, parallel part 0", () => {
    const d = analyze([transcript([prompt(at("00"), sid(1)), prompt(at("10"), sid(1)), prompt(at("20"), sid(1))])], W)[0]!;
    expect(d.buckets[13]!.sessions).toBe(1);
    expect(d.buckets[13]!.contextSwitches).toBe(0);
    expect(d.buckets[13]!.score!.parts.parallel).toBe(0);
  });

  test("three sessions interleaved in one hour", () => {
    const files = [1, 2, 3].map((n) => transcript([prompt(at(`0${n}`), sid(n)), assistant(at(`0${n + 3}`), sid(n)), prompt(at(`3${n}`), sid(n))], `p/${n}.jsonl`));
    const b = analyze(files, W)[0]!.buckets[13]!;
    expect(b.sessions).toBe(3);
    // prompt order: s1 01, s2 02, s3 03, s1 31, s2 32, s3 33 → 5 switches
    expect(b.contextSwitches).toBe(5);
    expect(b.score!.parts.parallel).toBe(12.5); // 25 * (3 - 1) / 4
  });

  test("five sessions cap the parallel part; an assistant reply alone keeps a session alive", () => {
    const files = [1, 2, 3, 4].map((n) => transcript([prompt(at("05"), sid(n))], `p/${n}.jsonl`));
    files.push(transcript([assistant(at("06"), sid(5))], "p/5.jsonl"));
    const b = analyze(files, W)[0]!.buckets[13]!;
    expect(b.sessions).toBe(5);
    expect(b.score!.parts.parallel).toBe(25); // 25 * clamp((5 - 1) / 4)
  });

  test("sessions are counted per hour, not per day", () => {
    const files = [transcript([prompt(at("05"), sid(1))], "p/1.jsonl"), transcript([prompt("2026-09-14T15:05:00.000Z", sid(2))], "p/2.jsonl")];
    const d = analyze(files, W)[0]!;
    expect(d.buckets[13]!.sessions).toBe(1);
    expect(d.buckets[15]!.sessions).toBe(1);
    expect(d.totals.maxSessions).toBe(1);
  });
});
