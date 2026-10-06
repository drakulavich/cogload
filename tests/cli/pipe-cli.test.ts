import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const projects = join(import.meta.dir, "../fixtures/busy-week/projects");

// Through `| cat`: Bun.spawn's own stdout pipe reached the reader whole even before the fix.
test("a 90-day grid, many times a pipe's 64 KiB buffer, reaches the reader whole", async () => {
  const home = await mkdtemp(join(tmpdir(), "cogload-pipe-home-"));
  const p = Bun.spawn(["sh", "-c", 'bun "$0" --days 90 --to 2026-09-20 --projects "$1" | cat', CLI, projects], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "UTC", HOME: home } });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  expect(code).toBe(0);
  expect(out.length).toBeGreaterThan(65_536);
  expect(JSON.parse(out)).toHaveLength(90);
});

test("a reader that leaves early (`| head -1`) gets no stack trace, and cogload exits 0", async () => {
  const home = await mkdtemp(join(tmpdir(), "cogload-pipe-home-"));
  const err = join(home, "err");
  const code = join(home, "code");
  // dash has no pipefail, so cogload's own exit code is written to a file.
  const p = Bun.spawn(["sh", "-c", '{ bun "$0" --days 90 --to 2026-09-20 --projects "$1" 2>"$2"; echo $? >"$3"; } | head -1 >/dev/null', CLI, projects, err, code], { env: { ...process.env, TZ: "UTC", HOME: home } });
  await p.exited;
  expect(await Bun.file(err).text()).toBe("");
  expect((await Bun.file(code).text()).trim()).toBe("0");
});
