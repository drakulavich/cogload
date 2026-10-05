import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Probes once whether this machine can open a Bun.WebView (WebKit on macOS, an
// installed Chrome elsewhere). Tests that render skip when it cannot, unless
// COGLOAD_REQUIRE_WEBVIEW is set, as CI sets it, where a missing engine is a
// failure: raster coverage must never disappear silently.
//
// The per-test budget of every WebView-backed test, in milliseconds: 30 s, or
// COGLOAD_WEBVIEW_TIMEOUT_MS when set, so a slow machine or a loaded runner
// raises it once instead of editing every test. This is the one place the number lives.
// An in-process test runs at most two WebView steps back to back (a render, then
// a page that reads it), each bounded by WEBVIEW_STEP_TIMEOUT, so the last third
// is headroom and a step's own message is what a failure reports, never the test's
// timer. A CLI test renders once, under the CLI's own 15 s, inside the whole budget.
export const WEBVIEW_TEST_TIMEOUT = Number(process.env.COGLOAD_WEBVIEW_TIMEOUT_MS) || 30_000;
export const WEBVIEW_STEP_TIMEOUT = WEBVIEW_TEST_TIMEOUT / 3;
const BACKEND = process.platform === "darwin" ? "webkit" : "chrome";
const READY = 'document.fonts.ready.then(() => document.fonts.status === "loaded" && Array.from(document.images).every((i) => i.complete))';

export const webviewMissing: string | null = await (async () => {
  try {
    const view = new Bun.WebView({ width: 8, height: 8, backend: BACKEND });
    try { await view.navigate("data:text/html,<p>probe</p>"); } finally { view.close(); }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
})();

if (webviewMissing !== null && process.env.COGLOAD_REQUIRE_WEBVIEW) {
  throw new Error(`COGLOAD_REQUIRE_WEBVIEW is set but no WebView can be opened: ${webviewMissing}`);
}

// A view with the page loaded and its fonts ready. The caller closes it. The page
// loads from a file, as renderCard's does, and the readiness deadline is one step.
export async function openPage(html: string, width: number, height: number): Promise<Bun.WebView> {
  const dir = await mkdtemp(join(tmpdir(), "cogload-page-"));
  const page = join(dir, "page.html");
  await writeFile(page, html, { mode: 0o600 });
  const view = new Bun.WebView({ width, height, backend: BACKEND });
  const ready = (async () => {
    await view.navigate(pathToFileURL(page).href);
    while (!(await view.evaluate<boolean>(READY))) await Bun.sleep(50);
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`page never became ready in ${WEBVIEW_STEP_TIMEOUT} ms: navigate, fonts or images did not settle`)), WEBVIEW_STEP_TIMEOUT);
  });
  // Once the deadline wins, `ready` keeps running against a closed view and may
  // reject on its own; that rejection is expected and must not go unhandled.
  ready.catch(() => {});
  try { await Promise.race([ready, late]); return view; }
  catch (e) { view.close(); throw e; }
  finally { clearTimeout(timer); await rm(dir, { recursive: true, force: true }); }
}
