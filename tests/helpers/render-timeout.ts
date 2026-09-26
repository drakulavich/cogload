import { join } from "node:path";
import { cardData, cardHtml, loadAssets, renderCard } from "../../src/lib/card/index.ts";
import { report } from "../../src/lib/report/index.ts";

const days = await report({ projects: join(import.meta.dir, "../fixtures/busy-week/projects"), to: "2026-09-20", days: 14 });
try {
  await renderCard(cardHtml(cardData(days, { days: 14 })!, await loadAssets()), process.argv[2]!, 1);
} catch (e) {
  console.log(e instanceof Error ? e.message : String(e));
}
