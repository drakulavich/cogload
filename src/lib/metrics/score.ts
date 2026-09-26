import type { Level, Metrics, Parts, Score } from "../types.ts";

// Calibration lives here and nowhere else. Integer points of 100, so 0.5 sums
// stay exact; norms are the p90 of two weeks on two machines (see CHANGELOG).
export const WEIGHTS = { parallel: 25, pace: 15, supervision: 30, reading: 10, streak: 10, late: 10 } as const;
export const NORMS = { parallelSpan: 4, pacePerHour: 20, supervisionPerHour: 45, decisionWeight: 3, readingTokens: 80_000, streakMin: 40 } as const;
export const LEVELS: readonly { max: number; level: Level }[] = [
  { max: 29, level: "Calm" },
  { max: 59, level: "Warming" },
  { max: 84, level: "Heating" },
  { max: 100, level: "Fried" },
];

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function levelOf(index: number): Level {
  for (const l of LEVELS) if (index <= l.max) return l.level;
  return "Fried";
}

export function score(m: Metrics): Score | null {
  if (m.sessions === 0) return null;
  const parallel = clamp01((m.sessions - 1) / NORMS.parallelSpan);
  const pace = clamp01(m.prompts / NORMS.pacePerHour);
  // A decision costs `decisionWeight` reports or session hops; the three share a norm.
  const supervision = clamp01(
    (NORMS.decisionWeight * m.decisions + m.reports + m.contextSwitches) / NORMS.supervisionPerHour,
  );
  const reading = clamp01(m.outputTokens / NORMS.readingTokens);
  const streak = clamp01(m.streakMin / NORMS.streakMin);
  const late = m.lateNight ? 1 : 0;

  const raw = {
    parallel: WEIGHTS.parallel * parallel,
    pace: WEIGHTS.pace * pace,
    supervision: WEIGHTS.supervision * supervision,
    reading: WEIGHTS.reading * reading,
    streak: WEIGHTS.streak * streak,
    late: WEIGHTS.late * late,
  };
  // Rounded for display only.
  const parts: Parts = {
    parallel: Math.round(raw.parallel * 10) / 10,
    pace: Math.round(raw.pace * 10) / 10,
    supervision: Math.round(raw.supervision * 10) / 10,
    reading: Math.round(raw.reading * 10) / 10,
    streak: Math.round(raw.streak * 10) / 10,
    late: Math.round(raw.late * 10) / 10,
  };
  // Rounded once from the raw points, so parts' rounding can never tip it across a boundary.
  const index = Math.round(
    raw.parallel + raw.pace + raw.supervision + raw.reading + raw.streak + raw.late,
  );
  return { index, level: levelOf(index), parts };
}
