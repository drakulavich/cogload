import { READERS, type Timing } from "../lib/report/index.ts";

// Numbers only: someone pastes these from another machine, and no path may leave it.
export function timingLines(t: Timing, env: { version: string; bun: string; platform: string; arch: string; cpus: number; nowMs: number }): string {
  const row = (label: string, what: string, ms: number) => `${label.padEnd(8)}${what.padEnd(44)}${String(Math.round(ms)).padStart(7)} ms\n`;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return `cogload ${env.version} · bun ${env.bun} · ${env.platform} ${env.arch} · ${env.cpus} cpus\n`
    + row("start", "bun, modules, arguments", t.startMs ?? 0)
    + (t.openMs !== undefined ? row("open", "cache", t.openMs) : "")
    + row("scan", `${plural(t.files, "file")}, ${t.inWindow} in window, ${plural(t.tailChecks, "tail check")}`, t.scanMs)
    + (t.cache ? row("cache", `${plural(t.cache.hits, "hit")}, ${plural(t.cache.misses, "miss", "misses")}`, t.lookupMs) : `${"cache".padEnd(8)}off\n`)
    + row("read", `${plural(t.read, "file")}, ${(t.bytes / 1e6).toFixed(1)} MB, ${READERS} at a time`, t.readMs)
    + row("analyze", "", t.analyzeMs)
    + (t.cache ? row("save", "cache", t.saveMs) : "")
    + (t.render ? row("render", t.render.format, t.render.ms) : "")
    + (t.writeMs !== undefined ? row("write", "status file", t.writeMs) : "")
    + row("total", "", t.totalMs ?? env.nowMs);
}
