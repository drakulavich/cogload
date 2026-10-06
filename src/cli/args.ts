import { localDate } from "../lib/metrics/index.ts";

export const USAGE = `usage: cogload [window]                 the last 7 days, one cell per hour
       cogload today|yesterday|<date>   one day, one row per active hour
       cogload card [window] [--out]    the last 14 days as one picture
       cogload status                   write today's load for a status line

window:
  --days <N>        the last N days, 1..90; with --to, N days ending there
  --from <date>     first day; --to <date> last day, default today
                    a date is YYYY-MM-DD, today or yesterday

options:
  --explain         with a day: the six weighted parts behind each index
  --out <path>      with card: .png, .webp or .html
                    (default ~/Downloads/cogload-card.png)
  --json            the same data as JSON; for the grid and a day,
                    a pipe gets JSON without asking
  --projects <dir>  read this directory instead of ~/.claude/projects
  --no-color        no ANSI colors; NO_COLOR does the same
  --no-cache        parse every transcript again
  --verbose         timings and counts on stderr, for a slow run
  -h, --help  -V, --version

levels: calm 0-29  warming 30-59  heating 60-84  fried 85-100

bugs, ideas and a star: github.com/drakulavich/cogload`;
export const HINT = "run 'cogload --help' for usage";

export type Args = { command: "grid" | "day" | "card" | "status"; to: string; days: number; explain: boolean; json: boolean; out: string | null; projects: string; color: boolean; verbose: boolean; cache: boolean };

export class UsageError extends Error {}
// Thrown only at a flag position, never for a token consumed as another flag's
// value (`--to --help`).
export class HelpRequested extends Error {}
export class VersionRequested extends Error {}

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
  if (s > localDate(now)) throw new UsageError(`${s} is in the future`);
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

export function parseArgs(argv: string[], now: Date, env: Record<string, string | undefined>, isTTY: boolean, projects: string): Args {
  const a: Args = { command: "grid", to: localDate(now), days: 7, explain: false, json: false, out: null, projects, color: isTTY && !env.NO_COLOR, verbose: false, cache: true };
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
    // A value that looks like another flag is a usage error (`--projects --json`),
    // and so is an empty one (`--projects=`); only --days accepts a negative
    // number, so `--days -1` reaches the range check.
    const value = (negativeNumberIsValue = false): string => {
      let v: string;
      if (inline !== null) v = inline;
      else {
        const next = argv[++i];
        if (next === undefined || (next.startsWith("-") && !(negativeNumberIsValue && /^-\d/.test(next)))) throw new UsageError(`${arg} needs a value`);
        v = next;
      }
      if (v === "") throw new UsageError(`${arg} needs a value`);
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
  if (a.json && a.out !== null) throw new UsageError("--json writes no file; drop --out");
  if (a.out !== null) {
    // Printed back verbatim in `wrote \u2026`, so it must be one plain line.
    if (/[\x00-\x1f\x7f]/.test(a.out)) throw new UsageError("--out must not contain control characters");
    if (!/\.(png|webp|html)$/i.test(a.out)) throw new UsageError("--out must end in .png, .webp or .html");
  }
  return a;
}
