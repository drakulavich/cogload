#!/usr/bin/env bun
// Argument parsing, the clock, stdout and exit codes live here; everything else is pure.
import { readFileSync, statSync } from "node:fs";
import { cpus, homedir } from "node:os";
import { join } from "node:path";
import { openCache, type TranscriptCache } from "./lib/transcripts/index.ts";
import { cardData, sentenceText, cardHtml, loadAssets, openCard, renderCard } from "./lib/card/index.ts";
import { localDate } from "./lib/metrics/index.ts";
import { renderDay, renderJson, renderWeek } from "./lib/text/index.ts";
import { READERS, report, type Timing } from "./lib/report/index.ts";
import { renderStatus, statusOf, writeStatus } from "./lib/status/index.ts";
import type { Day } from "./lib/types.ts";

// Read only when --version is handled, so a broken package.json fails inside
// the guarded catch instead of at module load.
function version(): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof parsed === "object" && parsed !== null && typeof (parsed as { version?: unknown }).version === "string") {
    return (parsed as { version: string }).version;
  }
  throw new Error("package.json has no version");
}

const USAGE = `usage: zapara [window]                 the last 7 days, one cell per hour
       zapara today|yesterday|<date>   one day, one row per active hour
       zapara card [window] [--out]    the last 14 days as one picture
       zapara status                   write today's load for a status line

window:
  --days <N>        the last N days, 1..90; with --to, N days ending there
  --from <date>     first day; --to <date> last day, default today
                    a date is YYYY-MM-DD, today or yesterday

options:
  --explain         with a day: the six weighted parts behind each index
  --out <path>      with card: .png, .webp or .html
                    (default ~/Downloads/zapara-card.png)
  --json            the same data as JSON; a pipe gets JSON without asking
  --projects <dir>  read this directory instead of ~/.claude/projects
  --no-color        no ANSI colors; NO_COLOR does the same
  --no-cache        parse every transcript again
  --verbose         timings and counts on stderr, for a slow run
  -h, --help  -V, --version

levels: calm 0-29  warming 30-59  heating 60-84  fried 85-100

bugs, ideas and a star: github.com/drakulavich/zapara`;
const HINT = "run 'zapara --help' for usage";

type Args = { command: "grid" | "day" | "card" | "status"; to: string; days: number; explain: boolean; json: boolean; out: string | null; projects: string; color: boolean; verbose: boolean; cache: boolean };

class UsageError extends Error {}
// Thrown only at a flag position, never for a token consumed as another flag's
// value (`--to --help`).
class HelpRequested extends Error {}
class VersionRequested extends Error {}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A usage error quotes the value only when it is short, printable ASCII with no
// path separator: the CLI never prints a path or an escape, even one typed in.
const quotable = (v: string): boolean => /^[\x21-\x7e]{1,24}$/.test(v) && !/[\/\\]/.test(v);
const got = (v: string): string => (quotable(v) ? `, got ${v}` : "");
const named = (v: string): string => (quotable(v) ? ` ${v}` : "");

function validDate(s: string): boolean {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

function resolveDate(what: string, s: string, now: Date): string {
  if (s === "today") return localDate(now);
  if (s === "yesterday") return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (!validDate(s)) throw new UsageError(`${what} must be YYYY-MM-DD, today or yesterday${got(s)}`);
  return s;
}

// UTC arithmetic, so a DST day is still one day.
function spanDays(from: string, to: string): number {
  const utc = (s: string): number => { const [y = 0, m = 0, d = 0] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
}

// Checks run in the order a reader meets the flags in --help.
function windowOf(days: string | null, from: string | null, to: string | null, defaultDays: number, now: Date): { to: string; days: number } {
  if (from !== null && days !== null) throw new UsageError("--from sets the length; drop --days");
  if (days !== null && (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 90)) throw new UsageError(`--days must be 1..90${got(days)}`);
  const last = to === null ? localDate(now) : resolveDate("--to", to, now);
  if (from === null) return { to: last, days: days === null ? defaultDays : Number(days) };
  const first = resolveDate("--from", from, now);
  const span = spanDays(first, last);
  if (span < 1) throw new UsageError(`--from ${first} is after --to ${last}`);
  if (span > 90) throw new UsageError(`--from ${first} to ${last} is ${span} days; the most is 90`);
  return { to: last, days: span };
}

function parseArgs(argv: string[], now: Date, env: NodeJS.ProcessEnv, isTTY: boolean): Args {
  const a: Args = { command: "grid", to: localDate(now), days: 7, explain: false, json: false, out: null, projects: join(homedir(), ".claude", "projects"), color: isTTY && !env.NO_COLOR, verbose: false, cache: true };
  let days: string | null = null;
  let from: string | null = null;
  let to: string | null = null;
  let jsonFlag = false;
  const positional: string[] = [];
  // A value flag given twice is a usage error; bare flags are idempotent and untracked.
  const seen = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!;
    let inline: string | null = null;
    const eq = arg.startsWith("--") ? arg.indexOf("=") : -1;
    if (eq > 0) { inline = arg.slice(eq + 1); arg = arg.slice(0, eq); }
    const bare = (): void => { if (inline !== null) throw new UsageError(`unknown flag${named(argv[i]!)}`); };
    // A value that looks like another flag is a usage error (`--projects --json`);
    // only --days accepts a negative number, so `--days -1` reaches the range check.
    const value = (negativeNumberIsValue = false): string => {
      let v: string;
      if (inline !== null) v = inline;
      else {
        const next = argv[++i];
        if (next === undefined || (next.startsWith("-") && !(negativeNumberIsValue && /^-\d/.test(next)))) throw new UsageError(`${arg} needs a value`);
        v = next;
      }
      if (seen.has(arg)) throw new UsageError(`${arg} given twice`);
      seen.add(arg);
      return v;
    };
    switch (arg) {
      case "--help":
      case "-h": bare(); throw new HelpRequested();
      case "--version":
      case "-V": bare(); throw new VersionRequested();
      case "--json": bare(); jsonFlag = true; break;
      case "--explain": bare(); a.explain = true; break;
      case "--no-color": bare(); a.color = false; break;
      case "--verbose": bare(); a.verbose = true; break;
      case "--no-cache": bare(); a.cache = false; break;
      case "--projects": a.projects = value(); break;
      case "--from": from = value(); break;
      case "--to": to = value(); break;
      case "--days": days = value(true); break;
      case "--out": a.out = value(); break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown flag${named(arg)}`);
        positional.push(arg);
    }
  }
  if (positional.length > 1) throw new UsageError(`unexpected argument${named(positional[1]!)}`);
  const [word] = positional;
  if (word === undefined) a.command = "grid";
  else if (word === "card") a.command = "card";
  else if (word === "status") { a.command = "status"; a.to = localDate(now); a.days = 1; }
  else if (word === "today" || word === "yesterday" || DATE.test(word)) { a.command = "day"; a.to = resolveDate("date", word, now); a.days = 1; }
  else throw new UsageError(`unknown command${named(word)} (try today, yesterday, a date, card or status)`);

  if (a.command === "day" || a.command === "status") {
    if (days !== null || from !== null || to !== null) throw new UsageError(`--days, --from and --to do not apply to ${a.command === "day" ? "a named day" : "status"}`);
  } else {
    ({ to: a.to, days: a.days } = windowOf(days, from, to, a.command === "card" ? 14 : 7, now));
  }
  // The card is a file either way, so only an explicit --json switches it.
  a.json = a.command === "card" ? jsonFlag : jsonFlag || !isTTY;
  if (a.command !== "day" && a.explain) throw new UsageError("--explain applies to a named day only");
  if (a.command !== "card" && a.out !== null) throw new UsageError("--out applies to card only");
  if (a.out !== null) {
    // Printed back verbatim in `wrote \u2026`, so it must be one plain line.
    if (/[\x00-\x1f\x7f]/.test(a.out)) throw new UsageError("--out must not contain control characters");
    if (!/\.(png|webp|html)$/i.test(a.out)) throw new UsageError("--out must end in .png, .webp or .html");
  }
  return a;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const now = new Date();
  const a = parseArgs(argv, now, process.env, process.stdout.isTTY === true);
  const timing = a.verbose ? ({ startMs: performance.now() } as Timing) : undefined;
  const t = performance.now();
  const cache = a.cache ? openCache(process.env) : null;
  if (timing && a.cache) timing.openMs = performance.now() - t;
  try {
    const code = a.command === "card" ? await card(a, cache, timing) : a.command === "status" ? await status(a, now, cache, timing) : await table(a, now, cache, timing);
    if (timing) process.stderr.write(timingLines(timing));
    return code;
  } finally {
    cache?.close();
  }
}

async function table(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
  const days: Day[] = await report({ projects: a.projects, to: a.to, days: a.days, now }, timing, cache);
  const data = a.command === "day" ? days[0] : days;
  if (a.json) console.log(renderJson(data!));
  else if (a.command === "day") console.log(renderDay(days[0]!, { explain: a.explain, color: a.color }));
  else console.log(renderWeek(days, a.color));
  return 0;
}

// The write comes first: a caller never reads a line that was not saved.
async function status(a: Args, now: Date, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
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

async function card(a: Args, cache: TranscriptCache | null, timing?: Timing): Promise<number> {
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

// Numbers only: someone pastes these from another machine, and no path may leave it.
function timingLines(t: Timing): string {
  let ver = "?";
  try { ver = version(); } catch {}
  const row = (label: string, what: string, ms: number) => `${label.padEnd(8)}${what.padEnd(44)}${String(Math.round(ms)).padStart(7)} ms\n`;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return `zapara ${ver} · bun ${Bun.version} · ${process.platform} ${process.arch} · ${cpus().length} cpus\n`
    + row("start", "bun, modules, arguments", t.startMs ?? 0)
    + (t.openMs !== undefined ? row("open", "cache", t.openMs) : "")
    + row("scan", `${plural(t.files, "file")}, ${t.inWindow} in window, ${plural(t.tailChecks, "tail check")}`, t.scanMs)
    + (t.cache ? row("cache", `${plural(t.cache.hits, "hit")}, ${plural(t.cache.misses, "miss", "misses")}`, t.lookupMs) : `${"cache".padEnd(8)}off\n`)
    + row("read", `${plural(t.read, "file")}, ${(t.bytes / 1e6).toFixed(1)} MB, ${READERS} at a time`, t.readMs)
    + row("analyze", "", t.analyzeMs)
    + (t.cache ? row("save", "cache", t.saveMs) : "")
    + (t.render ? row("render", t.render.format, t.render.ms) : "")
    + (t.writeMs !== undefined ? row("write", "status file", t.writeMs) : "")
    + row("total", "", t.totalMs ?? performance.now());
}

if (import.meta.main) {
  main().then((code) => process.exit(code), (e: unknown) => {
    if (e instanceof HelpRequested) { console.log(USAGE); process.exit(0); }
    if (e instanceof VersionRequested) {
      try { console.log(version()); process.exit(0); }
      catch (err) { console.error(`zapara: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof UsageError) { console.error(`zapara: ${msg}\n${HINT}`); process.exit(2); }
    console.error(`zapara: ${msg}`);
    process.exit(1);
  });
}
