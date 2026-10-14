import { existsSync } from "node:fs";

// Claude Code writes plugin/tsconfig.json, not git; without it bun --check falls back to the root config (#219).
if (!existsSync("plugin/tsconfig.json")) {
  console.log("plugin: not type checked, Claude Code has not written its types here");
  process.exit(0);
}
const run = Bun.spawnSync(["bun", "--check"], { cwd: "plugin", stdout: "inherit", stderr: "inherit" });
process.exit(run.exitCode ?? 1);
