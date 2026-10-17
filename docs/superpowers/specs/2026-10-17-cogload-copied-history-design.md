# Spec: a copied history counts once

Extends the "Events" table of `2026-09-17-zapara-design.md` and the cache
spec it points to; everything not mentioned here stays as they say. Tracks
[#222](https://github.com/drakulavich/cogload/issues/222).

## Objective

When Claude Code moves a session to the background, it writes a new
transcript under a new session id and copies the history into it. Every
copied `user` and `assistant` record carries `sessionKind: "bg"` and keeps
the original's `uuid` and `timestamp`, so cogload counts that history once
per file. Over the author's last 60 days (counts only, no text read) there
are two such pairs:

| Original | Copy | Records copied | Shape |
|---|---|---|---|
| 155 records | 1249 | all 155 | the original ends with a `continued-in` record naming the copy's session |
| 12667 records | 390 | 386, a 100-minute stretch | the original goes on; no marker |

`sessionKind: "bg"` is on the copy's own records too, so it does not say on
its own which records are copies. No original record carries it.

The issue's fixture (6 prompts in one file, the same file under a second
session id) scores 12 prompts, 11 context switches and a peak of 29 instead
of 6, 0 and 11.

After this change:

1. Each event the parser makes from a record with `sessionKind: "bg"`
   carries `bg: true`.
2. Before the events are derived, a `bg` event is dropped when an event
   without `bg` in another session has the same time and kind. A copied
   record keeps its time to the millisecond, so its events meet the
   original's; the original always stays, whatever the file order.
3. An event without `bg` is never dropped, so two ordinary sessions that
   share a timestamp both count, as today.
4. The cache stores the flag on `bg` events only. The parser fingerprint
   already covers `parse.ts` and `types.ts`, so rows written by 0.14.x miss
   and are parsed again; the table and `user_version` stay.

Cost, measured on the author's transcripts: the cache after a 90-day run
stays at 5.1 MB (11.7 MB with a `uuid` per event, the design this one
replaced). The filter indexes only `bg` events by time, so a one-day run
takes 110 ms as on main and a 60-day run 127 ms instead of 120.

Not in scope: copies Claude Code does not mark `bg` (none seen in 60 days),
and a copy whose original file is gone, which then counts once as the copy.
A `bg` record of the copy's own that meets another session's event of the
same kind at the same millisecond would be dropped; for a prompt that does
not happen, and for `activity` it costs one event of a session that has
others.

## Tech Stack

Bun 1.4.2+, TypeScript, `bun:sqlite`. No new dependencies.

## Commands

```
bun run check
bun run dev 2026-10-13 --json --projects <fixture>             # with and without --no-cache
ls -l ~/.claude/cogload/cache.db                                 # before and after one run
```

## Project Structure

```
src/lib/types.ts                  Event: bg?: true
src/lib/transcripts/parse.ts      events from a bg record carry the flag
src/lib/transcripts/cache.io.ts   encode/decode the flag
src/lib/metrics/analyze.ts        analyzeEvents drops copied events before derive
tests/helpers/transcript.ts       a builder that copies records under a new session id
tests/metrics/copied-history.test.ts  cases 1, 2, 4
tests/cli/cache-cli.test.ts       case 3
docs/how-the-numbers-are-made.md  one line on copied history
```

## Code Style

```ts
// A background session copies its history under a new session id (#222).
function dropCopies(events: Event[]): Event[] {
  const copies = new Map<number, Event[]>();
  for (const e of events) if (e.bg) copies.set(e.ts, [...(copies.get(e.ts) ?? []), e]);
  if (copies.size === 0) return events;
  const dropped = new Set<Event>();
  for (const e of events) {
    if (e.bg) continue;
    for (const c of copies.get(e.ts) ?? []) if (c.kind === e.kind && c.sessionId !== e.sessionId) dropped.add(c);
  }
  return events.filter((e) => !dropped.has(e));
}
```

## Testing Strategy

`bun test`, fixtures in the real transcript format, through `analyze()` or
the CLI.

1. A file with 6 prompts in one session and the same records copied under a
   second session id with `bg` → `prompts: 6`, `contextSwitches: 0`, one
   session, the same score as the first file alone.
2. Two ordinary sessions whose records share timestamps → both count.
3. Case 1 through the CLI, run twice on one cache and once with
   `--no-cache` → the outputs are equal and score 2 prompts for the
   fixture's 2.
4. A copy of a middle stretch, its file first in path order, plus a prompt
   of its own → the stretch counts once, as the original: one context
   switch, to the copy's own prompt.

## Boundaries

- Always: drop only `bg` events, and only against another session's event.
- Ask first: dropping events without `bg`, a cache schema change beyond the
  encoded blob.
- Never: keep or print message text, a path or a title.

## Definition of Done

- Cases 1, 3 and 4 fail on main 17fb714. Case 2 passes on main and fails
  when the drop ignores the `bg` flag.
- Case 3 fails when the cache drops the flag.
- `bun run check` passes.
- The #222 fixture, its copy marked `bg` as real copies are, gives through
  the CLI 6 prompts, 0 context switches and peak 11, cached and `--no-cache`.
- A copied record with no text (a `tool_result`) is marked too: the test
  fails when the parser skips the rest of a record without text.
- The PR body gives the totals over 60 days before and after (prompts,
  context switches) and the cache size before and after.
- `docs/how-the-numbers-are-made.md` says a copied history counts once.
- The PR body carries the CHANGELOG line.
