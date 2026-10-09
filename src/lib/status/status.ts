import { GAP_MS, MAX_STREAK_MIN, NORMS } from "../metrics/index.ts";
import type { Day, Level } from "../types.ts";

// The status file's eleven values. The field order is the file format.
export type Status = {
  schema: 1;
  asOf: string;
  date: string;
  hour: number;
  index: number | null;
  level: Level | null;
  peak: number | null;
  activeMin: number;
  streakMin: number;
  restAt: string | null;
  restMin: number;
};

// How far back `status` reads to find where the live streak began: as far as
// the file can show it, and one gap more, so that a streak longer than that
// still reaches past the ceiling instead of reading a few minutes under it.
export function streakFrom(now: Date): Date {
  return new Date(now.getTime() - MAX_STREAK_MIN * 60_000 - GAP_MS);
}

// index and level are the day's `live` bucket, not the hour's: an hour's bucket
// is nearly empty just after the hour turns. peak folds the live index in: sixty
// minutes across two hours can score above both, and index must never exceed peak. streakMin is measured against `now`,
// not the bucket's: it must not reset on the hour or stop between two actions,
// and it is over once the last action is more than GAP_MS behind `now`.
export function statusOf(day: Day, now: Date): Status {
  const hour = now.getHours();
  const index = day.live?.score?.index ?? null;
  const streakMin = day.live?.streakMin ?? 0;
  return {
    schema: 1,
    asOf: day.asOf ?? now.toISOString(),
    date: day.date,
    hour,
    index,
    level: day.live?.score?.level ?? null,
    peak: index === null ? day.peak : Math.max(index, day.peak ?? 0),
    activeMin: day.activeMin,
    streakMin,
    restAt: streakMin > 0 ? new Date(Date.parse(day.presence!.streakStartAt) + NORMS.streakMin * 60000).toISOString() : null,
    restMin: GAP_MS / 60000,
  };
}

export function renderStatus(s: Status): string {
  return JSON.stringify(s) + "\n";
}
