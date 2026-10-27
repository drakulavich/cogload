// Deterministic 7-day fixture. Monday is the reference day the README shows.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  assistant,
  assistantText,
  interrupt,
  mode,
  nextRequestId,
  plan,
  prompt,
  question,
  reject,
  writeTree,
} from "../helpers/transcript.ts";

const root = join(import.meta.dir, "busy-week", "projects");
const sid = (n: number) => `${String(n).repeat(8)}-1111-4111-8111-111111111111`;
const ts = (day: number, h: number, m: number) => new Date(Date.UTC(2026, 8, day, h, m)).toISOString();

type File = { path: string; lines: string[]; mtime: string };
const files: File[] = [];
// `kind` keeps a calm() and a storm() call on the same day and session number from
// colliding on disk: without it, Monday's storm (n=1..5) overwrites the calm
// morning's project-1 file (also n=1) and its events silently vanish. Event-level
// analysis is global across files regardless of which file an event lives in, so
// splitting the path this way does not change the streak or session counting.
const path = (day: number, n: number, kind: string) => `-Users-me-proj-${n}-${kind}/${day}-${sid(n)}.jsonl`;

// One session working alone: a prompt and a reply every 10 minutes across [from, to) hours.
function calm(day: number, n: number, from: number, to: number) {
  const lines = [mode(sid(n), "auto")];
  for (let h = from; h < to; h++)
    for (let m = 0; m < 60; m += 10) {
      lines.push(prompt(ts(day, h, m), sid(n)));
      lines.push(assistant(ts(day, h, m + 3), sid(n)));
    }
  files.push({ path: path(day, n, "calm"), lines, mtime: ts(day, to, 0) });
}
// Five sessions at once with interrupts, rejections, questions and a plan review.
// The loop stops while m + 4 < 60 (the widest offset used below, for the reject/
// question/plan lines) so no event's timestamp ever crosses into the next hour;
// calm() only ever adds 3 to an m that stops at 50, so it cannot overflow.
// Each reply carries 1000 output tokens (its own requestId, so none is deduped
// away), so a full storm hour reads 55 x 1000 = 55.0k tokens. Real heavy hours
// carry 60k-236k; at calm()'s 100 tokens a storm hour would read 5.5k and the
// reading component would be invisible in the week picture.
//
// `lastMin` is the last minute at which the storm may start an event, and it
// applies to every hour the call spans, not only the last one (every caller
// that passes it so far storms a single hour). A full storm hour caps the
// 40-minute streak norm on its own, so a storm meant to read below Fried has to
// stop short of the cap: see Friday below. The default sits above every m the
// loop can reach, so `m + 4 < 60` stays the only bound on a full hour and this
// parameter cannot silently become the binding one if that offset ever changes.
function storm(day: number, from: number, to: number, lastMin = 59) {
  for (let n = 1; n <= 5; n++) {
    const lines = [mode(sid(n), "auto")];
    for (let h = from; h < to; h++)
      for (let m = n; m + 4 < 60 && m <= lastMin; m += 5) {
        lines.push(prompt(ts(day, h, m), sid(n)));
        lines.push(assistantText(ts(day, h, m + 2), sid(n), 1000, nextRequestId()));
        if (m % 15 === n % 15) lines.push(interrupt(ts(day, h, m + 3), sid(n)));
        if (n === 2 && m === 22) lines.push(reject(ts(day, h, m + 4), sid(n)));
        if (n === 3 && m === 33) lines.push(question(ts(day, h, m + 4), sid(n)));
        if (n === 4 && m === 44) {
          lines.push(plan(ts(day, h, m + 4), sid(n)));
          lines.push(mode(sid(n), "plan"));
          lines.push(mode(sid(n), "auto"));
        }
      }
    files.push({ path: path(day, n, "storm"), lines, mtime: ts(day, to, 0) });
  }
}

// One prompt on its own, in a file of its own, to hold a presence streak open.
// Presence is the human's: a streak continues only across a gap of at most 10
// minutes between two of their own actions, and the reply that closes a calm exchange is
// not presence. Called last so the two extra prompts cannot shift the uuids and
// request ids of every file built above them.
function stillThere(day: number, n: number, h: number, m: number) {
  files.push({ path: path(day, n, `still-${h}-${m}`), lines: [prompt(ts(day, h, m), sid(n))], mtime: ts(day, h, m) });
}

await rm(root, { recursive: true, force: true });
// Mon 14: calm morning, storm 12-15 with no gap after it (streak at cap → index 87, Fried), calm evening, late-night tail
calm(14, 1, 9, 12);
storm(14, 12, 15);
calm(14, 6, 20, 22);
calm(14, 7, 23, 24);
// Tue 15: two sessions 10-18, the window's longest run
calm(15, 1, 10, 18);
calm(15, 2, 14, 17);
// Wed 16: nothing
// Thu 17: one calm session 11-13
calm(17, 1, 11, 13);
// Fri 18: half a storm 15:01-15:30 with no warm-up. A whole storm hour caps the
// 40-minute streak by itself and reads 87, exactly Monday's later storm hours;
// stopping at minute 30 leaves a 29-minute streak and an index of 81, one band
// below (Heating), which is the contrast this day exists to draw.
storm(18, 15, 16, 30);
// Sat 19: late night only 0-2
calm(19, 1, 0, 2);
// Sun 20: nothing
// Monday 11:59 hands the calm morning to the storm: 11:50 to 11:59 is 9 minutes
// and 11:59 to the storm's first prompt at 12:01 is 2, so presence runs unbroken
// from 9:00 and hour 12 opens at the streak cap, Fried. Tuesday 17:53 ends the
// window's longest run on a prompt rather than on the reply that used to close
// it, keeping that run 10:00 to 17:53.
stillThere(14, 1, 11, 59);
stillThere(15, 1, 17, 53);
await writeTree(root, files);
console.log(`wrote ${files.length} transcripts under ${root}`);
