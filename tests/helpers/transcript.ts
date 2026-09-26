// Real-format Claude Code 2.1.274 transcript lines. Field names and shapes copied from
// ~/.claude/projects; text is a placeholder. Keep this the only place that knows the shape.
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Transcript } from "../../src/lib/types.ts";

let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
let reqCounter = 0;
// Exported so a fixture that builds assistantText() records itself can give each
// API response its own requestId, the way Claude Code does; the output-token sum
// dedupes per requestId, so a reused id would silently drop a reply's tokens.
export const nextRequestId = () => `req_placeholder_${++reqCounter}`;

const base = (ts: string, sid: string, extra: Record<string, unknown>) =>
  JSON.stringify({
    parentUuid: null, isSidechain: false, userType: "external", cwd: "/tmp/project",
    sessionId: sid, version: "2.1.274", gitBranch: "main", uuid: uuid(), timestamp: ts, ...extra,
  });

export const prompt = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", message: { role: "user", content: "placeholder prompt" } });

export const promptBlocks = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", message: { role: "user", content: [{ type: "text", text: "placeholder prompt" }] } });

// A pasted screenshot: Claude Code puts the image block first and the typed text
// after it, so a reader that inspects only content[0] finds no text at all.
const IMAGE = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } };

export const promptAfterImage = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", message: { role: "user", content: [IMAGE, { type: "text", text: "placeholder prompt" }] } });

export const interruptAfterImage = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", message: { role: "user", content: [IMAGE, { type: "text", text: "[Request interrupted by user]" }] } });

export const meta = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", isMeta: true, message: { role: "user", content: [{ type: "text", text: "<system-reminder>placeholder</system-reminder>" }] } });

export const assistant = (ts: string, sid: string) =>
  base(ts, sid, { type: "assistant", requestId: nextRequestId(), message: { id: "msg_placeholder", role: "assistant", model: "claude-fable-5-1", usage: { input_tokens: 2, output_tokens: 100 }, content: [{ type: "text", text: "placeholder reply" }] } });

// An assistant record carrying a text block and usage, for output-token tests. Real
// Claude Code repeats the same requestId and usage across every content-block record
// of one API response, so callers pass the same requestId to build that shape.
export const assistantText = (ts: string, sid: string, tokens: number, requestId: string) =>
  base(ts, sid, { type: "assistant", requestId, message: { id: "msg_placeholder", role: "assistant", model: "claude-fable-5-1", usage: { input_tokens: 2, output_tokens: tokens }, content: [{ type: "text", text: "placeholder reply" }] } });

// The same record with `usage.output_tokens` written as a raw JSON literal, for
// counts JSON.stringify cannot produce: `1e309` (Infinity once parsed), a
// negative count, a fraction. A corrupt or hand-edited transcript holds these.
const TOKEN_SLOT = "__output_tokens__";
export const assistantTokensLiteral = (ts: string, sid: string, literal: string, requestId: string) =>
  base(ts, sid, { type: "assistant", requestId, message: { id: "msg_placeholder", role: "assistant", model: "claude-fable-5-1", usage: { input_tokens: 2, output_tokens: TOKEN_SLOT }, content: [{ type: "text", text: "placeholder reply" }] } })
    .replace(`"output_tokens":"${TOKEN_SLOT}"`, `"output_tokens":${literal}`);

// An assistant record whose only content block is a tool call: not text the human
// reads, so it must never contribute output tokens even though usage is present.
export const assistantToolUseOnly = (ts: string, sid: string, tokens: number, requestId: string) =>
  base(ts, sid, { type: "assistant", requestId, message: { id: "msg_placeholder", role: "assistant", model: "claude-fable-5-1", usage: { input_tokens: 2, output_tokens: tokens }, content: [{ type: "tool_use", id: "toolu_placeholder", name: "SomeTool", input: {} }] } });

export const interrupt = (ts: string, sid: string, forTool = false) =>
  base(ts, sid, { type: "user", message: { role: "user", content: [{ type: "text", text: forTool ? "[Request interrupted by user for tool use]" : "[Request interrupted by user]" }] } });

export const reject = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_placeholder", is_error: true, content: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed." }] }, toolUseResult: "The user doesn't want to proceed with this tool use." });

// A tool_result of the size a real file read or grep output reaches. As the last
// record of a file it pushes that record's own `timestamp` field far from the
// end, where the tail rescue for an out-of-window mtime has to find it.
export const bigToolResult = (ts: string, sid: string, bytes: number) =>
  base(ts, sid, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_placeholder", is_error: false, content: "R".repeat(bytes) }] } });

// `id` pairs a result with the tool call it answers, the way Claude Code does.
// The default keeps the many tests that never look at the pairing unchanged.
export const toolResult = (ts: string, sid: string, id = "toolu_placeholder") =>
  base(ts, sid, { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: false, content: "ok" }] } });

export const toolUse = (ts: string, sid: string, name: string, id = "toolu_placeholder") =>
  base(ts, sid, { type: "assistant", requestId: "req_placeholder", message: { id: "msg_placeholder", role: "assistant", model: "claude-fable-5-1", content: [{ type: "tool_use", id, name, input: {} }] } });

export const question = (ts: string, sid: string, id?: string) => toolUse(ts, sid, "AskUserQuestion", id);
export const plan = (ts: string, sid: string, id?: string) => toolUse(ts, sid, "ExitPlanMode", id);

export const mode = (sid: string, m: string) => JSON.stringify({ type: "permission-mode", permissionMode: m, sessionId: sid });

// Inbound agent messages: subagent reports, other-session messages and task
// notifications. `bare` / `bracket` select the alternate real-world form seen
// where the content starts directly with the tag rather than the lead-in sentence.
export const teammate = (ts: string, sid: string, bare = false) =>
  base(ts, sid, { type: "user", message: { role: "user", content: bare
    ? `<teammate-message teammate_id="agent">placeholder report</teammate-message>`
    : `Another Claude session sent a message:\n<teammate-message teammate_id="agent">placeholder report</teammate-message>` } });

export const crossSession = (ts: string, sid: string, bracket = false) =>
  base(ts, sid, { type: "user", message: { role: "user", content: bracket
    ? `[Cross-session message from agent]: placeholder report`
    : `<cross-session-message from="agent">placeholder report</cross-session-message>` } });

export const taskNotification = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", message: { role: "user", content: `<task-notification>placeholder report</task-notification>` } });

export const sidechain = (ts: string, sid: string) =>
  base(ts, sid, { type: "user", isSidechain: true, agentId: "aa395d63485bb2c77", message: { role: "user", content: "placeholder subagent prompt" } });

// A `claude -p` or Agent SDK run: Claude Code stamps every record with the entrypoint.
export const sdk = (line: string, entrypoint = "sdk-cli") => {
  const r = JSON.parse(line);
  if (r.type === "user" && typeof r.message?.content === "string") Object.assign(r, { promptSource: "sdk", turnOrigin: "sdk" });
  return JSON.stringify({ ...r, entrypoint });
};

export const transcript = (lines: string[], path = "p/s.jsonl"): Transcript => ({ path, text: lines.join("\n") + "\n" });

export async function writeTree(root: string, files: { path: string; lines: string[]; mtime: string }[]): Promise<void> {
  for (const f of files) {
    const full = join(root, f.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.lines.join("\n") + "\n");
    const t = new Date(f.mtime);
    await utimes(full, t, t);
  }
}

// Some tool results carry a structured `toolUseResult` with a timestamp of its
// own, older than the record's. The record's time is the top-level `timestamp`.
export const withNestedTimestamp = (line: string, nestedTs: string) =>
  JSON.stringify({ ...JSON.parse(line), toolUseResult: { durationMs: 12, timestamp: nestedTs } });
