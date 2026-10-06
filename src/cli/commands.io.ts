import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { CardWriteError, cardData, cardHtml, loadAssets, openCard, renderCard, sentenceText } from "../lib/card/index.ts";
import { report, type Timing } from "../lib/report/index.ts";
import { renderStatus, statusOf, streakFrom, writeStatus } from "../lib/status/index.ts";
import { renderDay, renderJson, renderWeek } from "../lib/text/index.ts";
import type { TranscriptCache } from "../lib/transcripts/index.ts";
import type { Day } from "../lib/types.ts";
import type { Args } from "./args.ts";

export async function table(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days, now }, timing, cache);
  const data = a.command === "day" ? days[0] : days;
  const text = a.json ? renderJson(data!) : a.command === "day" ? renderDay(days[0]!, { explain: a.explain, color: a.color }) : renderWeek(days, a.color);
  // Not console.log: in Bun 1.4.2, once process.stdout is touched (isTTY in parseArgs), console.log into a pipe stops at 64 KiB.
  process.stdout.write(`${text}\n`);
  return 0;
}

// The write comes first: a caller never reads a line that was not saved.
export async function status(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days, now, streakFrom: streakFrom(now) }, timing, cache);
  const line = renderStatus(statusOf(days[0]!, now));
  const t = performance.now();
  await writeStatus(line, process.env);
  if (timing) timing.writeMs = performance.now() - t;
  process.stdout.write(line);
  return 0;
}

// The label names a file or folder, never a path: the CLI prints no path, not even one typed in.
function cardTarget(out: string | null): { path: string; label: string; unwritable?: string } {
  if (out !== null) return { path: out, label: basename(out) };
  const dir = join(homedir(), "Downloads");
  let isDir = false;
  try { isDir = statSync(dir).isDirectory(); } catch {}
  if (!isDir) throw new Error("no Downloads folder: pass --out <path>");
  return { path: join(dir, "cogload-card.png"), label: "cogload-card.png to Downloads", unwritable: "cannot write cogload-card.png to Downloads: pass --out <path>" };
}

// Keys pressed while the card was drawn answer no question yet asked, so the
// terminal's pending input is dropped first: tcflush(0, TCIFLUSH). Best effort,
// where libc can be found; elsewhere the question reads as before.
const TCIFLUSH: Partial<Record<NodeJS.Platform, { lib: string; queue: number }>> = { darwin: { lib: "libSystem.B.dylib", queue: 1 }, linux: { lib: "libc.so.6", queue: 0 } };
async function discardTypedInput(): Promise<void> {
  const c = TCIFLUSH[process.platform];
  if (!c) return;
  try {
    const { dlopen, FFIType } = await import("bun:ffi");
    const libc = dlopen(c.lib, { tcflush: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } });
    try { libc.symbols.tcflush(0, c.queue); } finally { libc.close(); }
  } catch {}
}

export async function card(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days, now }, timing, cache);
  const data = cardData(days, { days: a.days });
  // A script asking for the data gets a document either way; a picture of nothing is an error.
  if (data === null && a.json) { console.log("null"); return 0; }
  const from = days[0]!.date;
  const to = days[days.length - 1]!.date;
  if (data === null) throw new Error(from === to ? `no activity on ${to}` : `no activity from ${from} to ${to}`);
  if (a.json) {
    const round2 = (x: number): number => Math.round(x * 100) / 100;
    const json = {
      from, to, days: data.days, character: data.character, name: data.name,
      sentence: sentenceText(data.sentence), motto: data.motto,
      shares: { conductor: round2(data.shares.conductor), supervisor: round2(data.shares.supervisor), marathoner: round2(data.shares.marathoner), nightOwl: round2(data.shares.nightOwl) },
      peak: data.peak, spectrum: data.spectrum, highlights: data.highlights,
    };
    console.log(JSON.stringify(json, null, 2));
    return 0;
  }
  const target = cardTarget(a.out);
  // The browser engine takes seconds; a person at a terminal is told why it waits.
  const note = process.stderr.isTTY && !/\.html$/i.test(target.path);
  if (note) process.stderr.write("drawing the card…");
  const t = performance.now();
  try {
    await renderCard(cardHtml(data, await loadAssets()), target.path);
  } catch (e) {
    // Without --out, "check the --out directory" points at a flag the person never used.
    throw e instanceof CardWriteError && target.unwritable ? new Error(target.unwritable) : e;
  } finally {
    if (note) process.stderr.write("\r\x1b[K");
  }
  if (timing) timing.render = { format: target.path.slice(target.path.lastIndexOf(".") + 1).toLowerCase(), ms: performance.now() - t };
  console.log(`${data.name}: ${sentenceText(data.sentence)}\nwrote ${target.label}`);
  if (timing) timing.totalMs = performance.now(); // the wait for an answer is not cogload's time
  if (process.stdin.isTTY && process.stdout.isTTY && process.platform !== "win32") {
    await discardTypedInput();
    process.stdout.write("open it? [Y/n] ");
    let answer: string | null = null;
    for await (const line of console) { answer = line; break; }
    if (answer !== null && /^(y|yes)?$/i.test(answer.trim())) openCard(target.path);
  }
  return 0;
}
