import { expect, test } from "bun:test";
import { join } from "node:path";

// What `npm publish` would ship, from npm's own dry run of this checkout.
const pack = Bun.spawn(["npm", "pack", "--dry-run", "--json"], { cwd: join(import.meta.dir, "../.."), stderr: "ignore" });
const packed = await new Response(pack.stdout).text();
if ((await pack.exited) !== 0) throw new Error("npm pack failed");
const [{ files, unpackedSize }] = JSON.parse(packed) as [{ files: { path: string }[]; unpackedSize: number }];
const paths = files.map((f) => f.path);

test("the source, the card's fonts and sheet, and the licences ship in the tarball", () => {
  expect(paths).toEqual(
    expect.arrayContaining([
      "src/cli/index.ts",
      "src/lib/card/card.ts",
      "src/lib/card/cardhtml.ts",
      "src/lib/card/image.io.ts",
      "assets/characters.webp",
      "assets/fonts/inter-400.woff2",
      "assets/fonts/inter-700.woff2",
      "assets/fonts/inter-800.woff2",
      "assets/fonts/jetbrains-mono-500.woff2",
      "assets/fonts/LICENSE-inter.txt",
      "assets/fonts/LICENSE-jetbrains-mono.txt",
      "README.md",
      "LICENSE",
      "CHANGELOG.md",
      "package.json",
    ]),
  );
});

test("the bin ships", async () => {
  expect(paths).toContain(JSON.parse(await Bun.file(join(import.meta.dir, "../../package.json")).text()).bin.cogload);
});

test("tests, docs, scripts, CI and media do not", () => {
  const leaked = paths.filter((p) => /^(tests|docs|scripts|\.github)\//.test(p) || p.endsWith(".test.ts"));
  expect(leaked).toEqual([]);
  expect(paths).not.toContain("assets/demo.mp4");
  expect(paths).not.toContain("assets/demo.webp");
  expect(paths).not.toContain("assets/card.png");
  expect(paths).not.toContain("bun.lock");
});

test("the tarball stays under 1 MB unpacked", () => {
  expect(unpackedSize).toBeLessThan(1024 * 1024);
});
