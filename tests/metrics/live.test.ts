import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { statusOf } from "../../src/lib/status/index.ts";
import { assistant, prompt, transcript } from "../helpers/transcript.ts";

const A = "aaaaaaaa-1111-4111-8111-111111111111";
const B = "bbbbbbbb-2222-4222-8222-222222222222";
const mm = (n: number) => String(n).padStart(2, "0");

// A busy hour: a prompt every five minutes from 11:05 to 11:55, alternating
// two sessions, a reply half a minute after each. Nothing before, nothing after.
const busyHour = transcript(Array.from({ length: 11 }, (_, i) => {
  const sid = i % 2 ? B : A;
  return [prompt(`2026-09-14T11:${mm(5 + i * 5)}:00.000Z`, sid), assistant(`2026-09-14T11:${mm(5 + i * 5)}:30.000Z`, sid)];
}).flat());

describe("live: the sixty minutes ending at asOf", () => {
  test("thirty seconds into the next hour the live index is still the busy hour's", () => {
    // Mutation this pins: reading buckets[now.getHours()], which is the empty hour 12.
    const now = new Date("2026-09-14T12:00:30.000Z");
    const [day] = analyze([busyHour], { to: "2026-09-14", days: 1, now });
    expect(day!.live!.score!.index).toBe(day!.buckets[11]!.score!.index);
    expect(day!.live!.score!.index).toBeGreaterThan(0);
    expect(day!.buckets[12]!.score).toBeNull();
  });

  test("only the day that carries asOf carries live; a window without a clock has none", () => {
    // Mutation this pins: attaching live to every day, or building it without `now`.
    const days = analyze([busyHour], { to: "2026-09-14", days: 2, now: new Date("2026-09-14T12:00:30.000Z") });
    expect(days.map((d) => d.live === undefined)).toEqual([true, false]);
    expect(days.map((d) => d.asOf === undefined)).toEqual([true, false]);
    const noClock = analyze([busyHour], { to: "2026-09-14", days: 2 });
    expect(noClock.every((d) => d.live === undefined)).toBe(true);
  });
});

describe("live: the rule's edges", () => {
  test("a window that coincides with a calendar hour is that hour's bucket, metric for metric", () => {
    // Events at both edges exactly, so a window bound on the wrong side of
    // either admits the 10:59:59.999 prompt or drops the reply at `now`.
    // Mutations this pins: `t >= fromMs` (prompts 4, not 3) and `t < nowMs`
    // (the 11:59:59.999 reply's tokens go missing; derive() promises an event
    // at exactly `now` counts).
    const onTheHour = transcript([
      prompt("2026-09-14T10:59:59.999Z", B),
      prompt("2026-09-14T11:00:00.000Z", A), assistant("2026-09-14T11:00:30.000Z", A),
      prompt("2026-09-14T11:30:00.000Z", B), assistant("2026-09-14T11:30:30.000Z", B),
      prompt("2026-09-14T11:59:00.000Z", A), assistant("2026-09-14T11:59:59.999Z", A),
      prompt("2026-09-14T12:00:00.000Z", A),
    ]);
    const [day] = analyze([onTheHour], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T11:59:59.999Z") });
    const { hour, ...bucket11 } = day!.buckets[11]!;
    expect(hour).toBe(11);
    // Only the streak and score differ: the live streak runs from 11:59 to now,
    // and the 29-minute break before it cools the score.
    expect({ ...day!.live!, streakMin: 0, score: null }).toEqual({ ...bucket11, streakMin: 0, score: null });
    expect(day!.live!.prompts).toBe(3);
    expect(day!.live!.contextSwitches).toBe(2);
  });

  test("a streak that began before the window is measured from where it began", () => {
    // Prompts every two minutes from 11:20. Window from 11:30. Mutations this
    // pins: starting the streak at the window's edge (60); keeping the
    // longest streak in the window once it stopped (50, not 0).
    const start = Date.parse("2026-09-14T11:20:00.000Z");
    const every2 = (until: string) => {
      const count = (Date.parse(until) - start) / 120_000 + 1;
      return transcript(Array.from({ length: count }, (_, i) => prompt(new Date(start + i * 120_000).toISOString(), A)));
    };
    const now = new Date("2026-09-14T12:30:00.000Z");
    const toTheEnd = analyze([every2("2026-09-14T12:30:00.000Z")], { to: "2026-09-14", days: 1, now })[0]!;
    expect(toTheEnd.live!.streakMin).toBe(70);
    const stopped = analyze([every2("2026-09-14T12:10:00.000Z")], { to: "2026-09-14", days: 1, now })[0]!;
    expect(stopped.live!.streakMin).toBe(0);
    expect(stopped.presence!.lastAt).toBe("2026-09-14T12:10:00.000Z"); // 20 minutes ago
  });

  test("just past midnight the window reaches into yesterday, and only the live bucket sees it", () => {
    // Prompts every two minutes 23:30–23:58 on the 13th; now 00:20 on the 14th.
    // Mutation this pins: skipping events before the day's start in the live
    // fold, as foldEvents does for buckets.
    const lateRun = transcript(Array.from({ length: 15 }, (_, i) => prompt(`2026-09-13T23:${30 + i * 2}:00.000Z`, A)));
    const [day] = analyze([lateRun], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T00:20:00.000Z") });
    expect([day!.live!.prompts, day!.live!.sessions, day!.live!.activeMin]).toEqual([15, 1, 30]);
    expect(day!.live!.score).not.toBeNull();
    expect([day!.buckets[0]!.prompts, day!.totals.prompts, day!.peak]).toEqual([0, 0, null]);
  });

  test("late night is the clock's, not the window's first hour", () => {
    // The same activity, 22:15–22:55 every five minutes, read at 22:55 and at
    // 23:05: the running streak is at its norm both times, so everything in the
    // index is equal but the ten late points. Mutation this pins: taking
    // lateNight from the hour the window starts in.
    const evening = transcript(Array.from({ length: 9 }, (_, i) => prompt(`2026-09-14T22:${mm(15 + i * 5)}:00.000Z`, A)));
    const at = (iso: string) => analyze([evening], { to: "2026-09-14", days: 1, now: new Date(iso) })[0]!.live!;
    const before = at("2026-09-14T22:55:00.000Z"), after = at("2026-09-14T23:05:00.000Z");
    expect([before.lateNight, after.lateNight]).toEqual([false, true]);
    expect(after.score!.index - before.score!.index).toBe(10);
    expect(after.score!.parts).toEqual({ ...before.score!.parts, late: 10 });
  });

  test("nothing in the window scores null, and the day keeps its own numbers", () => {
    // Mutation this pins: scoring an empty metrics object.
    const morning = transcript([prompt("2026-09-14T09:00:00.000Z", A), assistant("2026-09-14T09:01:00.000Z", A)]);
    const [day] = analyze([morning], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T14:00:00.000Z") });
    expect(day!.live!.score).toBeNull();
    expect([day!.live!.sessions, day!.live!.prompts, day!.live!.activeMin, day!.live!.streakMin]).toEqual([0, 0, 0, 0]);
    expect(day!.peak).not.toBeNull();
  });
});

describe("live: the streak running now", () => {
  test("after an 11-minute break the live streak is the new one, as in status", () => {
    // 10:00–10:44 every four minutes, a break of 11, then 10:55, 11:00, 11:05.
    // Mutation this pins: the longest streak in the window (44).
    const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;
    const before = Array.from({ length: 12 }, (_, i) => prompt(at(`10:${mm(i * 4)}`), A));
    const t = transcript([...before, prompt(at("10:55"), A), prompt(at("11:00"), A), prompt(at("11:05"), A)]);
    const now = new Date(at("11:05"));
    const [day] = analyze([t], { to: "2026-09-14", days: 1, now });
    expect(day!.live!.streakMin).toBe(10);
    expect(statusOf(day!, now).streakMin).toBe(10);
  });
});

describe("live: a break cools the index", () => {
  // A busy 40 minutes: 10:04–10:40 every four minutes, alternating A and B
  // (ten prompts, nine switches). Then a pause, then A at T, T+5, T+10.
  const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;
  const busy = Array.from({ length: 10 }, (_, i) => prompt(at(`10:${mm(4 + i * 4)}`), i % 2 ? B : A));
  const work = (t0: string) => {
    const s = Date.parse(at(t0));
    return [0, 5, 10].map((m) => prompt(new Date(s + m * 60_000).toISOString(), A));
  };
  const live = (lines: string[], now: string) => analyze([transcript(lines)], { to: "2026-09-14", days: 1, now: new Date(at(now)) })[0]!.live!;

  test("a 5-minute pause is no break: the live index is the whole window's", () => {
    // One streak from 10:04, 51 minutes at 10:55, so every action counts.
    // Mutation this pins: cooling across a pause of GAP_MS or less.
    const l = live([...busy, ...work("10:45")], "10:55");
    expect(l.score!.parts).toEqual({ parallel: 6.3, pace: 9.8, supervision: 6.7, reading: 0, streak: 10, late: 0 });
    expect(l.score!.index).toBe(33);
  });

  test("an 11-minute break keeps 45% of the load from before it", () => {
    // full: 13 prompts, 2 sessions, 10 switches; after: 3 prompts, 1 session.
    // Both carry the running 10-minute streak (2.5). Uncooled, the index is 32.
    // parallel 0.45×0.25, pace 0.15 + 0.45×0.5, supervision 0.45×10/45.
    const l = live([...busy, ...work("10:51")], "11:01");
    expect(l.score!.parts).toEqual({ parallel: 2.8, pace: 5.6, supervision: 3, reading: 0, streak: 2.5, late: 0 });
    expect(l.score!.index).toBe(14);
    expect([l.prompts, l.sessions, l.contextSwitches]).toEqual([13, 2, 10]); // the counts stay the window's
  });

  test("a 20-minute break keeps nothing from before it", () => {
    // Mutation this pins: no cooling, which also counts 8 earlier prompts and B.
    const l = live([...busy, ...work("11:00")], "11:10");
    const afterOnly = live(work("11:00"), "11:10");
    expect(l.score).toEqual(afterOnly.score);
    expect(l.prompts).toBe(11);
  });

  test("fifteen minutes into a break with no action yet, a quarter of the window counts", () => {
    // full at 10:55: 10 prompts, 2 sessions, 9 switches, no streak running.
    // Uncooled, with the 36-minute streak, the index is 29.
    const l = live(busy, "10:55");
    expect(l.score!.parts).toEqual({ parallel: 1.6, pace: 1.9, supervision: 1.5, reading: 0, streak: 0, late: 0 });
    expect(l.score!.index).toBe(5);
  });
});
