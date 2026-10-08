import { type Fractions, fractionsOf, NORMS, score, scoreOf } from "./score.ts";
import type { Day, Event, EventKind, HourBucket, LiveBucket, Metrics, Totals, Window } from "../types.ts";

const LOOKBACK_MS = 3 * 60 * 60 * 1000;
export const GAP_MS = 10 * 60 * 1000;
const SLOT_MS = 5 * 60 * 1000;
const LIVE_MS = 60 * 60 * 1000;
const LATE_HOURS = new Set([23, 0, 1, 2, 3, 4, 5]);

// Not localeCompare: a result must not depend on the locale.
export const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pad2 = (n: number) => String(n).padStart(2, "0");
export const localDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDate = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d); // local midnight
};

// The dates are counted on the calendar, in UTC: local midnight of a day a
// zone skipped (Samoa, 30 December 2011) is the next day's, which would list
// that day twice. The skipped date stays as a day with no hours.
// cutoffMs is the earliest instant read: the look-back, or `streakFrom` when earlier.
export function windowBounds(w: Window): { startMs: number; endMs: number; cutoffMs: number; dates: string[] } {
  const to = parseDate(w.to);
  const [y, m, d] = w.to.split("-").map(Number) as [number, number, number];
  const dates: string[] = [];
  for (let i = w.days - 1; i >= 0; i--) {
    const u = new Date(Date.UTC(y, m - 1, d - i));
    dates.push(`${u.getUTCFullYear()}-${pad2(u.getUTCMonth() + 1)}-${pad2(u.getUTCDate())}`);
  }
  const startMs = parseDate(dates[0]!).getTime();
  const endMs = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime();
  return { startMs, endMs, cutoffMs: Math.min(startMs - LOOKBACK_MS, w.streakFrom?.getTime() ?? Infinity), dates };
}

const emptyMetrics = (): Metrics => ({
  sessions: 0, prompts: 0, reports: 0, outputTokens: 0, interrupts: 0, rejects: 0, questions: 0, plans: 0, modeSwitches: 0,
  decisions: 0, contextSwitches: 0, activeMin: 0, streakMin: 0, lateNight: false,
});

// Presence is the human's own actions only: agent records and the agent's asks
// are never presence, because presence answers "is it time to rest?".
const PRESENCE: ReadonlySet<EventKind> = new Set<EventKind>(["prompt", "interrupt", "reject", "answer"]);

type Acc = { m: Metrics; sessions: Set<string>; slots: Set<number>; lastPromptSession: string | null; maxStreakMs: number; lastPresence: { ts: number; streakStart: number } | null };
const newAcc = (): Acc => ({ m: emptyMetrics(), sessions: new Set(), slots: new Set(), lastPromptSession: null, maxStreakMs: 0, lastPresence: null });

// Inside a streak the human sat through the gap, so a pair of actions covers
// every slot between them; an action that starts a streak covers only its own.
const coverage = (prevTs: number | null, streakStart: number, e: Event): { from: number; to: number; streakStart: number } => {
  const to = Math.floor(e.ts / SLOT_MS);
  if (prevTs !== null && e.ts - prevTs <= GAP_MS) return { from: Math.floor(prevTs / SLOT_MS), to, streakStart };
  return { from: to, to, streakStart: e.ts };
};

// The counts an hour bucket and the live bucket share. `streakStart` is the
// caller's: a streak may have begun before this accumulator's window. The streak
// kept is the longest seen, not the one the window ended on, or a single prompt
// after a break would erase the run.
function accumulate(a: Acc, e: Event, streakStart: number): void {
  if (PRESENCE.has(e.kind)) {
    a.maxStreakMs = Math.max(a.maxStreakMs, e.ts - streakStart);
    a.lastPresence = { ts: e.ts, streakStart }; // for the day's live streak
  }
  switch (e.kind) {
    case "activity":
      a.sessions.add(e.sessionId);
      break;
    case "prompt":
      a.m.prompts++;
      if (a.lastPromptSession !== null && a.lastPromptSession !== e.sessionId) a.m.contextSwitches++;
      a.lastPromptSession = e.sessionId;
      break;
    case "report": a.m.reports++; break;
    case "output": a.m.outputTokens += e.tokens ?? 0; break;
    case "interrupt": a.m.interrupts++; break;
    case "reject": a.m.rejects++; break;
    case "question": a.m.questions++; break;
    case "plan_review": a.m.plans++; break;
    case "mode_change": a.m.modeSwitches++; break;
  }
}

// `lateNight` is the caller's: an hour's own label, or the hour of `now` for the
// live bucket. A fresh accumulator is an empty hour and scores null.
function finish(a: Acc, lateNight: boolean, streakMin = Math.round(a.maxStreakMs / 60000)): LiveBucket {
  const m = a.m;
  m.sessions = a.sessions.size;
  m.activeMin = a.slots.size * 5;
  m.streakMin = streakMin;
  m.decisions = m.interrupts + m.rejects + m.questions + m.plans + m.modeSwitches;
  m.lateNight = lateNight;
  return { ...m, score: score(m) };
}

// The 24 hour buckets, keyed "date|hour". Events before startMs are look-back:
// they move the streak but enter no bucket, though a span from one into the
// window still covers the window's first slots.
function foldEvents(sorted: Event[], startMs: number): { acc: Map<string, Acc>; carried: { ts: number; streakStart: number } | null } {
  const acc = new Map<string, Acc>(); // key "date|hour"
  const key = (ts: number): string => {
    const d = new Date(ts);
    return `${localDate(d)}|${d.getHours()}`;
  };
  const get = (k: string): Acc => {
    let a = acc.get(k);
    if (!a) { a = newAcc(); acc.set(k, a); }
    return a;
  };

  let prevPresenceTs: number | null = null;
  let streakStart = 0; // always set by the first presence event, which starts a streak
  let carried: { ts: number; streakStart: number } | null = null;
  for (const e of sorted) {
    if (PRESENCE.has(e.kind)) {
      const c = coverage(prevPresenceTs, streakStart, e);
      streakStart = c.streakStart;
      for (let s = c.from; s <= c.to; s++) {
        const slotStart = s * SLOT_MS;
        if (slotStart >= startMs) get(key(slotStart)).slots.add(s); // a slot belongs to the bucket of its start
      }
      prevPresenceTs = e.ts;
      // A person at the keyboard at 23:58 is still in that streak at 00:03,
      // and the day they are looking at holds nothing yet.
      if (e.ts < startMs) carried = { ts: e.ts, streakStart };
    }
    if (e.ts < startMs) continue; // look-back: presence bookkeeping only
    accumulate(get(key(e.ts)), e, streakStart);
  }
  return { acc, carried };
}

// The sixty minutes ending at `now`, by the rule an hour bucket uses. Presence
// runs from the first event, so a streak older than the window is measured from
// where it began. Events before the day's start count here, unlike in a bucket:
// the window is a clock's hour, not a calendar's.
function foldLive(sorted: Event[], nowMs: number, sinceMs = -Infinity): Acc {
  const a = newAcc();
  const fromMs = nowMs - LIVE_MS;
  const inWindow = (t: number): boolean => t > fromMs && t >= sinceMs && t <= nowMs;
  let prevPresenceTs: number | null = null;
  let streakStart = 0;
  for (const e of sorted) {
    if (PRESENCE.has(e.kind)) {
      const c = coverage(prevPresenceTs, streakStart, e);
      streakStart = c.streakStart;
      for (let s = c.from; s <= c.to; s++) if (inWindow(s * SLOT_MS)) a.slots.add(s);
      prevPresenceTs = e.ts;
    }
    if (inWindow(e.ts)) accumulate(a, e, streakStart);
  }
  return a;
}

// The streak must stay statusOf's streakMin; a break before it cools the score.
function liveBucket(sorted: Event[], presenceTs: number[], presence: Day["presence"], nowMs: number, lateNight: boolean): LiveBucket {
  const lastMs = presence ? Date.parse(presence.lastAt) : null;
  const startMs = lastMs !== null && nowMs - lastMs <= GAP_MS ? Date.parse(presence!.streakStartAt) : null;
  const streakMin = startMs === null ? 0 : Math.round((nowMs - startMs) / 60000);
  const full = finish(foldLive(sorted, nowMs), lateNight, streakMin);
  if (full.score === null) return full;
  const f = fractionsOf(full);
  const after = startMs === null ? null : fractionsOf(finish(foldLive(sorted, nowMs, startMs), lateNight, streakMin));
  const breakFrom = startMs === null ? lastMs : presenceTs.findLast((t) => t < startMs);
  const w = breakFrom == null ? 0 : Math.max(0, 1 - ((startMs ?? nowMs) - breakFrom) / (NORMS.coolMin * 60_000));
  const cooled = Object.fromEntries(Object.entries(f).map(([p, v]) => {
    const a = after?.[p as keyof Fractions] ?? 0;
    return [p, a + w * (v - a)];
  })) as Fractions;
  return { ...full, score: scoreOf(cooled) };
}

function buildDay(date: string, acc: Map<string, Acc>): Day {
  const buckets: HourBucket[] = [];
  // Hours run in time order, so the last write is the day's last action.
  let lastPresence: { ts: number; streakStart: number } | null = null;
  for (let hour = 0; hour < 24; hour++) {
    const a = acc.get(`${date}|${hour}`);
    if (a?.lastPresence) lastPresence = a.lastPresence;
    buckets.push({ ...finish(a ?? newAcc(), LATE_HOURS.has(hour)), hour });
  }
  const scored = buckets.filter((b) => b.score !== null);
  const totals: Totals = buckets.reduce((t, b) => ({
    prompts: t.prompts + b.prompts, reports: t.reports + b.reports, outputTokens: t.outputTokens + b.outputTokens,
    interrupts: t.interrupts + b.interrupts, rejects: t.rejects + b.rejects,
    questions: t.questions + b.questions, plans: t.plans + b.plans, modeSwitches: t.modeSwitches + b.modeSwitches,
    decisions: t.decisions + b.decisions, contextSwitches: t.contextSwitches + b.contextSwitches,
    maxSessions: Math.max(t.maxSessions, b.sessions),
  }), { prompts: 0, reports: 0, outputTokens: 0, interrupts: 0, rejects: 0, questions: 0, plans: 0, modeSwitches: 0, decisions: 0, contextSwitches: 0, maxSessions: 0 });
  return {
    date,
    peak: scored.length ? Math.max(...scored.map((b) => b.score!.index)) : null,
    mean: scored.length ? Math.round(scored.reduce((s, b) => s + b.score!.index, 0) / scored.length) : null,
    activeMin: buckets.reduce((s, b) => s + b.activeMin, 0),
    presence: lastPresence && { lastAt: new Date(lastPresence.ts).toISOString(), streakStartAt: new Date(lastPresence.streakStart).toISOString() },
    totals,
    buckets,
  };
}

// Walks a streak's start back through earlier presence, one gap of at most
// GAP_MS at a time. `earlier` is ascending and all before `start`.
function traceBack(start: number, earlier: number[]): number {
  for (let i = earlier.length - 1; i >= 0 && start - earlier[i]! <= GAP_MS; i--) start = earlier[i]!;
  return start;
}

export function derive(events: Event[], w: Window): Day[] {
  const { startMs, endMs, cutoffMs, dates } = windowBounds(w);
  const lookbackMs = startMs - LOOKBACK_MS;
  // sort() is stable, so events equal on both keys keep their input order.
  const read = events
    .filter((e) => e.ts >= cutoffMs && e.ts < endMs && (!w.now || e.ts <= w.now.getTime()))
    .sort((a, b) => a.ts - b.ts || compareStrings(a.sessionId, b.sessionId));
  // Events before the look-back, read only for `streakFrom`, move nothing but
  // the start of a streak in `presence`.
  const sorted = read.filter((e) => e.ts >= lookbackMs);
  const earlier = read.filter((e) => e.ts < lookbackMs && PRESENCE.has(e.kind)).map((e) => e.ts);
  const { acc, carried } = foldEvents(sorted, startMs);
  const days = dates.map((date) => buildDay(date, acc));
  // Only a first day with no action of its own borrows the look-back's streak,
  // and only into `presence`: no bucket, total or active minute crosses back.
  const first = days[0];
  if (first && first.presence === null && carried) {
    first.presence = { lastAt: new Date(carried.ts).toISOString(), streakStartAt: new Date(carried.streakStart).toISOString() };
  }
  for (const d of days) {
    if (d.presence) d.presence.streakStartAt = new Date(traceBack(Date.parse(d.presence.streakStartAt), earlier)).toISOString();
  }
  if (w.now) {
    const today = localDate(w.now);
    const open = days.find((d) => d.date === today);
    if (open) {
      open.asOf = w.now.toISOString();
      const presenceTs = read.filter((e) => PRESENCE.has(e.kind)).map((e) => e.ts);
      open.live = liveBucket(sorted, presenceTs, open.presence, w.now.getTime(), LATE_HOURS.has(w.now.getHours()));
    }
  }
  return days;
}
