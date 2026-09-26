// tsc also checks the *.io.ts files that pure files reach through a feature's
// index.ts; those need Bun and Node types, so only errors in pure files count.
import { spawn } from "bun";

const tsc = spawn(["bunx", "tsc", "--noEmit", "-p", "tsconfig.pure.json"], { stdout: "pipe", stderr: "inherit" });
const out = await new Response(tsc.stdout).text();
const code = await tsc.exited;
const errors: string[] = [];
let keep = false;
for (const line of out.split("\n")) {
  const file = /^(\S+?)\(\d+,\d+\): error /.exec(line)?.[1];
  if (file !== undefined) keep = !file.endsWith(".io.ts");
  else if (/^error /.test(line)) keep = true;
  else if (!line.startsWith(" ")) keep = false;
  if (keep) errors.push(line);
}
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
if (code !== 0 && out.trim() === "") process.exit(code);
