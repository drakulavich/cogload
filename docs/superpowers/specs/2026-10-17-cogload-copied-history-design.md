# Spec: a copied history counts once

Extends the "Events" table of `2026-09-17-zapara-design.md` and the cache
spec it points to; everything not mentioned here stays as they say. Tracks
[#222](https://github.com/drakulavich/cogload/issues/222).

## Objective

When Claude Code moves a session to the background, it writes a new
transcript under a new session id (`sessionKind: "bg"`) and copies the
history into it. The copied `user` and `assistant` records keep their `uuid`
and `timestamp`, so cogload counts that history once per file. Over the
author's last 60 days (counts only, no text read) there are two such pairs:

| Original | Copy | Records copied | Shape |
|---|---|---|---|
| 155 records | 1249 | all 155 | the original ends with a `continued-in` record naming the copy's session |
| 12667 records | 390 | 386, a 100-minute stretch | the original goes on; no marker |

Neither file says, per record, which records are copies: `sessionKind:
"bg"` is on the copy's own records too, and two of the copy's own records
are older than its first `queue-operation`. Only the `uuid` matches across
files.

The issue's fixture (6 prompts in one file, the same file under a second
session id) scores 12 prompts, 11 context switches and a peak of 29 instead
of 6, 0 and 11.

After this change:

1. Each event the parser makes from a `user` or `assistant` record carries
   that record's `uuid` when it has one. `mode_change` events carry none.
2. Before the events are derived, an event whose `uuid` an earlier event
   used under a different session id is dropped. "Earlier" is input order,
   which is path order in both `analyze()` and `report()`, so a cached run
   and a `--no-cache` run keep the same copy. The first session to use a
   `uuid` keeps every event with it, a repeat within that session included,
   as today; every other session's events with it are dropped.
3. The cache stores the `uuid` with each event. The parser fingerprint
   already covers `parse.ts` and `types.ts`, so rows written by 0.14.x miss
   and are parsed again; the table and `user_version` stay.
4. A record without a `uuid` is never dropped.

A `uuid` is not message text, a path or a title, so the Privacy rule does
not change; it is kept in the cache next to the session ids already there.

Cost: the cache grows by one `uuid` per record. It is 3.6 MB on the author's
machine now; the PR states the size after one run.

Not in scope: telling the original from the copy. Path order may keep the
copy, which is the same history under the other session id. Where the
original goes on (the second shape), the hours around the copied stretch can
then gain a context switch at each end that did not happen. Preferring the
original would need the `bg` flag in every event and the cache; that waits
for a case where the two switches matter.

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
src/lib/types.ts                  Event: uuid?: string
src/lib/transcripts/parse.ts      events from a record carry its uuid
src/lib/transcripts/cache.io.ts   encode/decode the uuid
src/lib/metrics/analyze.ts        analyzeEvents drops copied events before derive
tests/helpers/transcript.ts       a builder that copies a transcript under a new session id
tests/metrics/*.test.ts           cases 1, 2, 4
tests/cli/cache-cli.test.ts       case 3
docs/how-the-numbers-are-made.md  one line on copied history
```

## Code Style

```ts
// A background session copies its history under a new session id (#222).
function dropCopies(events: Event[]): Event[] {
  const owner = new Map<string, string>();
  return events.filter((e) => {
    if (e.uuid === undefined) return true;
    const sid = owner.get(e.uuid);
    if (sid === undefined) owner.set(e.uuid, e.sessionId);
    return sid === undefined || sid === e.sessionId;
  });
}
```

## Testing Strategy

`bun test`, fixtures in the real transcript format, through `analyze()` or
the CLI. Each case fails on main:

1. A file with 6 prompts in one session and the same records copied under a
   second session id in another file → `prompts: 6`, `contextSwitches: 0`,
   one session, the same index as the first file alone.
2. Two sessions whose records share timestamps but not `uuid`s → both count,
   as on main (this case passes on main and pins rule 2's key).
3. Case 1 through the CLI, run twice on one cache and once with
   `--no-cache` → the three JSON outputs are equal and score 6 prompts.
4. A copy of only part of a file (the second shape) → the copied stretch
   counts once; the original's records after it still count.

## Boundaries

- Always: dedupe on `uuid` and session id only; keep input order.
- Ask first: preferring the original over the copy, a cache schema change
  beyond the encoded blob.
- Never: keep or print message text, a path or a title.

## Definition of Done

- Cases 1, 3 and 4 fail on main 17fb714. Case 2 passes on main and fails
  when the drop keys on the timestamp instead of the `uuid`.
- `bun run check` passes.
- The #222 fixture through the CLI gives 6 prompts, 0 context switches and
  peak 11, cached and `--no-cache`.
- The PR body gives `bun run stats --days 60` before and after (prompts,
  contextSwitches, sessions) and the cache size before and after.
- `docs/how-the-numbers-are-made.md` says a copied history counts once.
- The PR body carries the CHANGELOG line.
