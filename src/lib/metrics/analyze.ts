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

// A background session copies its history, uuids kept, under a new session id (#222).
function dropCopies(events: Event[]): Event[] {
  const owner = new Map<string, string>();
  return events.filter((e) => {
    if (e.uuid === undefined) return true;
    const sid = owner.get(e.uuid);
    if (sid === undefined) owner.set(e.uuid, e.sessionId);
    return sid === undefined || sid === e.sessionId;
  });
}
