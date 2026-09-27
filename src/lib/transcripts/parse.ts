import type { Event } from "../types.ts";

// Markers compared against message text. The text itself is never kept.
const INTERRUPT_PREFIX = "[Request interrupted by user";
const REJECT_PREFIX = "The user doesn't want to proceed with this tool use";
const QUESTION_TOOL = "AskUserQuestion";
const PLAN_TOOL = "ExitPlanMode";
// Inbound agent messages: read and reacted to, but not typed, so `report`, never
// `prompt`. An interrupt marker is checked first and wins.
const AGENT_MARKERS = [
  "Another Claude session sent a message:",
  "<teammate-message",
  "<cross-session-message",
  "<task-notification>",
  "[Cross-session",
];

type Rec = Record<string, unknown>;
const isObj = (v: unknown): v is Rec => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

// A pasted screenshot puts an `image` block before the typed text, so the text
// block is searched for, not taken from content[0].
const firstText = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const b of content) if (isObj(b) && b.type === "text") return str(b.text);
  return null;
};

// A record older than the look-back yields only events derive() drops, so it is
// not parsed at all. Every "timestamp" in the line must be old, since a nested
// one can differ from the record's own. The skip waits for a first timestamped
// record, which the mode switches before it attach to; lines naming the two
// tools whose result the human writes are always parsed, for their ids.
// One pass over the line: it costs a fifth of JSON.parse.
const SKIP_SCAN = new RegExp(`"timestamp":"([^"]{20,40})"|${QUESTION_TOOL}|${PLAN_TOOL}`, "g");
function olderThan(line: string, cutoffMs: number): boolean {
  // Parsing an assistant record can update seenRequestIds even when its events
  // are outside the window. Preserve that deduplication state across the skip.
  if (line.includes('"requestId"')) return false;
  let any = false;
  for (const m of line.matchAll(SKIP_SCAN)) {
    if (m[1] === undefined || !(Date.parse(m[1]) < cutoffMs)) return false;
    any = true;
  }
  return any;
}

export function parseTranscript(text: string, cutoffMs = -Infinity): Event[] {
  const events: Event[] = [];
  let lastTs: number | null = null;
  let lastMode: string | null = null;
  let pendingModeChanges = 0;
  // Claude Code writes one record per content block of a response, repeating
  // the requestId and usage; only the first qualifying record counts.
  const seenRequestIds = new Set<string>();
  // Ids of the two tools whose result the human writes; every other
  // `tool_result` is the machine reporting back.
  const askedIds = new Set<string>();

  // Claude Code writes no byte order mark, but an editor can; left in, it would
  // make the first record invalid JSON.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    if (lastTs !== null && lastTs < cutoffMs && olderThan(line, cutoffMs)) continue;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!isObj(rec)) continue;
    const type = str(rec.type);
    const sessionId = str(rec.sessionId);
    if (type === null || sessionId === null) continue;
    if (rec.isSidechain === true) continue;
    if (str(rec.entrypoint)?.startsWith("sdk-")) continue; // a script ran `claude -p` or the Agent SDK

    if (type === "permission-mode") {
      const m = str(rec.permissionMode);
      if (m === null) continue;
      // A switch before the first timestamped record is how a session often
      // starts; it waits and is attributed to that record.
      if (lastMode !== null && m !== lastMode) {
        if (lastTs === null) pendingModeChanges++;
        else events.push({ ts: lastTs, sessionId, kind: "mode_change" });
      }
      lastMode = m;
      continue;
    }

    if (type !== "user" && type !== "assistant") continue;
    const ts = Date.parse(str(rec.timestamp) ?? "");
    if (Number.isNaN(ts)) continue;
    lastTs = ts;
    events.push({ ts, sessionId, kind: "activity" });
    for (; pendingModeChanges > 0; pendingModeChanges--) events.push({ ts, sessionId, kind: "mode_change" });

    const content = isObj(rec.message) ? rec.message.content : undefined;
    if (type === "user") {
      const blocks = Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (!isObj(b) || b.type !== "tool_result") continue;
        const t = firstText(b.content);
        if (t !== null && t.startsWith(REJECT_PREFIX)) events.push({ ts, sessionId, kind: "reject" });
        const toolUseId = str(b.tool_use_id);
        if (toolUseId !== null && askedIds.has(toolUseId)) events.push({ ts, sessionId, kind: "answer" });
      }
      const head = firstText(content);
      if (head === null) continue;
      if (head.startsWith(INTERRUPT_PREFIX)) events.push({ ts, sessionId, kind: "interrupt" });
      else if (rec.isMeta !== true) {
        if (AGENT_MARKERS.some((marker) => head.startsWith(marker))) events.push({ ts, sessionId, kind: "report" });
        else events.push({ ts, sessionId, kind: "prompt" });
      }
    } else {
      const blocks = Array.isArray(content) ? content : [];
      for (const b of blocks) {
        if (!isObj(b) || b.type !== "tool_use") continue;
        if (b.name !== QUESTION_TOOL && b.name !== PLAN_TOOL) continue;
        events.push({ ts, sessionId, kind: b.name === QUESTION_TOOL ? "question" : "plan_review" });
        const id = str(b.id);
        if (id !== null) askedIds.add(id);
      }
      // A response of only tool_use blocks is not text the human reads and carries
      // no output tokens. A count must be a finite non-negative integer: `1e309`
      // parses to Infinity, and a day once summed to NaN.
      const requestId = str(rec.requestId);
      const usage = isObj(rec.message) ? rec.message.usage : undefined;
      const outputTokens = isObj(usage) ? usage.output_tokens : undefined;
      const tokens = typeof outputTokens === "number" && Number.isSafeInteger(outputTokens) && outputTokens >= 0 ? outputTokens : null;
      const hasText = blocks.some((b) => isObj(b) && b.type === "text");
      if (requestId !== null && tokens !== null && hasText && !seenRequestIds.has(requestId)) {
        seenRequestIds.add(requestId);
        events.push({ ts, sessionId, kind: "output", tokens });
      }
    }
  }
  return events;
}
