#!/usr/bin/env bun
// Turns the owner's character sheet (a square PNG with a transparent background:
// Conductor top left, Supervisor top right, Marathoner bottom left, Night Owl
// bottom right) into assets/characters.webp: 1024x1024, lossy WebP at quality 85,
// alpha kept. A new sheet means re-measuring CHARACTER_RECTS in src/lib/card/cardhtml.ts.
// Usage: bun scripts/prepare-characters.ts <sheet.png>
import { resolve } from "node:path";

const src = process.argv[2];
if (src === undefined) {
  console.error("usage: bun scripts/prepare-characters.ts <sheet.png>");
  process.exit(2);
}
const out = resolve(import.meta.dir, "..", "assets", "characters.webp");
const bytes = await new Bun.Image(await Bun.file(resolve(src)).bytes())
  .resize(1024, 1024, { fit: "fill" })
  .webp({ quality: 85 })
  .bytes();
await Bun.write(out, bytes);
console.log(`wrote characters.webp: ${bytes.length} bytes`);
