export type EventKind = "prompt" | "report" | "output" | "interrupt" | "reject" | "answer" | "question" | "plan_review" | "mode_change" | "activity";
export type Event = { ts: number; sessionId: string; kind: EventKind; tokens?: number };
export type Transcript = { path: string; text: string };
export type Window = { to: string; days: number; now?: Date }; // to = "YYYY-MM-DD" local
export type Metrics = {
  sessions: number; prompts: number; reports: number; outputTokens: number; interrupts: number; rejects: number; questions: number;
  plans: number; modeSwitches: number; decisions: number; contextSwitches: number;
  activeMin: number; streakMin: number; lateNight: boolean;
};
export type Level = "Calm" | "Warming" | "Heating" | "Fried";
export type Parts = { parallel: number; pace: number; supervision: number; reading: number; streak: number; late: number }; // weighted points, sum ≈ index
export type Score = { index: number; level: Level; parts: Parts };
export type LiveBucket = Metrics & { score: Score | null };
export type HourBucket = LiveBucket & { hour: number };
export type Totals = { prompts: number; reports: number; outputTokens: number; interrupts: number; rejects: number; questions: number; plans: number; modeSwitches: number; decisions: number; contextSwitches: number; maxSessions: number };
// `asOf` and `live` exist only on the day containing `now`: `live` is the sixty
// minutes `(asOf − 60 min, asOf]`, by the hour bucket's rule, look-back included.
// `presence` is the day's last human action and the start of its streak, which
// may lie on an earlier day; instants are ISO 8601 UTC.
export type Day = { date: string; peak: number | null; mean: number | null; activeMin: number; presence: { lastAt: string; streakStartAt: string } | null; totals: Totals; buckets: HourBucket[]; asOf?: string; live?: LiveBucket };
