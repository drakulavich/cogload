// Probes once whether this machine can open a Bun.WebView (WebKit on macOS, an
// installed Chrome elsewhere). Tests that render skip when it cannot, unless
// ZAPARA_REQUIRE_WEBVIEW is set, as CI sets it, where a missing engine is a
// failure: raster coverage must never disappear silently.
//
// The per-test budget of every WebView-backed test, in milliseconds: 30 s, or
// ZAPARA_WEBVIEW_TIMEOUT_MS when set, so a slow machine or a loaded runner
// raises it once instead of editing every test. This is the one place the number lives.
// An in-process test runs at most two WebView steps back to back (a render, then
// a page that reads it), each bounded by WEBVIEW_STEP_TIMEOUT, so the last third
// is headroom and a step's own message is what a failure reports, never the test's
// timer. A CLI test renders once, under the CLI's own 15 s, inside the whole budget.
export const WEBVIEW_TEST_TIMEOUT = Number(process.env.ZAPARA_WEBVIEW_TIMEOUT_MS) || 30_000;
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

if (webviewMissing !== null && process.env.ZAPARA_REQUIRE_WEBVIEW) {
  throw new Error(`ZAPARA_REQUIRE_WEBVIEW is set but no WebView can be opened: ${webviewMissing}`);
}

// A view with the page loaded and its fonts ready. The caller closes it. Like
// renderCard, it gives a view that stops answering under load (navigate() or
// evaluate() never settles) half the step and then tries a fresh one.
export async function openPage(html: string, width: number, height: number): Promise<Bun.WebView> {
  const half = WEBVIEW_STEP_TIMEOUT / 2;
  const view = (await attempt(html, width, height, half)) ?? (await attempt(html, width, height, half));
  if (view === null) throw new Error(`page never became ready on two views in ${half} ms each: navigate, fonts or images did not settle`);
  return view;
}

async function attempt(html: string, width: number, height: number, ms: number): Promise<Bun.WebView | null> {
  const view = new Bun.WebView({ width, height, backend: BACKEND });
  const ready = (async () => {
    await view.navigate("data:text/html;charset=utf-8," + encodeURIComponent(html));
    while (!(await view.evaluate<boolean>(READY))) await Bun.sleep(50);
    return true;
  })();
  // Once the deadline wins, `ready` keeps running against a closed view and may
  // reject on its own; that rejection is expected and must not go unhandled.
  ready.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (await Promise.race([ready, new Promise<false>((done) => { timer = setTimeout(() => done(false), ms); })])) return view;
  } catch (e) {
    view.close();
    throw e;
  } finally {
    clearTimeout(timer);
  }
  view.close();
  return null;
}
