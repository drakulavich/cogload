#!/usr/bin/env bun
// Prints the SHA-256 of the busy-week card page, the value tests/card/card-html.test.ts
// pins as GOLDEN. Run it after any intentional change to the look or the assets and
// paste the hash; an unintentional change fails the test instead.
import { join } from "node:path";
import { cardData, cardHtml, loadAssets } from "../src/lib/card/index.ts";
import { report } from "../src/lib/report/index.ts";

const projects = join(import.meta.dir, "..", "tests", "fixtures", "busy-week", "projects");
const card = cardData(await report({ projects, to: "2026-09-20", days: 14 }), { days: 14 });
if (card === null) throw new Error("busy-week has no active hour");
console.log(new Bun.CryptoHasher("sha256").update(cardHtml(card, await loadAssets())).digest("hex"));
