// The only module that writes the status file.
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

const FAILED = "cannot write the status file";

// Atomic: a temporary file in the same directory, then a rename over the
// target, so a reader never sees a partial line and a symlink at the target is
// replaced, not written through. HOME comes from `env`, not os.homedir(), so an
// empty HOME is an error rather than a silent fallback.
export async function writeStatus(line: string, env: NodeJS.ProcessEnv): Promise<void> {
  const home = env.HOME;
  if (!home) throw new Error(FAILED);
  // The umask narrows the modes below; set it first so `mkdir` and `open` come
  // out 0700 and 0600 on the first try, with no window where a second run finds
  // a parent it cannot enter. Nothing else is written from here on.
  process.umask(0o077);
  const dir = join(home, ".claude", "zapara");
  // Unique per run: concurrent runs each rename their own complete file. Opened
  // with `wx` so a file or symlink already at the name is an error, and never
  // reused or deleted if not ours: a crashed run's leftover and a slow run's
  // file in flight look the same from outside.
  const tmp = join(dir, `status.json.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`);
  let created = false;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // `mkdir` leaves an existing directory as it was; tighten it.
    await chmod(dir, 0o700);
    const handle = await open(tmp, "wx", 0o600);
    created = true;
    try { await handle.writeFile(line); } finally { await handle.close(); }
    await chmod(tmp, 0o600);
    await rename(tmp, join(dir, "status.json"));
  } catch {
    if (created) await unlink(tmp).catch(() => {});
    throw new Error(FAILED);
  }
}
