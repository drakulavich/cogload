import type { Day, HourBucket, Level } from "../types.ts";

type TrendWeek = { from: string; to: string; days: number; hours: number; activeMin: number; hot: number; prompts: number };
export type Trend = {
  from: string;
  to: string;
  days: number;
  hours: number;
  activeMin: number;
  levels: Record<Level, number>;
  weeks: TrendWeek[];
  bySessions: { sessions: number; hours: number; mean: number | null }[];
  asOf?: string;
};

const scored = (days: Day[]): HourBucket[] => days.flatMap((d) => d.buckets.filter((b) => b.score !== null));
const sumActive = (days: Day[]): number => days.reduce((s, d) => s + d.activeMin, 0);

// Weeks are the grid's: seven days ending on the window's last day, the first block shorter.
function weeksOf(days: Day[]): TrendWeek[] {
  const weeks: TrendWeek[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const block = days.slice(Math.max(0, end - 7), end);
    const hours = scored(block);
    weeks.unshift({
      from: block[0]!.date,
      to: block[block.length - 1]!.date,
      days: block.length,
      hours: hours.length,
      activeMin: sumActive(block),
      hot: hours.filter((b) => b.score!.index >= 60).length,
      prompts: block.reduce((s, d) => s + d.totals.prompts, 0),
    });
  }
  return weeks;
}

export function trendOf(days: Day[]): Trend {
  const hours = scored(days);
  const levels: Record<Level, number> = { Calm: 0, Warming: 0, Heating: 0, Fried: 0 };
  for (const b of hours) levels[b.score!.level]++;
  const bySessions = [1, 2, 3, 4, 5].map((sessions) => {
    const group = hours.filter((b) => Math.min(b.sessions, 5) === sessions);
    const mean = group.length === 0 ? null : Math.round(group.reduce((s, b) => s + b.score!.index, 0) / group.length);
    return { sessions, hours: group.length, mean };
  });
  const asOf = days.find((d) => d.asOf)?.asOf;
  return {
    from: days[0]!.date,
    to: days[days.length - 1]!.date,
    days: days.length,
    hours: hours.length,
    activeMin: sumActive(days),
    levels,
    weeks: weeksOf(days),
    bySessions,
    ...(asOf ? { asOf } : {}),
  };
}
