# Spec: messages from other sessions are reports again

Extends the "Events" table of `2026-09-17-zapara-design.md` and section 2 of
`docs/how-the-numbers-are-made.md`; everything not mentioned here stays as
they say. Tracks [#226](https://github.com/drakulavich/cogload/issues/226).

## Objective

A message from another Claude session is a `report`: the person reads it and
reacts, but did not type it. The parser recognises one by its text, which
starts with `<teammate-message`, `Another Claude session sent a message:`,
`<cross-session-message` or `[Cross-session`.

Claude Code 2.1.280 and later write it differently: `origin.kind: "peer"`,
`promptSource: "system"`, `isMeta: true`, and text with none of those
markers. `parse.ts` drops an `isMeta` record before it looks at
`promptSource`, so the message yields no event at all. Over the author's
transcripts (counts only, no text read):

| Shape | Versions | Records (30 days) | Parser gives |
|---|---|---|---|
| Tagged text, no `origin` | 2.1.274 to 2.1.292 | 218 on 2.1.274, 123 after, none after 2.1.292 | `report` |
| `origin.kind: "peer"`, `isMeta: true` | 2.1.274 to 2.1.299 | 608 | nothing |

Of 677 peer records over 60 days, 4 have a tagged record in the same session
within 5 seconds, so the two shapes are almost never the same message twice.
Among `isMeta` records, `promptSource: "system"` occurs only with
`origin.kind: "peer"`.

After this change a `user` record with `origin.kind: "peer"` is a `report`,
whether `isMeta` is set or not. An interrupt marker still wins. The other
`isMeta` records (system reminders, image notes, command caveats) stay
without an event.

Effect over the author's last 60 days, `cogload --days 60 --json --no-cache`
before and after the candidate change:

| | main | after |
|---|---|---|
| reports | 2505 | 3115 |
| prompts | 2512 | 2512 |
| mean index of a scored hour | 22.35 | 23.13 |
| calm / warming / heating / fried hours | 362 / 112 / 30 / 3 | 351 / 120 / 33 / 3 |

Not in scope: other `origin.kind` values (`task-notification` is already a
`report` by its marker, `plugin` by `promptSource`, `coordinator` by its
text), the one scheduled-task record a month that counts as a prompt,
re-tuning the supervision norm.

## Data and cost

No stored structure changes. Each new `report` is one more cache row of the
existing 3-item form `[ts,"report",i]`, about 27 bytes: 610 rows over 60
days, about 16 KB, against a 5.1 MB cache. `parse.ts` changes, so the
parser fingerprint changes and the first run after the release reparses
every file once, as after 0.14.1.

Two ways to write the rule, identical on today's data:

| Option | Rule | Today | Risk |
|---|---|---|---|
| A | `promptSource: "system"` is a report before `isMeta` is checked | 608 more | a future hidden `system` record becomes a report |
| B (chosen) | `origin.kind: "peer"` is a report before `isMeta` is checked | 608 more | a new name for peer messages is missed again, as now |

B is the narrower one: it names the shape that was measured.

## Tech Stack

Bun 1.4.2+, TypeScript, no new dependencies.

## Commands

```
bun run check
bun run dev --days 60 --json --no-cache   # before and after, totals only
```

## Project Structure

```
src/lib/transcripts/parse.ts           the peer rule
tests/helpers/transcript.ts            peer(): the 2.1.299 shape
tests/metrics/agents.test.ts           cases below
docs/how-the-numbers-are-made.md       `report` row
docs/superpowers/specs/2026-09-17-zapara-design.md   Events table points here
```

## Code Style

The prompt branch in `parse.ts` lets a peer record through the `isMeta`
check:

```ts
const peer = isObj(rec.origin) && rec.origin.kind === "peer";
else if (head !== null && (rec.isMeta !== true || peer) && ...) {
  if (peer || rec.promptSource === "system" || AGENT_MARKERS.some(...)) report
```

The builder copies the real record's fields with placeholder values:

```ts
export const peer = (ts: string, sid: string) =>
  userText(ts, sid, "placeholder report", { isMeta: true, promptSource: "system", turnOrigin: "peer",
    origin: { kind: "peer", from: "placeholder", name: "placeholder", body: "placeholder report", senderTaskId: "placeholder" } });
```

## Testing Strategy

`bun test`, through `analyze()` with fixtures in the real transcript format
(`CLAUDE.md`). Case 1 fails on main; case 2 pins that the rule stays narrow:

1. A prompt at 10:00, a `peer()` record at 10:05, a prompt at 10:10 →
   `reports: 1`, `prompts: 2`.
2. The same with `meta()` (a system reminder) in place of `peer()` →
   `reports: 0`.

The existing tests in `agents.test.ts` stay green unchanged, so the tagged
form stays a report.

## Boundaries

- Always: decide by fields and markers, then discard the text.
- Ask first: counting any other `isMeta` record, changing a norm.
- Never: keep, print or count the length of `origin.body` or the text.

## Definition of Done

- Case 1 passes and fails on main fb88736; case 2 passes and fails when the
  rule lets every `isMeta` record through.
- `bun run check` passes.
- The PR body gives the effect table above, measured again on the branch,
  and the user-facing CHANGELOG line.
- `docs/how-the-numbers-are-made.md` and the zapara design's Events table
  name the peer rule.

## Decisions

- A peer message is something the person reads, so it is a `report`, though
  its record is `isMeta`. Claude Code shows the receiving session a
  `Message from` row once Claude has read the message, expandable with
  `Ctrl+O`. Source: https://code.claude.com/docs/en/whats-new/2026-w32
