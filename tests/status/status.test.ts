import { describe, expect, test } from "bun:test";
import { analyze } from "../../src/lib/metrics/index.ts";
import { renderStatus, statusOf } from "../../src/lib/status/index.ts";
import { assistant, prompt, transcript } from "../helpers/transcript.ts";

const S = [
  "aaaaaaaa-1111-4111-8111-111111111111",
  "bbbbbbbb-2222-4222-8222-222222222222",
  "cccccccc-3333-4333-8333-333333333333",
];
// Two active hours on 14 Sept (UTC, and TZ=UTC in tests). 13:00 is the busy one:
// twelve prompts round-robin across three sessions. 14:00 is a single quiet
// exchange, so the current hour's numbers differ from the day's peak.
const busy = Array.from({ length: 12 }, (_, i) => {
  const mm = String(i * 4).padStart(2, "0");
  const sid = S[i % 3]!;
  return [prompt(`2026-09-14T13:${mm}:00.000Z`, sid), assistant(`2026-09-14T13:${mm}:30.000Z`, sid)];
}).flat();
const t = transcript([
  ...busy,
  prompt("2026-09-14T14:10:00.000Z", S[0]!), assistant("2026-09-14T14:12:00.000Z", S[0]!),
]);

describe("status: today's load in nine fields", () => {
  test("the last sixty minutes, and the day's peak and active time", () => {
    const now = new Date("2026-09-14T14:32:00.000Z");
    const [day] = analyze([t], { to: "2026-09-14", days: 1, now });
    const current = day!.buckets[14]!, busiest = day!.buckets[13]!;
    const s = statusOf(day!, now);
    expect(s).toEqual({
      schema: 1, asOf: "2026-09-14T14:32:00.000Z", date: "2026-09-14", hour: 14,
      index: day!.live!.score!.index, level: day!.live!.score!.level,
      peak: day!.peak, activeMin: day!.activeMin, streakMin: 0,
    });
    // The window (13:32, 14:32] holds the tail of the busy hour and the quiet
    // exchange: less than the peak, more than the quiet hour's own bucket.
    expect(s.peak).toBe(busiest.score!.index);
    expect(s.index!).toBeLessThan(s.peak!);
    expect(s.index!).toBeGreaterThan(current.score!.index);
    // 22 minutes since the 14:10 prompt, so the streak is over; the hour's own
    // bucket agrees here, but the status answers about now, not about the hour.
    expect([current.streakMin, s.streakMin]).toEqual([0, 0]);
    expect(s.streakMin).toBeLessThan(busiest.streakMin);
    expect(s.peak).not.toBe(day!.mean);
  });
  test("an hour with no activity yet is null for index and level, the day's numbers stay", () => {
    const now = new Date("2026-09-14T16:05:00.000Z");
    const [day] = analyze([t], { to: "2026-09-14", days: 1, now });
    const s = statusOf(day!, now);
    expect([s.hour, s.index, s.level, s.streakMin]).toEqual([16, null, null, 0]);
    expect([s.peak, s.activeMin]).toEqual([day!.peak, day!.activeMin]);
  });
  test("a day with no activity is all null and zero, and still has its date and time", () => {
    const now = new Date("2026-09-14T09:15:00.000Z");
    const [day] = analyze([], { to: "2026-09-14", days: 1, now });
    expect(statusOf(day!, now)).toEqual({ schema: 1, asOf: "2026-09-14T09:15:00.000Z", date: "2026-09-14", hour: 9, index: null, level: null, peak: null, activeMin: 0, streakMin: 0 });
  });
  test("renderStatus is one line in the spec's field order with a newline", () => {
    const now = new Date("2026-09-14T09:15:00.000Z");
    const [day] = analyze([], { to: "2026-09-14", days: 1, now });
    expect(renderStatus(statusOf(day!, now))).toBe('{"schema":1,"asOf":"2026-09-14T09:15:00.000Z","date":"2026-09-14","hour":9,"index":null,"level":null,"peak":null,"activeMin":0,"streakMin":0}\n');
  });
  test("the index does not reset on the hour: it is the last sixty minutes, not the current bucket", () => {
    // Thirty seconds into hour 14, which has no event of its own. Mutation this
    // pins: index from buckets[now.getHours()], which is null here.
    const now = new Date("2026-09-14T14:00:30.000Z");
    const [day] = analyze([t], { to: "2026-09-14", days: 1, now });
    const s = statusOf(day!, now);
    expect(s.hour).toBe(14);
    expect(day!.buckets[14]!.score).toBeNull();
    expect(s.index).toBe(day!.live!.score!.index);
    expect(s.index!).toBeGreaterThan(0);
    expect(s.level).toBe(day!.live!.score!.level);
  });
});

describe("status: the streak is live, not the hour's", () => {
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  // One run from 10:00 to 10:58, nothing after it. The hour boundary used to
  // reset the number a status line showed: hour 11 has no presence of its own.
  const run = transcript([
    ...Array.from({ length: 12 }, (_, i) => prompt(`2026-09-14T10:${String(i * 5).padStart(2, "0")}:00.000Z`, A)),
    prompt("2026-09-14T10:58:00.000Z", A),
  ]);
  const statusAt = (iso: string) => {
    const now = new Date(iso);
    return statusOf(analyze([run], { to: "2026-09-14", days: 1, now })[0]!, now);
  };

  test("five minutes after the last action the streak counts up to now", () => {
    const s = statusAt("2026-09-14T11:03:00.000Z");
    expect(s.streakMin).toBe(63);   // 10:00 to 11:03, across the hour boundary
    expect(s.hour).toBe(11);
  });

  test("eleven minutes after it the streak is over", () => {
    expect(statusAt("2026-09-14T11:09:00.000Z").streakMin).toBe(0);
  });

  test("the hour's own bucket says nothing about the live streak", () => {
    const now = new Date("2026-09-14T11:03:00.000Z");
    const day = analyze([run], { to: "2026-09-14", days: 1, now })[0]!;
    expect(day.buckets[11]!.streakMin).toBe(0);
    expect(statusOf(day, now).streakMin).toBe(63);
  });

  test("the day carries its last action and the start of the run it belongs to", () => {
    const day = analyze([run], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T11:03:00.000Z") })[0]!;
    expect(day.presence).toEqual({ lastAt: "2026-09-14T10:58:00.000Z", streakStartAt: "2026-09-14T10:00:00.000Z" });
  });

  test("a day with no presence has none", () => {
    const day = analyze([], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T11:03:00.000Z") })[0]!;
    expect(day.presence).toBeNull();
  });
});

describe("status: a streak that began yesterday", () => {
  const A = "aaaaaaaa-1111-4111-8111-111111111111";
  // Just past midnight the day being reported holds nothing yet, and the action
  // that keeps the streak alive is in the look-back, before the window starts.
  const statusAt = (lines: string[], iso: string) => {
    const now = new Date(iso);
    return statusOf(analyze([transcript(lines)], { to: "2026-09-14", days: 1, now })[0]!, now);
  };
  const lateAction = [prompt("2026-09-13T23:58:00.000Z", A)];

  test("five minutes after midnight the streak is still running", () => {
    expect(statusAt(lateAction, "2026-09-14T00:03:00.000Z").streakMin).toBe(5);
  });

  test("twelve minutes after it the streak is over", () => {
    expect(statusAt(lateAction, "2026-09-14T00:10:00.000Z").streakMin).toBe(0);
  });

  test("the streak is measured from where it began, not from midnight", () => {
    const run = [prompt("2026-09-13T23:50:00.000Z", A), prompt("2026-09-13T23:58:00.000Z", A)];
    expect(statusAt(run, "2026-09-14T00:03:00.000Z").streakMin).toBe(13);
    const day = analyze([transcript(run)], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T00:03:00.000Z") })[0]!;
    expect(day.presence).toEqual({ lastAt: "2026-09-13T23:58:00.000Z", streakStartAt: "2026-09-13T23:50:00.000Z" });
  });

  test("yesterday's action counts for nothing else", () => {
    const day = analyze([transcript(lateAction)], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T00:03:00.000Z") })[0]!;
    expect([day.activeMin, day.totals.prompts, day.buckets[0]!.streakMin, day.peak]).toEqual([0, 0, 0, null]);
  });

  test("an action of the day's own wins over the one carried in", () => {
    const day = analyze([transcript([...lateAction, prompt("2026-09-14T00:05:00.000Z", A)])], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T00:07:00.000Z") })[0]!;
    expect(day.presence).toEqual({ lastAt: "2026-09-14T00:05:00.000Z", streakStartAt: "2026-09-13T23:58:00.000Z" });
  });
});
