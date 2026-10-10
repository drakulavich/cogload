import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prompt, writeTree } from "../helpers/transcript.ts";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");
const A = "aaaaaaaa-1111-4111-8111-111111111111";
let root: string;
let home: string;

// A prompt every 10 minutes across the night Berlin's clocks go back (#148):
// local hour 2 happens twice, 00:00Z to 02:00Z.
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cogload-dst-"));
  home = await mkdtemp(join(tmpdir(), "cogload-dst-home-"));
  const start = Date.parse("2025-10-25T23:30:00.000Z");
  const at = (i: number) => new Date(start + i * 600_000).toISOString();
  await writeTree(root, [{ path: "-Users-me-proj/a.jsonl", lines: Array.from({ length: 19 }, (_, i) => prompt(at(i), A)), mtime: at(18) }]);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("the night the clocks go back", () => {
  test("the repeated hour keeps its counts and scores its pace per real hour", async () => {
    const p = Bun.spawn(["bun", CLI, "--projects", root, "2025-10-26", "--json"], { stdout: "pipe", stderr: "pipe", env: { ...process.env, TZ: "Europe/Berlin", NO_COLOR: "1", HOME: home } });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect([code, err]).toEqual([0, ""]);
    const d = JSON.parse(out);
    expect(d.totals.prompts).toBe(19);
    expect(d.buckets[2].prompts).toBe(12);
    expect(d.buckets[2].activeMin).toBe(120);
    // 12 prompts in two real hours: pace 15*(6/20) = 4.5, not 15*(12/20) = 9.
    expect(d.buckets[2].score.parts.pace).toBe(4.5);
    expect(d.buckets[3].score.parts.pace).toBe(3);
  });
});
