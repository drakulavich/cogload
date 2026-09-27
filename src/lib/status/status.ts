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

// index and level are the day's `live` bucket, not the hour's: an hour's bucket
// is nearly empty just after the hour turns. streakMin is measured against `now`,
// not the bucket's: it must not reset on the hour or stop between two actions,
// and it is over once the last action is more than GAP_MS behind `now`.
export function statusOf(day: Day, now: Date): Status {
  const hour = now.getHours();
  const live = day.presence !== null && now.getTime() - Date.parse(day.presence.lastAt) <= GAP_MS;
  return {
    schema: 1,
    asOf: day.asOf ?? now.toISOString(),
    date: day.date,
    hour,
    index: day.live?.score?.index ?? null,
    level: day.live?.score?.level ?? null,
    peak: day.peak,
    activeMin: day.activeMin,
    streakMin: live ? Math.min(MAX_MIN, Math.round((now.getTime() - Date.parse(day.presence!.streakStartAt)) / 60000)) : 0,
  };
}

export function renderStatus(s: Status): string {
  return JSON.stringify(s) + "\n";
}
