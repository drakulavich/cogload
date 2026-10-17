import { compareStrings, derive, windowBounds } from "./derive.ts";
import { parseTranscript } from "../transcripts/index.ts";
import type { Day, Event, Transcript, Window } from "../types.ts";

// Sorted by path so file discovery order cannot change a result.
export function analyze(transcripts: Transcript[], w: Window): Day[] {
  const { cutoffMs } = windowBounds(w);
  const events = [...transcripts]
    .sort((a, b) => compareStrings(a.path, b.path))
    .flatMap((t) => parseTranscript(t.text, cutoffMs));
  return analyzeEvents(events, w);
}

// Events already parsed, concatenated in path order as `analyze` does.
export function analyzeEvents(events: Event[], w: Window): Day[] {
  return derive(dropCopies(events), w);
}

// A background session copies its history under a new session id, times kept
// to the millisecond (#222); the original never carries `bg`.
function dropCopies(events: Event[]): Event[] {
  const copies = new Map<number, Event[]>();
  for (const e of events) if (e.bg) copies.set(e.ts, [...(copies.get(e.ts) ?? []), e]);
  if (copies.size === 0) return events;
  const dropped = new Set<Event>();
  for (const e of events) {
    if (e.bg) continue;
    for (const c of copies.get(e.ts) ?? []) if (c.kind === e.kind && c.sessionId !== e.sessionId) dropped.add(c);
  }
  return events.filter((e) => !dropped.has(e));
}
