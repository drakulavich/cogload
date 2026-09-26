import { join } from "node:path";
import { cardData } from "../../src/card.ts";
import { cardHtml } from "../../src/cardhtml.ts";
import { loadAssets, renderCard } from "../../src/image.ts";
import { report } from "../../src/report.ts";

const days = await report({ projects: join(import.meta.dir, "../fixtures/busy-week/projects"), to: "2026-09-20", days: 14 });
try {
  await renderCard(cardHtml(cardData(days, { days: 14 })!, await loadAssets()), process.argv[2]!, 1);
} catch (e) {
  console.log(e instanceof Error ? e.message : String(e));
}
