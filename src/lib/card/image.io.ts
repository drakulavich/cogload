// The only module that reads the card assets, opens a Bun.WebView or Bun.Image,
// writes the card, and starts another program: the opener that shows it.
import { rmSync } from "node:fs";
import { mkdtemp, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CardAssets } from "./cardhtml.ts";

const ASSETS = new URL("../../../assets/", import.meta.url);
const FILES = ["fonts/inter-400.woff2", "fonts/inter-700.woff2", "fonts/inter-800.woff2", "fonts/jetbrains-mono-500.woff2", "characters.webp"] as const;

// A missing or empty asset is a broken install, reported without a path.
export async function loadAssets(): Promise<CardAssets> {
  let parts: string[];
  try {
    parts = await Promise.all(FILES.map(async (name) => (await readFile(new URL(name, ASSETS))).toString("base64")));
  } catch {
    throw new Error("assets missing: reinstall cogload");
  }
  const [inter400, inter700, inter800, mono500, characters] = parts;
  if (parts.some((p) => p.length === 0)) throw new Error("assets missing: reinstall cogload");
  return { fonts: { inter400: inter400!, inter700: inter700!, inter800: inter800!, mono500: mono500! }, characters: characters! };
}

const BACKEND = process.platform === "darwin" ? "webkit" : "chrome";
const ENGINE_LINE = "card needs a browser engine: install a Chromium browser such as Chrome or Edge, or write --out card.html";
// Thrown for a card that cannot be written, so the caller can name the place it
// chose; the message is the line for an --out the person gave.
export class CardWriteError extends Error {
  constructor() { super("cannot write the card: check the --out directory"); }
}
const TEMP_LINE = "cannot draw the card: the temporary directory is not writable";
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const WIDTH = 2400;
const HEIGHT = 1260;
const READY = 'document.fonts.ready.then(() => document.fonts.status === "loaded" && Array.from(document.images).every((i) => i.complete))';

// The budget bounds the whole render, and the view closes the moment it runs
// out. The page loads from a file because a data: URL this size sometimes
// never finishes loading while other WebKit views are open. An engine failure
// becomes one line that never quotes the engine's text.
export async function renderCard(html: string, out: string, timeoutMs = 15_000): Promise<void> {
  const lower = out.toLowerCase();
  if (lower.endsWith(".html")) {
    await write(out, html);
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "cogload-card-")).catch(() => { throw new Error(TEMP_LINE); });
  // Ctrl-C (or a hangup, or kill) mid-render would skip the finally below and
  // leave the page behind: remove it, then end as the signal would have.
  const onSignal = (signal: NodeJS.Signals): void => {
    rmSync(dir, { recursive: true, force: true });
    process.exit(128 + ({ SIGHUP: 1, SIGINT: 2, SIGTERM: 15 } as Record<string, number>)[signal]!);
  };
  for (const s of SIGNALS) process.once(s, onSignal);
  let bytes: Uint8Array | null;
  try {
    const page = join(dir, "card.html");
    await writeFile(page, html, { mode: 0o600 }).catch(() => { throw new Error(TEMP_LINE); });
    bytes = await shoot(pathToFileURL(page).href, lower.endsWith(".webp"), timeoutMs).catch(() => { throw new Error(ENGINE_LINE); });
  } finally {
    // The handlers stay until the page is gone: a signal during this rm still cleans up.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    for (const s of SIGNALS) process.off(s, onSignal);
  }
  if (bytes === null) throw new Error("render timed out");
  await write(out, bytes);
}

// The picture, or null when the view did not finish within `ms`.
async function shoot(url: string, webp: boolean, ms: number): Promise<Uint8Array | null> {
  const view = new Bun.WebView({ width: WIDTH, height: HEIGHT, backend: BACKEND });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = (async () => {
    // WebKit draws at the screen's density: at 2x, a 2400-wide viewport made a
    // 4800-wide shot, 2.2 s of a 3 s render. The viewport and the page's zoom
    // (2 in cardHtml) shrink by the density, so the shot is 2400 wide already.
    // Headless Chrome (or Edge) shoots at 1x and cannot evaluate before a navigate.
    const dpr = BACKEND === "webkit" ? await view.evaluate<number>("devicePixelRatio") : 1;
    if (dpr !== 1) await view.resize(Math.round(WIDTH / dpr), Math.round(HEIGHT / dpr));
    await view.navigate(url);
    await view.evaluate(`document.documentElement.style.zoom = "${2 / dpr}"`);
    while (!(await view.evaluate<boolean>(READY))) await Bun.sleep(50);
    const shot = await view.screenshot({ encoding: "buffer", format: "png" });
    const image = new Bun.Image(shot);
    const meta = await image.metadata();
    const sized = meta.width === WIDTH && meta.height === HEIGHT;
    if (sized && !webp) return shot;
    if (!sized) image.resize(WIDTH, HEIGHT, { fit: "fill" });
    return webp ? await image.webp({ quality: 90 }).bytes() : await image.png().bytes();
  })();
  // After the deadline closes the view, the calls still pending on it may reject.
  work.catch(() => {});
  try {
    return await Promise.race([work, new Promise<null>((done) => { timer = setTimeout(() => done(null), ms); })]);
  } finally {
    clearTimeout(timer);
    view.close();
  }
}

// The status file's way: a temporary file created exclusively next to the
// target, then a rename over it, so a symlink at the target (an unpacked
// archive can leave one in Downloads) is replaced, never written through. The
// mode is the umask's, as for any file the person makes. One line for every
// failure: node's error quotes the path, and the CLI never prints one.
async function write(out: string, data: string | Uint8Array): Promise<void> {
  const tmp = join(dirname(out), `.${basename(out)}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
  let created = false;
  try {
    const handle = await open(tmp, "wx");
    created = true;
    try { await handle.writeFile(data); } finally { await handle.close(); }
    await rename(tmp, out);
  } catch {
    if (created) await unlink(tmp).catch(() => {});
    throw new CardWriteError();
  }
}

// Absolute, so `-card.html` is never an option.
export function openCard(path: string): void {
  startInBackground([process.platform === "darwin" ? "open" : "xdg-open", resolve(path)]);
}

// The only place src/ starts another program; lint/no-bun-spawn.grit bans Bun.spawn
// elsewhere. `sh … &` with SIGHUP ignored: a detached Bun.spawn child, or one in a
// terminal cogload leads, dies with cogload. A program that fails to start is ignored.
function startInBackground(command: string[]): void {
  try {
    Bun.spawnSync(["sh", "-c", 'trap "" HUP; "$0" "$@" </dev/null >/dev/null 2>&1 &', ...command], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  } catch {}
}
