import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cardData, cardHtml, loadAssets, openCard, renderCard, sentenceText } from "../lib/card/index.ts";
import { report, type Timing } from "../lib/report/index.ts";
import { renderStatus, statusOf, writeStatus } from "../lib/status/index.ts";
import { renderDay, renderJson, renderWeek } from "../lib/text/index.ts";
import type { TranscriptCache } from "../lib/transcripts/index.ts";
import type { Day } from "../lib/types.ts";
import type { Args } from "./args.ts";

export async function table(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days, now }, timing, cache);
  const data = a.command === "day" ? days[0] : days;
  if (a.json) console.log(renderJson(data!));
  else if (a.command === "day") console.log(renderDay(days[0]!, { explain: a.explain, color: a.color }));
  else console.log(renderWeek(days, a.color));
  return 0;
}

// The write comes first: a caller never reads a line that was not saved.
export async function status(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days, now }, timing, cache);
  const line = renderStatus(statusOf(days[0]!, now));
  const t = performance.now();
  await writeStatus(line, process.env);
  if (timing) timing.writeMs = performance.now() - t;
  process.stdout.write(line);
  return 0;
}

// The label names the folder, not the path: the CLI never prints a derived path.
function cardTarget(out: string | null): { path: string; label: string } {
  if (out !== null) return { path: out, label: out };
  const dir = join(homedir(), "Downloads");
  let isDir = false;
  try { isDir = statSync(dir).isDirectory(); } catch {}
  if (!isDir) throw new Error("no Downloads folder: pass --out <path>");
  return { path: join(dir, "zapara-card.png"), label: "zapara-card.png to Downloads" };
}

export async function card(a: Args, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days }, timing, cache);
  const data = cardData(days, { days: a.days });
  if (data === null) throw new Error(`no activity in the last ${a.days} days`);
  if (a.json) {
    const round2 = (x: number): number => Math.round(x * 100) / 100;
    const json = {
      from: days[0]!.date, to: days[days.length - 1]!.date, days: data.days, character: data.character, name: data.name,
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
  } finally {
    if (note) process.stderr.write("\r\x1b[K");
  }
  if (timing) timing.render = { format: target.path.slice(target.path.lastIndexOf(".") + 1).toLowerCase(), ms: performance.now() - t };
  console.log(`${data.name}: ${sentenceText(data.sentence)}\nwrote ${target.label}`);
  if (timing) timing.totalMs = performance.now(); // the wait for an answer is not zapara's time
  if (process.stdin.isTTY && process.stdout.isTTY && process.platform !== "win32") {
    process.stdout.write("open it? [Y/n] ");
    let answer: string | null = null;
    for await (const line of console) { answer = line; break; }
    if (answer !== null && /^(y|yes)?$/i.test(answer.trim())) openCard(target.path);
  }
  return 0;
}
