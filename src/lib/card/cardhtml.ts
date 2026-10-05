// Nothing is escaped because nothing from a transcript reaches this file: only
// CardData's fixed strings and formatted numbers. The look is the table in
// docs/superpowers/specs/2026-09-18-zapara-card-design.md.
import type { CardData, Character, Segment } from "./card.ts";
import type { Level } from "../types.ts";

export type CardAssets = {
  fonts: { inter400: string; inter700: string; inter800: string; mono500: string };
  characters: string;
};

// Fractions [x, y, w, h] of the sheet's side, measured on assets/characters.webp.
// Scaled so the longer side is BOX px, centred at CENTRE; nothing is cropped.
const CHARACTER_RECTS: Record<Character, [number, number, number, number]> = {
  conductor: [0.02, 0.01, 0.53, 0.543],
  supervisor: [0.55, 0.07, 0.38, 0.505],
  marathoner: [0.02, 0.553, 0.50, 0.437],
  nightOwl: [0.54, 0.585, 0.45, 0.41],
};
const BOX = 360;
const CENTRE = { x: 195, y: 300 };

// main, its rgb for alpha gradients, and the light shade for the repo link.
const ACCENT: Record<Character, { main: string; rgb: string; light: string }> = {
  conductor: { main: "#8b5cf6", rgb: "139,92,246", light: "#c4b5fd" },
  supervisor: { main: "#22d3ee", rgb: "34,211,238", light: "#a5f3fc" },
  marathoner: { main: "#f59e0b", rgb: "245,158,11", light: "#fde68a" },
  nightOwl: { main: "#60a5fa", rgb: "96,165,250", light: "#bfdbfe" },
};
const LEVEL_CLASS: Record<Level, string> = { Calm: "calm", Warming: "warm", Heating: "heat", Fried: "fried" };

function spriteStyle(c: Character): string {
  const [x, y, w, h] = CHARACTER_RECTS[c];
  const size = BOX / Math.max(w, h);
  const bw = w * size;
  const bh = h * size;
  const px = (v: number): string => `${v.toFixed(1)}px`;
  return `background-size:${px(size)} ${px(size)};background-position:${px(-x * size)} ${px(-y * size)};width:${px(bw)};height:${px(bh)};left:${px(CENTRE.x - bw / 2)};top:${px(CENTRE.y - bh / 2)}`;
}
const sentenceHtml = (segments: Segment[]): string => segments.map((s) => (s.strong ? `<b>${s.text}</b>` : s.text)).join("");
const fontFace = (family: string, weight: number, data: string): string =>
  `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url("data:font/woff2;base64,${data}") format("woff2")}`;

const GRAIN = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .6 0'/></filter><rect width='300' height='300' filter='url(%23n)'/></svg>")`;

export function cardHtml(card: CardData, assets: CardAssets): string {
  const accent = ACCENT[card.character];
  const levels = [
    ["calm", card.spectrum.calm, "calm"],
    ["warm", card.spectrum.warming, "warming"],
    ["heat", card.spectrum.heating, "heating"],
    ["fried", card.spectrum.fried, "fried"],
  ] as const;
  const bar = levels.filter(([, pct]) => pct > 0).map(([cls, pct]) => `<div class="${cls}" style="width:${pct}%"></div>`).join("");
  const legend = levels.map(([cls, pct, name]) => `<span><i class="${cls}"></i><b>${pct}%</b> ${name}</span>`).join("&nbsp;&nbsp;");
  const stats = card.highlights
    .map((h) => `<div class="stat" data-key="${h.key}"><div class="v">${h.value}</div><div class="c mono">${h.caption}</div></div>`)
    .join("");
  const label = card.days === 1 ? "Last 1 day" : `Last ${card.days} days`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>cogload card</title>
<style>
${fontFace("Inter", 400, assets.fonts.inter400)}
${fontFace("Inter", 700, assets.fonts.inter700)}
${fontFace("Inter", 800, assets.fonts.inter800)}
${fontFace("JetBrains Mono", 500, assets.fonts.mono500)}
:root{--ink:#f5f5f7;--muted:#a1a1aa;--dim:#6b6b76;--line:rgba(255,255,255,.10);--accent:${accent.main};--accent2:${accent.light};--accent-rgb:${accent.rgb};--calm:#7ee2a3;--warm:#fbd77a;--heat:#ff8700;--fried:#ff4d4d}
html{zoom:2}
html,body{margin:0;background:#000}
.card{position:relative;width:1200px;height:630px;overflow:hidden;font-family:Inter,-apple-system,system-ui,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;background:#07070a}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace}
.streaks{position:absolute;left:-200px;top:-260px;width:900px;height:1100px;transform:rotate(38deg);filter:blur(22px);opacity:.9}
.streaks div{position:absolute;top:0;height:100%;border-radius:40px}
.s1{left:120px;width:150px;background:linear-gradient(180deg,transparent 0%,rgba(var(--accent-rgb),.55) 35%,rgba(var(--accent-rgb),.9) 50%,rgba(var(--accent-rgb),.45) 70%,transparent 100%)}
.s2{left:320px;width:70px;background:linear-gradient(180deg,transparent 10%,rgba(255,255,255,.35) 45%,rgba(var(--accent-rgb),.7) 55%,transparent 90%)}
.s3{left:440px;width:200px;background:linear-gradient(180deg,transparent 0%,rgba(var(--accent-rgb),.35) 40%,rgba(34,211,238,.35) 58%,transparent 100%)}
.s4{left:700px;width:90px;background:linear-gradient(180deg,transparent 15%,rgba(var(--accent-rgb),.5) 50%,transparent 85%)}
.vignette{position:absolute;inset:0;background:radial-gradient(900px 600px at 30% 40%,transparent 30%,rgba(7,7,10,.85) 75%,#07070a 100%)}
.grain{position:absolute;inset:0;opacity:.35;mix-blend-mode:overlay;background-image:${GRAIN}}
.char{position:absolute;background-image:url("data:image/webp;base64,${assets.characters}");background-repeat:no-repeat;filter:drop-shadow(0 30px 40px rgba(0,0,0,.7))}
.panel{position:absolute;left:380px;top:56px;width:760px;height:518px;box-sizing:border-box;border-radius:20px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.02));box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 30px 80px rgba(0,0,0,.5);padding:36px 40px}
.row{display:flex;justify-content:space-between;align-items:center}
.label{font-size:13px;color:var(--dim);letter-spacing:.5px;text-transform:uppercase}
.peak{display:inline-flex;align-items:center;gap:10px;padding:6px 12px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.03);font-size:12px;color:var(--dim);letter-spacing:.5px;text-transform:uppercase;white-space:nowrap}
.peak b{font-weight:500}
.peak b.calm{color:var(--calm)}.peak b.warm{color:var(--warm)}.peak b.heat{color:var(--heat)}.peak b.fried{color:var(--fried)}
.name{margin-top:18px;font-size:76px;font-weight:700;line-height:1;letter-spacing:-3px;color:#fff;text-shadow:0 0 40px rgba(255,255,255,.18);white-space:nowrap}
.sentence{margin-top:22px;font-size:22px;line-height:31px;color:var(--muted);letter-spacing:-.2px;max-width:660px}
.sentence b{color:#fff;font-weight:600}
.divider{height:1px;background:var(--line);margin:30px 0 26px}
.bar{height:8px;border-radius:4px;overflow:hidden;display:flex;gap:2px}
.bar div{height:100%}
.bar .calm{background:var(--calm)}.bar .warm{background:var(--warm)}.bar .heat{background:var(--heat)}.bar .fried{background:var(--fried)}
.legend{margin-top:14px;font-size:12.5px;color:var(--dim);letter-spacing:.2px;white-space:nowrap}
.legend b{color:var(--muted);font-weight:500}
.legend i{display:inline-block;width:6px;height:6px;border-radius:50%;margin:0 7px 1px 0}
.legend i.calm{background:var(--calm)}.legend i.warm{background:var(--warm)}.legend i.heat{background:var(--heat)}.legend i.fried{background:var(--fried)}
.stats{display:flex;gap:16px;margin-top:30px}
.stat{flex:1;min-width:0;box-sizing:border-box;padding:18px 16px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.025);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.stat .v{font-size:38px;font-weight:700;letter-spacing:-1.6px;line-height:1;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
.stat .c{margin-top:8px;font-size:12px;color:var(--dim);letter-spacing:0;white-space:nowrap}
.repo{position:absolute;left:60px;top:566px;line-height:1;white-space:nowrap}
.repo small{display:block;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--dim);margin-bottom:8px}
.repo span{font-size:17px;font-weight:500;color:var(--accent2);letter-spacing:-.2px}
.source{position:absolute;right:60px;top:588px;font-size:12px;color:var(--muted);letter-spacing:.2px;white-space:nowrap}
</style></head><body>
<div class="card">
  <div class="streaks"><div class="s1"></div><div class="s2"></div><div class="s3"></div><div class="s4"></div></div>
  <div class="vignette"></div>
  <div class="grain"></div>
  <div class="char ${card.character}" style="${spriteStyle(card.character)}"></div>
  <div class="panel">
    <div class="row">
      <div class="label mono">${label}</div>
      <div class="peak mono">Peak hour <b class="${LEVEL_CLASS[card.peak.level]}">${card.peak.index} · ${card.peak.level}</b></div>
    </div>
    <div class="name">${card.name}</div>
    <div class="sentence">${sentenceHtml(card.sentence)} ${card.motto}</div>
    <div class="divider"></div>
    <div class="bar">${bar}</div>
    <div class="legend mono">${legend}</div>
    <div class="stats">${stats}</div>
  </div>
  <div class="repo mono"><small>Get yours</small><span>github.com/drakulavich/cogload</span></div>
  <div class="source mono">computed locally from your Claude Code transcripts · nothing leaves your machine</div>
</div>
</body></html>
`;
}
