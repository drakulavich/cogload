import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { analyze } from "../../src/lib/metrics/index.ts";
import { renderDay, renderJson, renderWeek } from "../../src/lib/text/index.ts";
import { report } from "../../src/lib/report/index.ts";
import { assistant, interrupt, mode, plan, prompt, question, reject, teammate, transcript } from "../helpers/transcript.ts";
import type { Day, HourBucket } from "../../src/lib/types.ts";

const projects = join(import.meta.dir, "../fixtures/busy-week/projects");
const days = await report({ projects, to: "2026-09-20", days: 7 });
const monday = days[0]!;
const tuesday = days[1]!; // two calm sessions overlap 14-17
const wednesday = days[2]!; // empty
const thursday = days[3]!; // one calm session, 11-13: every event column reads zero

describe("week grid", () => {
  const text = renderWeek(days, false);
  const lines = text.split("\n");

  test("header, seven rows, legend and totals", () => {
    expect(lines[0]).toBe("            00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23   peak  active");
    expect(lines.slice(1, 8).map((l) => l.slice(0, 9))).toEqual(["Mon 14/09", "Tue 15/09", "Wed 16/09", "Thu 17/09", "Fri 18/09", "Sat 19/09", "Sun 20/09"]);
    expect(lines[8]).toBe("");
    expect(lines[9]).toBe("  ░ calm   ▒ warming   ▓ heating   █ fried");
    // Hand-computed from the generator's day-by-day schedule (see busy-week.ts):
    // prompts 202 (Mon) + 67 (Tue) + 12 (Thu) + 30 (Fri) + 12 (Sat) = 323, the
    // two extras being the stillThere() prompts that carry a presence streak
    // where a reply used to; reports 0, since busy-week has no inbound
    // agent-message lines; decisions 75 (Mon storm, three full hours) + 11
    // (Fri's half storm: 10 interrupts and 1 reject, the question at minute 33
    // and the plan at 44 falling past its minute-30 stop) = 86; max sessions is
    // the Mon/Fri storm's 5.
    // Active minutes are the slots presence covers, so each run fills the gaps
    // between its prompts: Mon 8h50 (9:00-14:55 unbroken, 20:00-21:50,
    // 23:00-23:50), Tue 7h55 (10:00-17:53), Thu 1h55, Fri 0h35 (15:01-15:30),
    // Sat 1h55 = 21h10.
    expect(lines[10]).toBe("  21h10 active   323 prompts   0 reports   86 decisions   5 sessions at once");
  });

  test("Monday reads calm morning, fried storm, quiet evening, late tail", () => {
    const row = lines[1]!;
    const cells = Array.from({ length: 24 }, (_, h) => row[12 + h * 3 + 1]);
    expect(cells.slice(0, 9).join("")).toBe("·········");
    expect(cells[9]).toBe("░");
    // The stillThere() prompt at 11:59 carries presence from the calm morning
    // into the storm (9 minutes, then 2 to the storm's first prompt at 12:01),
    // so hour 12 already opens past the 40-minute cap: index 87, Fried.
    expect(cells[12]).toBe("█");
    expect(cells[13]).toBe("█");
    expect(cells[14]).toBe("█");
    // Storm(14, 12, 15) stops before 15:00 (see the m + 4 < 60 loop bound in
    // busy-week.ts), so hour 15 has no session at all, not a bleed-over glyph.
    expect(cells[15]).toBe("·");
    expect(cells[16]).toBe("·");
    expect(cells[23]).toBe("░");
    expect(row.slice(84)).toMatch(/^\s+\d{1,3}\s+\d+h\d{2}$/);
  });

  test("Friday's warm-up-less half storm is Heating, one band below Monday's, and does not bleed into the next hour", () => {
    const row = lines[5]!;
    const cells = Array.from({ length: 24 }, (_, h) => row[12 + h * 3 + 1]);
    // 5 sessions, 30 prompts, 11 decisions, 29 context switches, 30 000 output
    // tokens, streak 29 min (prompts every minute 15:01 to 15:30, no calm
    // warm-up before them), not a late hour:
    // parallel 25 + pace 15 + supervision 30 ((3*11 + 29)/45 = 62/45, past the
    // norm) + reading 10*(30000/80000) = 3.75 + streak 10*(29/40) = 7.25
    // + late 0 = 81, Heating (60-84).
    // Monday's storm hours are the same shape run for a full hour: their streak
    // is at the 40-minute cap and they read 87, Fried. The half hour is what
    // keeps the two apart, so this test and Monday's below are one pair.
    expect(cells[15]).toBe("▓");
    expect(cells[16]).toBe("·");
  });

  test("an empty day shows a dot in every cell and a dash for peak", () => {
    const row = lines[3]!; // Wed
    expect(row.slice(12, 84).replace(/\s/g, "")).toBe("·".repeat(24));
    expect(row.slice(84).trim().startsWith("-")).toBe(true);
  });

  test("a day with nothing in it prints dim, and only in color mode", () => {
    // Mutations this pins: dropping the conditional (Wednesday prints bright),
    // widening it past `peak === null` (Monday prints dim), and dimming
    // regardless of `color` (the plain grid grows an escape).
    const coloredLines = renderWeek(days, true).split("\n");
    expect(coloredLines[3]).toStartWith("\x1b[2mWed 16/09");
    expect(coloredLines[3]).toEndWith("0h00\x1b[0m");
    expect(coloredLines[1]).toStartWith("Mon 14/09");
    expect(lines[3]).not.toContain("\x1b");
  });

  test("color mode wraps glyphs in ANSI codes and nothing else changes", () => {
    const colored = renderWeek(days, true);
    expect(colored).toContain("\x1b[31m█\x1b[0m");
    expect(colored.replace(/\x1b\[\d+m/g, "")).toBe(text);
  });

  test("color mode paints the peak with the level its index falls in", () => {
    // The same thresholds `zapara status` uses for its level: Monday's peak 87
    // is Fried although its last active hour is Calm, Tuesday's 33 is Warming
    // although its last hour is Calm too, and Thursday's 15 is Calm. The
    // mutation this pins: painting the peak with the day's last level, or with
    // one color for every day. A padded dash stays unpainted.
    const coloredLines = renderWeek(days, true).split("\n");
    expect(coloredLines[1]).toEndWith("    \x1b[31m87\x1b[0m    8h50");
    expect(coloredLines[2]).toContain("\x1b[33m33\x1b[0m");
    expect(coloredLines[4]).toContain("\x1b[32m15\x1b[0m");
    expect(coloredLines[3]).toEndWith("     -    0h00\x1b[0m");
    expect(coloredLines[3]).not.toContain("\x1b[3");
  });

  test("color mode dims the legend and totals lines, without losing the painted glyph's dim", () => {
    // Mutation this pins: dropping the \x1b[2m/\x1b[0m dim wrapper around either
    // line, or forgetting to re-emit \x1b[2m after the glyph's own \x1b[0m
    // (which would leave "calm" etc. bright instead of dim).
    const coloredLines = renderWeek(days, true).split("\n");
    expect(coloredLines[9]).toMatch(/^\x1b\[2m/);
    expect(coloredLines[9]).toMatch(/\x1b\[0m$/);
    expect(coloredLines[9]).toContain("\x1b[32m░\x1b[0m\x1b[2m");
    expect(coloredLines[10]).toBe("\x1b[2m  21h10 active   323 prompts   0 reports   86 decisions   5 sessions at once\x1b[0m");
  });

  test("the totals line uses the singular for exactly one", () => {
    const one = analyze([transcript([prompt("2026-09-14T13:00:00.000Z", "aaaaaaaa-1111-4111-8111-111111111111")])], { to: "2026-09-14", days: 1 });
    const totals = renderWeek(one, false).split("\n")[4]!;
    expect(totals).toMatch(/ active   1 prompt   0 reports   0 decisions   1 session at once$/);
  });

  test("the totals line stays inside 100 columns by compacting large counts", () => {
    // Mutation this pins: dropping formatCount from any of the four counts
    // (prompts, reports, decisions, sessions at once) in the totals line.
    const emptyBucket = (hour: number): HourBucket => ({
      hour, score: null, sessions: 0, prompts: 0, reports: 0, outputTokens: 0, interrupts: 0, rejects: 0,
      questions: 0, plans: 0, modeSwitches: 0, decisions: 0, contextSwitches: 0, activeMin: 0, streakMin: 0, lateNight: false,
    });
    const emptyBuckets = (): HourBucket[] => Array.from({ length: 24 }, (_, h) => emptyBucket(h));
    const emptyDay = (date: string): Day => ({ date, peak: null, mean: null, activeMin: 0, presence: null, buckets: emptyBuckets(), totals: { prompts: 0, reports: 0, outputTokens: 0, interrupts: 0, rejects: 0, questions: 0, plans: 0, modeSwitches: 0, decisions: 0, contextSwitches: 0, maxSessions: 0 } });
    // One day carries every huge value; the other six stay empty, so the week
    // sums (prompts, reports, decisions) equal that day's totals exactly and
    // maxSessions (a max, not a sum) is unaffected by how many days hold it.
    const hugeDay: Day = { ...emptyDay("2026-09-14"), activeMin: 999_999, totals: { prompts: 999_999_999, reports: 999_999_999, outputTokens: 0, interrupts: 0, rejects: 0, questions: 0, plans: 0, modeSwitches: 0, decisions: 999_999_999, contextSwitches: 0, maxSessions: 999_999_999 } };
    const hugeDays = [hugeDay, emptyDay("2026-09-15"), emptyDay("2026-09-16"), emptyDay("2026-09-17"), emptyDay("2026-09-18"), emptyDay("2026-09-19"), emptyDay("2026-09-20")];
    const hugeLines = renderWeek(hugeDays, false).split("\n");
    expect(hugeLines[9]).toBe("  ░ calm   ▒ warming   ▓ heating   █ fried");
    expect(hugeLines[10]).toBe("  16666h39 active   999M prompts   999M reports   999M decisions   999M sessions at once");
    expect(hugeLines[9]!.length).toBeLessThanOrEqual(100);
    expect(hugeLines[10]!.length).toBeLessThanOrEqual(100);
    // Values under 10 000 (busy-week's) are unaffected by the compact format.
    expect(lines[9]).toBe("  ░ calm   ▒ warming   ▓ heating   █ fried");
    expect(lines[10]).toBe("  21h10 active   323 prompts   0 reports   86 decisions   5 sessions at once");
  });
});

describe("day table", () => {
  test("one row per active hour with the raw signals, and the all-zero rep column left out", () => {
    const lines = renderDay(monday, { explain: false, color: false }).split("\n");
    // busy-week has no inbound agent messages, so `rep` reads 0 in every bucket all
    // day and is left out; every other event column is nonzero somewhere (the
    // storm hours). Mutation: dropping `rep` from EVENT_COLS would put it back.
    expect(lines[0]).toBe("hour   index  level    sess  prompts  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok");
    const row13 = lines.find((l) => l.startsWith("13:00"))!;
    // 5 sessions x 11 prompt/reply pairs each (m = n, n+5, ..., <=55) = 55 prompts and
    // 55 assistant replies at 1000 output tokens apiece = 55000 -> "55.0k".
    expect(row13).toMatch(/^13:00\s+\d{1,3}\s+Fried\s+5\s+55\s+\d+\s+1\s+1\s+1\s+2\s+\d+\s+\d+m\s+55\.0k$/);
    expect(lines.some((l) => l.startsWith("03:00"))).toBe(false);
    expect(lines[lines.length - 1]).toBe("  no reports today");
  });

  test("a day with only one calm session leaves out every event column", () => {
    // Thursday: one session, 11:00-13:00, no interrupts/rejects/questions/plans/mode
    // switches/context switches all day (a lone session never hops or gets flagged).
    // Mutation: forgetting one column from EVENT_COLS, or the wrong full name for
    // one, leaves this note short a word or wrong.
    const lines = renderDay(thursday, { explain: false, color: false }).split("\n");
    expect(lines[0]).toBe("hour   index  level    sess  prompts  streak  out-tok");
    expect(lines.length).toBe(4); // header + 11:00 + 12:00 + note
    expect(lines[1]!.startsWith("11:00")).toBe(true);
    expect(lines[2]!.startsWith("12:00")).toBe(true);
    expect(lines[3]).toBe("  no reports, interrupts, rejects, questions, plans, mode switches, context switches today");
  });

  test("an empty day keeps the full header and no note", () => {
    // Mutation: emitting the note, or dropping columns, on a day with no active bucket.
    const text = renderDay(wednesday, { explain: false, color: false });
    expect(text).toBe("hour   index  level    sess  prompts  rep  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok");
  });

  test("an empty day that is still open ends with the snapshot time", () => {
    // A quiet today needs "as of" too: otherwise a run at 09:00 and one at
    // 18:00 on an empty today would print the identical output.
    const [open] = analyze([], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T09:15:00.000Z") });
    expect(renderDay(open!, { explain: false, color: false }).split("\n").at(-1)).toBe("  as of 09:15, this hour is still running");
    const [closed] = analyze([], { to: "2026-09-14", days: 1 });
    expect(renderDay(closed!, { explain: false, color: false })).not.toContain("as of");
  });

  test("color mode dims the left-out-columns note and nothing else changes", () => {
    // Mutation: forgetting to dim the note, or dimming more than just that line.
    const plainText = renderDay(thursday, { explain: false, color: false });
    const coloredText = renderDay(thursday, { explain: false, color: true });
    const coloredLines = coloredText.split("\n");
    const note = "  no reports, interrupts, rejects, questions, plans, mode switches, context switches today";
    expect(coloredLines[coloredLines.length - 1]).toBe(`\x1b[2m${note}\x1b[0m`);
    expect(coloredText.replace(/\x1b\[\d+m/g, "")).toBe(plainText);
  });

  test("a day where every event happened prints the full header and no note", () => {
    // Built through analyze(), not the busy-week fixture: busy-week's `rep` reads 0
    // every day (it has no inbound agent messages anywhere), so leftOut is never
    // truly empty there and this branch would otherwise go unpinned. Two sessions,
    // one file each (mode tracking is per file, so interleaving them in one file
    // would let A's mode records be read as B's): A gets a prompt, an interrupt, a
    // reject, a question, a plan review and a mode switch; B gets a later prompt
    // (a context switch, since the last prompt was A's) and a report.
    // Mutation this pins: `if (leftOut.length > 0)` -> `if (true)` would still print
    // a note here, since every event column is nonzero somewhere in this day.
    const A = "aaaaaaaa-1111-4111-8111-111111111111";
    const B = "bbbbbbbb-1111-4111-8111-111111111111";
    const at = (hhmm: string) => `2026-09-14T${hhmm}:00.000Z`;
    const ta = transcript(
      [
        mode(A, "auto"),
        prompt(at("13:00"), A),
        assistant(at("13:01"), A),
        interrupt(at("13:02"), A),
        reject(at("13:03"), A),
        question(at("13:04"), A),
        plan(at("13:05"), A),
        mode(A, "plan"),
      ],
      "a/s.jsonl",
    );
    const tb = transcript(
      [
        mode(B, "auto"),
        prompt(at("13:06"), B),
        assistant(at("13:07"), B),
        teammate(at("13:08"), B),
      ],
      "b/s.jsonl",
    );
    const day = analyze([ta, tb], { to: "2026-09-14", days: 1 })[0]!;
    const lines = renderDay(day, { explain: false, color: false }).split("\n");
    expect(lines[0]).toBe("hour   index  level    sess  prompts  rep  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok");
    expect(lines.length).toBe(2); // header + one row (13:00), no note
    expect(lines.some((l) => l.startsWith("  no "))).toBe(false);
  });

  test("a day taken today ends with the snapshot time; a closed day does not", () => {
    const t = transcript([prompt("2026-09-14T13:00:00.000Z", "aaaaaaaa-1111-4111-8111-111111111111")]);
    const [day] = analyze([t], { to: "2026-09-14", days: 1, now: new Date("2026-09-14T14:32:00.000Z") });
    expect(renderDay(day!, { explain: false, color: false }).split("\n").at(-1)).toBe("  as of 14:32, this hour is still running");
    expect(renderWeek([day!], false).split("\n").at(-1)).toBe("  as of 14:32, this hour is still running");
    const [closed] = analyze([t], { to: "2026-09-14", days: 1 });
    expect(renderDay(closed!, { explain: false, color: false })).not.toContain("as of");
    expect(renderWeek([closed!], false)).not.toContain("as of");
  });

  test("--explain appends the six weighted parts, named and in order, and they add up to the index", () => {
    const lines = renderDay(monday, { explain: true, color: false }).split("\n");
    expect(lines[0]!.endsWith("  par  pace   sup  read  strk  late")).toBe(true);
    const row13 = lines.find((l) => l.startsWith("13:00"))!;
    const nums = row13.trim().split(/\s+/);
    const index = Number(nums[1]);
    const parts = nums.slice(-6).map(Number);
    // Named by position (par, pace, sup, read, strk, late), not just their sum:
    // 5 sessions saturate par, 55 prompts saturate pace, 25 decisions alone put
    // supervision past its norm (3*25 = 75 > 45), 55 replies x 1000 tokens give
    // read 10*(55000/80000) = 6.875 -> 6.9, presence has run unbroken from 9:00
    // to 13:55 (295 minutes) so strk is at the 40-minute cap, and 13:00 isn't
    // a late hour. Index 86.875 -> 87.
    expect(parts).toEqual([25, 15, 30, 6.9, 10, 0]);
    expect(Math.round(parts.reduce((a, b) => a + b, 0))).toBe(index);
  });

  test("--explain columns on a row where no two parts share a value", () => {
    // Tuesday 14:00: two calm sessions overlap (calm(15, 1, 10, 18) and
    // calm(15, 2, 14, 17)), 12 prompts and 12 replies of 100 tokens.
    // parallel 25 · (1/4) = 6.25 rounded to 6.3, pace 15 · (12/20) = 9,
    // supervision 30 · (0 + 0 + 11)/45 = 7.3333 rounded to 7.3 (no decisions and
    // no reports: the 11 context switches between the two sessions are the whole
    // load), reading 10 · (1200/80000) = 0.15 rounded to 0.2, streak 10 ·
    // min(1, 290/40) = 10 (presence has run from 10:00, long past the norm),
    // late 0 (14:00 is not in the late-night set).
    // Index 6.25 + 9 + 7.3333 + 0.15 + 10 + 0 = 32.7333 -> 33. Every part here
    // holds a different value, so a swap between any two accessors fails on this
    // row; unlike 13:00's row, four of the six are fractions, so the one-decimal
    // rounding of the parts is exercised at the same time.
    const lines = renderDay(tuesday, { explain: true, color: false }).split("\n");
    const row14 = lines.find((l) => l.startsWith("14:00"))!;
    const nums = row14.trim().split(/\s+/);
    const index = Number(nums[1]);
    const parts = nums.slice(-6).map(Number);
    expect(parts).toEqual([6.3, 9, 7.3, 0.2, 10, 0]);
    expect(index).toBe(33);
    expect(Math.round(parts.reduce((a, b) => a + b, 0))).toBe(index);
  });
});

describe("json", () => {
  test("renderJson is pretty JSON of the same data", () => {
    expect(JSON.parse(renderJson(days))).toEqual(JSON.parse(JSON.stringify(days)));
    expect(renderJson(monday).startsWith("{\n")).toBe(true);
  });
});
