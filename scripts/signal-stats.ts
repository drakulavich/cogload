#!/usr/bin/env bun
// Calibration tool: per-hour signal distributions, top hours, and a transcript-format
// drift check, for comparing the same window across two machines before touching
// src/score.ts. Shell-side, not a test: gets the distributions and top hours by
// shelling out to `zapara --json` (the same seam a human would use), and never
// imports analyze/derive/score for those numbers. The drift diagnostic separately
// re-scans and re-parses the transcripts to show what the parser currently recognises,
// so it may import `scan` and `parseTranscript` directly (and `windowBounds`, to compute
// the exact same cutoff the report would use). Numbers only, everywhere: never a file
// path, a project root, or message text.
import { homedir } from "node:os";
import { join } from "node:path";
import { windowBounds } from "../src/lib/metrics/index.ts";
import { parseTranscript, scan } from "../src/lib/transcripts/index.ts";
import type { EventKind } from "../src/lib/types.ts";

type Bucket = {
  hour: number;
  sessions: number;
  prompts: number;
  reports: number;
  outputTokens: number;
  decisions: number;
  contextSwitches: number;
  streakMin: number;
  score: { index: number } | null;
};
type Day = { date: string; buckets: Bucket[] };

// usage: signal-stats [--days N] [--to YYYY-MM-DD] [--projects <dir>] [--json]
type Args = { days: string; to: string; projects: string; json: boolean };

class UsageError extends Error {}

function localDate(d: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseArgs(argv: string[], now: Date): Args {
  const a: Args = { days: "14", to: localDate(now), projects: join(homedir(), ".claude", "projects"), json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // A missing value or one that looks like another flag is a usage error, never
    // treated as this flag's value (mirrors src/cli/args.ts's parseArgs).
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("-")) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--days": a.days = value(); break;
      case "--to": a.to = value(); break;
      case "--projects": a.projects = value(); break;
      case "--json": a.json = true; break;
      default: throw new UsageError(`unknown flag ${arg}`);
    }
  }
  return a;
}

// Shells out to the CLI rather than importing report()/analyze(), so this script
// exercises the same path a human invocation would. --days/--to/--projects are
// forwarded unchanged; the CLI validates them, and a failure here is forwarded
// verbatim (first stderr line, same exit code) rather than re-validated.
function runCli(a: Args): Day[] {
  const cli = join(import.meta.dir, "../src/cli/index.ts");
  const proc = Bun.spawnSync(
    ["bun", cli, "--json", "--days", a.days, "--to", a.to, "--projects", a.projects],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (proc.exitCode !== 0) {
    const line = new TextDecoder().decode(proc.stderr).split("\n")[0] ?? "";
    console.error(line);
    process.exit(proc.exitCode ?? 1);
  }
  return JSON.parse(new TextDecoder().decode(proc.stdout)) as Day[];
}

type Stats = { n: number; p50: number; p75: number; p90: number; max: number; zero: number };

// Percentile: the value at index floor(p * n) of the ascending sort (clamped to the
// last index for p === 1), never interpolated. Matches "p90 of 10 active hours" being
// simply the 9th of the ten sorted values, so it stays exact for the tiny n typical here.
function computeStats(xs: number[]): Stats {
  const s = [...xs].sort((x, y) => x - y);
  const n = s.length;
  const pct = (p: number): number => (n === 0 ? 0 : (s[Math.min(n - 1, Math.floor(p * n))] ?? 0));
  return { n, p50: pct(0.5), p75: pct(0.75), p90: pct(0.9), max: n === 0 ? 0 : Math.max(...s), zero: xs.filter((x) => x === 0).length };
}

const SIGNALS: { label: string; get: (b: Bucket) => number }[] = [
  { label: "prompts", get: (b) => b.prompts },
  { label: "reports", get: (b) => b.reports },
  { label: "outputTokens", get: (b) => b.outputTokens },
  { label: "sessions", get: (b) => b.sessions },
  { label: "decisions", get: (b) => b.decisions },
  { label: "contextSwitches", get: (b) => b.contextSwitches },
  { label: "streakMin", get: (b) => b.streakMin },
  { label: "index", get: (b) => b.score!.index },
];

function renderTable(active: Bucket[]): string {
  const rows = SIGNALS.map((sig) => ({ label: sig.label, ...computeStats(active.map(sig.get)) }));
  const cols = ["n", "p50", "p75", "p90", "max", "zero"] as const;
  const labelW = Math.max("signal".length, ...rows.map((r) => r.label.length)) + 1;
  // Each column is as wide as its longest value (outputTokens can run to 6+ digits), plus a
  // fixed 2-space gap, so a wide value can never run into the next column with no separator.
  const gap = "  ";
  const colW = Object.fromEntries(
    cols.map((c) => [c, Math.max(c.length, ...rows.map((r) => String(r[c]).length))]),
  ) as Record<(typeof cols)[number], number>;
  const header = "signal".padEnd(labelW) + cols.map((c) => c.padStart(colW[c])).join(gap);
  const lines = rows.map((r) => r.label.padEnd(labelW) + cols.map((c) => String(r[c]).padStart(colW[c])).join(gap));
  return [header, ...lines].join("\n");
}

function renderTopHours(active: (Bucket & { date: string })[], by: "reports" | "prompts", label: string): string {
  const top = [...active].sort((x, y) => y[by] - x[by]).slice(0, 8);
  const rows = top.map(
    (b) =>
      `  ${b.date} ${String(b.hour).padStart(2, "0")}:00  sess ${b.sessions}  prompts ${b.prompts}  reports ${b.reports}` +
      `  out ${(b.outputTokens / 1000).toFixed(1)}k  dec ${b.decisions}  idx ${b.score!.index}`,
  );
  return [`top 8 hours by ${label}:`, ...rows].join("\n");
}

const EVENT_KINDS: EventKind[] = ["prompt", "report", "output", "interrupt", "reject", "answer", "question", "plan_review", "mode_change", "activity"];

type Drift = {
  files: number;
  lines: number;
  recordsWithType: number;
  topTypes: { type: string; count: number }[];
  events: number;
  eventsByKind: Record<EventKind, number>;
  eventsPerRecordWithType: number;
};

// Re-reads every transcript the report would read (same scan rules: .jsonl, no
// `subagents` segment, mtime >= cutoff) and counts what the parser currently
// recognises, so a machine with a newer Claude Code that renamed a field shows up
// as `events` well below `recordsWithType` instead of silently scoring zero.
// `scan()` selects *files* by mtime, which can be well inside the window even
// though the file holds older lines too (a session spanning weeks); to describe
// the same data the distributions above do, both `recordsWithType`/`topTypes` and
// the parsed `events` are additionally filtered to timestamps within
// `[cutoffMs, endMs)` — the exact bounds `derive()` uses. A record with no
// parseable `timestamp` is not counted at all (there is no window to test it against).
async function computeDrift(projects: string, to: string, days: number): Promise<Drift> {
  const { cutoffMs, endMs } = windowBounds({ to, days });
  const entries = await scan(projects, cutoffMs);
  let lines = 0;
  let recordsWithType = 0;
  const typeCounts = new Map<string, number>();
  const eventsByKind = Object.fromEntries(EVENT_KINDS.map((k) => [k, 0])) as Record<EventKind, number>;
  let events = 0;
  const inWindow = (ts: number): boolean => !Number.isNaN(ts) && ts >= cutoffMs && ts < endMs;

  for (const { path } of entries) {
    let text: string;
    try { text = await Bun.file(path).text(); } catch { continue; } // vanished or unreadable: skip, like report()

    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      lines++;
      let rec: unknown;
      try { rec = JSON.parse(line); } catch { continue; }
      if (typeof rec !== "object" || rec === null) continue;
      const type = (rec as { type?: unknown }).type;
      if (typeof type !== "string") continue;
      const rawTs = (rec as { timestamp?: unknown }).timestamp;
      const ts = typeof rawTs === "string" ? Date.parse(rawTs) : NaN;
      if (!inWindow(ts)) continue;
      recordsWithType++;
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    }

    for (const e of parseTranscript(text)) {
      if (!inWindow(e.ts)) continue;
      events++;
      eventsByKind[e.kind]++;
    }
  }

  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([type, count]) => ({ type, count }));

  return { files: entries.length, lines, recordsWithType, topTypes, events, eventsByKind, eventsPerRecordWithType: recordsWithType === 0 ? 0 : events / recordsWithType };
}

function renderDrift(d: Drift): string {
  const byKind = EVENT_KINDS.map((k) => `${k} ${d.eventsByKind[k]}`).join(", ");
  // A `type` value comes straight from someone else's JSONL and is never trusted: it could hold
  // a newline or an ANSI escape. Capped to 40 characters, then JSON-encoded, so it can never
  // split this into more than one physical line or write a raw control byte to the terminal.
  const topTypes = d.topTypes.map((t) => `${JSON.stringify(t.type.slice(0, 40))} ${t.count}`).join(", ");
  return [
    `files: ${d.files}, lines read: ${d.lines}`,
    `records with type: ${d.recordsWithType}, events: ${d.events} (${byKind})`,
    `top types: ${topTypes}`,
    `events per record with type: ${d.eventsPerRecordWithType.toFixed(2)}`,
  ].join("\n");
}

async function main(): Promise<number> {
  let a: Args;
  try {
    a = parseArgs(process.argv.slice(2), new Date());
  } catch (e) {
    console.error(`signal-stats: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const cliDays = runCli(a); // exits the process itself on CLI failure
  const active = cliDays.flatMap((d) => d.buckets.map((b) => ({ ...b, date: d.date }))).filter((b) => b.score !== null);
  const drift = await computeDrift(a.projects, a.to, Number(a.days));

  if (a.json) {
    const distributions = Object.fromEntries(SIGNALS.map((sig) => [sig.label, computeStats(active.map(sig.get))]));
    console.log(
      JSON.stringify({
        days: Number(a.days),
        to: a.to,
        activeHours: active.length,
        distributions,
        topByReports: [...active].sort((x, y) => y.reports - x.reports).slice(0, 8),
        topByPrompts: [...active].sort((x, y) => y.prompts - x.prompts).slice(0, 8),
        drift: {
          files: drift.files,
          lines: drift.lines,
          recordsWithType: drift.recordsWithType,
          topTypes: drift.topTypes,
          events: drift.events,
          eventsByKind: drift.eventsByKind,
          eventsPerRecordWithType: drift.eventsPerRecordWithType,
        },
      }),
    );
    return 0;
  }

  console.log(`active hours over ${a.days} days: ${active.length}\n`);
  console.log(renderTable(active));
  console.log();
  console.log(renderTopHours(active, "reports", "reports"));
  console.log();
  console.log(renderTopHours(active, "prompts", "human prompts"));
  console.log();
  console.log(renderDrift(drift));
  return 0;
}

if (import.meta.main) {
  // computeDrift() runs after the CLI has already succeeded and can still reject on its own
  // (e.g. the projects root vanishes or becomes unreadable between the two): caught here so
  // it never surfaces as an unhandled-rejection stack trace, only ever one stderr line, no path.
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      console.error(`signal-stats: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    },
  );
}
