import { GAP_MS } from "../metrics/index.ts";
import type { Day, Level } from "../types.ts";

// The status file's nine values. The field order is the file format.
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
};

// The reader contract's ceiling for activeMin and streakMin (status file spec):
// a reader treats a larger value as no data, so a longer streak is written as this.
const MAX_MIN = 1500;

// How far back `status` reads to find where the live streak began: as far as
// the file can show it, and one gap more, so that a streak longer than that
// still reaches past the ceiling and reads as MAX_MIN, not a few minutes under.
export function streakFrom(now: Date): Date {
  return new Date(now.getTime() - MAX_MIN * 60_000 - GAP_MS);
}

// index and level are the day's `live` bucket, not the hour's: an hour's bucket
// is nearly empty just after the hour turns. peak folds the live index in: sixty
// minutes across two hours can score above both, and index must never exceed peak. streakMin is measured against `now`,
// not the bucket's: it must not reset on the hour or stop between two actions,
// and it is over once the last action is more than GAP_MS behind `now`.
export function statusOf(day: Day, now: Date): Status {
  const hour = now.getHours();
  const index = day.live?.score?.index ?? null;
  const live = day.presence !== null && now.getTime() - Date.parse(day.presence.lastAt) <= GAP_MS;
  return {
    schema: 1,
    asOf: day.asOf ?? now.toISOString(),
    date: day.date,
    hour,
    index,
    level: day.live?.score?.level ?? null,
    peak: index === null ? day.peak : Math.max(index, day.peak ?? 0),
    activeMin: day.activeMin,
    streakMin: live ? Math.min(MAX_MIN, Math.round((now.getTime() - Date.parse(day.presence!.streakStartAt)) / 60000)) : 0,
  };
}

export function renderStatus(s: Status): string {
  return JSON.stringify(s) + "\n";
}
