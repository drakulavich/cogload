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
  return derive(events, w);
}
