import { formatCount, plural } from "./format.ts";
import { levelOf } from "../metrics/index.ts";
import type { Day, HourBucket, Level } from "../types.ts";

const GLYPH: Record<Level, string> = { Calm: "░", Warming: "▒", Heating: "▓", Fried: "█" };
const ANSI: Record<Level, string> = { Calm: "32", Warming: "33", Heating: "35", Fried: "31" };
const LEVEL_NAME: Record<Level, string> = { Calm: "calm", Warming: "warming", Heating: "heating", Fried: "fried" };
const LEVELS: Level[] = ["Calm", "Warming", "Heating", "Fried"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const paint = (s: string, level: Level, color: boolean) => (color ? `\x1b[${ANSI[level]}m${s}\x1b[0m` : s);
const dim = (s: string, color: boolean) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
// Marks the snapshot time on the open day, so two runs minutes apart are
// explained rather than silently disagreeing.
const snapshotLine = (d: Day | undefined, color: boolean): string[] =>
  d?.asOf ? [dim(`  as of ${hhmm(new Date(d.asOf))}, this hour is still running`, color)] : [];
// The weekday of the calendar date, in UTC: a date the local zone skipped
// has no local midnight to ask.
const label = (date: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
};

export function renderWeek(days: Day[], color: boolean): string {
  // 12-char label, 24 cells of 3 chars, peak in 6, active in 8.
  const header = "            " + Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")} `).join("") + "  peak  active";
  const rows = days.map((d) => {
    const cells = d.buckets.map((b) => ` ${b.score ? paint(GLYPH[b.score.level], b.score.level, color) : "·"} `).join("");
    // Padding stays outside the paint so the escape codes add no width.
    const peak = d.peak === null ? "-".padStart(6) : " ".repeat(6 - String(d.peak).length) + paint(String(d.peak), levelOf(d.peak), color);
    const row = `${label(d.date).padEnd(12)}${cells}${peak}${hm(d.activeMin).padStart(8)}`;
    // A day no hour scored in is 24 dots and a dash: no escape of its own, so
    // one dim wrapper is enough.
    return d.peak === null ? dim(row, color) : row;
  });
  // A painted glyph's own \x1b[0m cancels the line's dim; re-emit it after.
  const dimGlyph = (level: Level) => paint(GLYPH[level], level, color) + (color ? "\x1b[2m" : "");
  const legend = dim("  " + LEVELS.map((l) => `${dimGlyph(l)} ${LEVEL_NAME[l]}`).join("   "), color);
  const active = days.reduce((s, d) => s + d.activeMin, 0);
  const prompts = days.reduce((s, d) => s + d.totals.prompts, 0);
  const reports = days.reduce((s, d) => s + d.totals.reports, 0);
  const decisions = days.reduce((s, d) => s + d.totals.decisions, 0);
  const maxSessions = Math.max(0, ...days.map((d) => d.totals.maxSessions));
  // Compact counts keep a very active window inside the grid's 98 columns.
  const totals = dim(`  ${hm(active)} active   ${plural(prompts, "prompt")}   ${plural(reports, "report")}   ${plural(decisions, "decision")}   ${plural(maxSessions, "session")} at once`, color);
  // Today need not be the last row: --to may name a later day.
  return [header, ...rows, "", legend, totals, ...snapshotLine(days.find((d) => d.asOf), color)].join("\n");
}

const fmtTokens = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

type Col = [string, number, (b: HourBucket) => string];

// Hour left-aligned, level left-aligned after two spaces, the rest right-aligned.
const COLS: Col[] = [
  ["hour", 5, (b) => `${String(b.hour).padStart(2, "0")}:00`],
  ["index", 7, (b) => String(b.score?.index ?? "")],
  ["level", 9, (b) => b.score?.level ?? ""],
  ["sess", 6, (b) => String(b.sessions)],
  ["prompts", 9, (b) => String(b.prompts)],
  ["rep", 5, (b) => String(b.reports)],
  ["intr", 6, (b) => String(b.interrupts)],
  ["rej", 5, (b) => String(b.rejects)],
  ["quest", 7, (b) => String(b.questions)],
  ["plan", 6, (b) => String(b.plans)],
  ["mode", 6, (b) => String(b.modeSwitches)],
  ["ctx-sw", 8, (b) => String(b.contextSwitches)],
  ["streak", 8, (b) => `${b.streakMin}m`],
  ["out-tok", 9, (b) => fmtTokens(b.outputTokens)],
];
const EXPLAIN: Col[] = [
  ["par", 5, (b) => String(b.score?.parts.parallel ?? "")],
  ["pace", 6, (b) => String(b.score?.parts.pace ?? "")],
  ["sup", 6, (b) => String(b.score?.parts.supervision ?? "")],
  ["read", 6, (b) => String(b.score?.parts.reading ?? "")],
  ["strk", 6, (b) => String(b.score?.parts.streak ?? "")],
  ["late", 6, (b) => String(b.score?.parts.late ?? "")],
];
// Left out of the table for a day where every active bucket reads zero; the
// other columns always show, so two days still line up.
const EVENT_COLS = new Set(["rep", "intr", "rej", "quest", "plan", "mode", "ctx-sw"]);
const FULL_NAME: Record<string, string> = {
  rep: "reports", intr: "interrupts", rej: "rejects", quest: "questions",
  plan: "plans", mode: "mode switches", "ctx-sw": "context switches",
};

export function renderDay(day: Day, opts: { explain: boolean; color: boolean }): string {
  const cols = opts.explain ? [...COLS, ...EXPLAIN] : COLS;
  const line = (columns: Col[], cells: string[]) =>
    cells.map((c, i) => { const w = columns[i]![1]; if (i === 0) return c.padEnd(w); if (columns[i]![0] === "level") return `  ${c.padEnd(w - 2)}`; return c.padStart(w); }).join("").trimEnd();

  const active = day.buckets.filter((b) => b.score !== null);
  // The snapshot line still shows on an empty open day, or a run at 09:00 and
  // one at 18:00 would print the identical line.
  if (active.length === 0) return [line(cols, cols.map(([name]) => name)), ...snapshotLine(day, opts.color)].join("\n");

  const visible = cols.filter(([name, , f]) => !EVENT_COLS.has(name) || active.some((b) => f(b) !== "0"));
  const leftOut = cols.filter((col) => EVENT_COLS.has(col[0]) && !visible.includes(col));

  const header = line(visible, visible.map(([name]) => name));
  const rows = active.map((b) => {
    const cells = visible.map(([, , f]) => f(b));
    const text = line(visible, cells);
    // Safe only while no other column can contain a level word.
    return opts.color && b.score ? text.replace(b.score.level, paint(b.score.level, b.score.level, true)) : text;
  });
  const lines = [header, ...rows];
  if (leftOut.length > 0) {
    const note = `  no ${leftOut.map(([name]) => FULL_NAME[name]).join(", ")} today`;
    lines.push(dim(note, opts.color));
  }
  lines.push(...snapshotLine(day, opts.color));
  return lines.join("\n");
}

export function renderJson(data: Day[] | Day): string {
  return JSON.stringify(data, null, 2);
}
