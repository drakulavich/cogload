# Spec: records nobody typed are not prompts

Extends the "Events" table of `2026-09-17-zapara-design.md` and section 2 of
`docs/how-the-numbers-are-made.md`; everything not mentioned here stays as
they say. Tracks [#221](https://github.com/drakulavich/cogload/issues/221).

## Objective

cogload counts every non-meta `user` record as a `prompt`, and every prompt
as presence. Claude Code also writes `user` records that nobody typed. Over
the author's last 30 days (counts only, no text read):

| Kind | Shape | Records |
|---|---|---|
| Compact summary | `isCompactSummary: true` | 47 |
| Plugin message between turns (watchtower) | `promptSource: "system"`, text with no agent marker | 19 |
| Output of a `!` command | text starts with `<bash-stdout>` | 13 |
| Output of a local slash command | text starts with `<local-command-stdout>` | 13 |
| Monitor event | text starts with `<ci-monitor-event>` | 6 in #221's window, 0 now |

A fixture with one typed prompt at 10:00 and one record of each kind every 9
minutes scores `prompts: 6` and a 45-minute streak, past the 40 minutes that
start the plugin's rest, for someone who left at 10:00.

After this change the parser sorts these records like this:

1. **Compact summary** (`isCompactSummary: true`): no event but `activity`.
   Nobody typed it and nobody reads it; it is the session restarting itself.
2. **Plugin message** (`promptSource: "system"`): `report`. The person reads
   it and may react, the way they react to a `<task-notification>`, which
   already carries `promptSource: "system"` and stays a `report`.
3. **Monitor event** (`<ci-monitor-event>`): `report`, for the same reason.
4. **Command output** (`<bash-stdout>`, `<local-command-stdout>`): no
   event but
   `activity`. The command the person typed is its own record
   (`<bash-input>`, `<command-name>`) and stays a `prompt`; the output is its
   echo, and counting it as a report would charge supervision for the
   person's own command.

An interrupt marker still wins over all of these, as it wins over agent
markers today. Rules 1 and 2 look at fields, rules 3 and 4 at the start of
the text, the same comparison the agent markers use; the text is still never
kept.

Effects: `prompts`, `contextSwitches`, pace and the streak drop to what the
person typed; `reports` and supervision rise by the plugin messages and
monitor events. The plugin reads the streak through `cogload status`, so it
gets the fix with the npm release and needs no change of its own.

Not in scope: forked-session duplicates ([#222](https://github.com/drakulavich/cogload/issues/222)),
new event kinds, other `promptSource` values, output records starting
with a tag not seen in the counts above (such as a stderr tag), re-tuning a norm. If
`bun run stats` shows a norm moved, the PR states by how much and the norm
stays as it is.

## Tech Stack

Bun 1.4.2+, TypeScript, no new dependencies.

## Commands

```
bun run check
bun run stats --days 30          # before and after, numbers only
bun run dev 2026-10-13 --json    # the fixture from #221, by hand
```

## Project Structure

```
src/lib/transcripts/parse.ts           the four rules above
tests/helpers/transcript.ts            builders for the four shapes
tests/metrics/agents.test.ts           cases below
docs/how-the-numbers-are-made.md       `prompt` and `report` rows
docs/superpowers/specs/2026-09-17-zapara-design.md   Events table points here
```

## Code Style

The markers go next to the existing ones in `parse.ts`:

```ts
// Echoes of a command the human typed: the command itself is the prompt.
const OUTPUT_MARKERS = ["<bash-stdout>", "<local-command-stdout>"];
```

`<ci-monitor-event>` joins `AGENT_MARKERS`. The branch that today pushes
`prompt` first drops a compact summary and a command output, then pushes
`report` for `promptSource: "system"` or an agent marker.

## Testing Strategy

`bun test`, through `analyze()` or the CLI with fixtures in the real
transcript format (`CLAUDE.md`). Each case fails on main:

1. The #221 fixture (one typed prompt at 10:00, then a compact summary, a
   plugin message, a `!` output, a slash-command output and a monitor event
   9 minutes apart) → `prompts: 1`, `reports: 2`, streak 0 minutes, the
   live streak's last presence at 10:00.
2. A typed `!` command (`<bash-input>`) followed by its `<bash-stdout>` →
   one prompt, no report.
3. A typed slash command (`<command-name>`) followed by its
   `<local-command-stdout>` → one prompt, no report.
4. Prompts in session A, a plugin message in session B, prompts in A →
   `contextSwitches: 0`.
5. A record with `promptSource: "system"` whose text starts with the
   interrupt marker → `interrupt`, not `report`.

The existing tests in `agents.test.ts` stay green unchanged.

## Boundaries

- Always: compare against markers and fields, then discard the text.
- Ask first: a new event kind, changing a norm, treating command output as a
  report.
- Never: keep, print or count the length of any record's text.

## Definition of Done

- Cases 1 to 5 pass and each fails on main 4a97fda.
- `bun run check` passes.
- `bun run dev 2026-10-13 --json` on the #221 fixture prints `prompts: 1`.
- The PR body gives `bun run stats --days 30` before and after for pace and
  supervision (p50, p90) and the user-facing CHANGELOG line.
- `docs/how-the-numbers-are-made.md` and the zapara design's Events table
  name the four rules.

## Open Questions

- Command output: no event (this spec) or `report`? The spec picks no event,
  because the person typed the command and is reading their own result.
