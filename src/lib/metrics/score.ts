import type { Level, Metrics, Part, Parts, Score } from "../types.ts";

// Calibration lives here and nowhere else. Integer points of 100, so 0.5 sums
// stay exact; norms are the p90 of two weeks on two machines (see CHANGELOG).
export const WEIGHTS = { parallel: 25, pace: 15, supervision: 30, reading: 10, streak: 10, late: 10 } as const;
export const NORMS = {
  parallelSpan: 4,
  pacePerHour: 20,
  supervisionPerHour: 45,
  decisionWeight: 3,
  readingTokens: 80_000,
  streakMin: 40,
  coolMin: 20,
} as const;
const LEVELS: readonly { max: number; level: Level }[] = [
  { max: 29, level: "Calm" },
  { max: 59, level: "Warming" },
  { max: 84, level: "Heating" },
  { max: 100, level: "Fried" },
];

const BY_WEIGHT = (Object.keys(WEIGHTS) as Part[]).sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function levelOf(index: number): Level {
  for (const l of LEVELS) if (index <= l.max) return l.level;
  return "Fried";
}

export type Fractions = Record<Part, number>;

export function score(m: Metrics): Score | null {
  return m.sessions === 0 ? null : scoreOf(fractionsOf(m));
}

function rawOf(m: Metrics): Record<Exclude<Part, "late">, number> {
  return {
    parallel: (m.sessions - 1) / NORMS.parallelSpan,
    pace: m.prompts / NORMS.pacePerHour,
    // A decision costs `decisionWeight` reports or session hops; the three share a norm.
    supervision: (NORMS.decisionWeight * m.decisions + m.reports + m.contextSwitches) / NORMS.supervisionPerHour,
    reading: m.outputTokens / NORMS.readingTokens,
    streak: m.streakMin / NORMS.streakMin,
  };
}

export function fractionsOf(m: Metrics): Fractions {
  const r = rawOf(m);
  return {
    parallel: clamp01(r.parallel),
    pace: clamp01(r.pace),
    supervision: clamp01(r.supervision),
    reading: clamp01(r.reading),
    streak: clamp01(r.streak),
    late: m.lateNight ? 1 : 0,
  };
}

export function scoreOf(fractions: Fractions): Score {
  const { parallel, pace, supervision, reading, streak, late } = fractions;
  const capped = BY_WEIGHT.filter((p) => fractions[p] === 1);
  const top = BY_WEIGHT.reduce((a, b) => (fractions[b] > fractions[a] ? b : a));

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
  const index = Math.round(raw.parallel + raw.pace + raw.supervision + raw.reading + raw.streak + raw.late);
  return { index, level: levelOf(index), parts, capped, top };
}
