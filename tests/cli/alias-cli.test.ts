import { expect, test } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../src/cli");
const NOTICE = "zapara is now cogload; the zapara command goes away in 1.0.0\n";

async function run(entry: string): Promise<{ out: string; err: string }> {
  const p = Bun.spawn(["bun", entry, "--version"], { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  return { out, err };
}

test("cogload prints nothing on stderr", async () => {
  expect((await run(join(CLI, "index.ts"))).err).toBe("");
});

test("zapara prints what cogload prints, and the notice on stderr", async () => {
  const cogload = await run(join(CLI, "index.ts"));
  const zapara = await run(join(CLI, "zapara.ts"));
  expect(zapara.out).toBe(cogload.out);
  expect(zapara.err).toBe(NOTICE);
});

test("zapara through a symlink, as a global install lays it out, prints the notice", async () => {
  const link = join(mkdtempSync(join(tmpdir(), "cogload-alias-")), "zapara");
  symlinkSync(join(CLI, "zapara.ts"), link);
  expect((await run(link)).err).toBe(NOTICE);
});
