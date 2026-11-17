# Spec: a prompt sent during a rest goes to the agent when it ends

Extends `2026-10-04-zapara-forced-rest-design.md`,
`2026-10-10-cognitive-load-held-prompts-back-design.md` and
`2026-10-29-cognitive-load-powerbank-design.md`. Everything not mentioned here
stays as they say. Tracks
[#245](https://github.com/drakulavich/cogload/issues/245).

## Objective

During a rest every prompt the person sends goes back into the box, and after
the rest they must come back and press Enter. A plan written down during the
rest waits for them, or costs a `skip:`.

After this change, Enter during a rest means "send it when the rest ends".
The person chooses at the start of the rest: write the agent a plan, press
Enter and go for tea, or write nothing and go for a walk. Work starts again
when the rest ends, and the agent does nothing during it, so there is nothing
on screen to come back and check.

1. During a rest, a held composer prompt is answered
   `Queued for 14:32. Water, then a window. 7 min left. It stays in the box, and goes as it reads then.`:
   the phrase and minutes as today. Claude Code puts the text back in the
   box, as today; the plugin leaves it there. The session marks itself
   queued (`queued`, a boolean in `$.state`).
2. The person may edit the text in the box until the rest ends, or delete it.
3. On the first minute callback (`$.clock.every(REFRESH_MS, …)`, already
   running) at which the session is queued and no rest is running, the
   plugin reads the box (`$.prompt.read()`) and clears `queued`. This runs
   in the callback itself, before `tick`, whose early returns would skip it.
   If the box holds text, the plugin awaits
   `$.prompt.submit({ text })` with that text exactly, then
   empties the box with `$.prompt.fill({ text: "", mode: "replace" })` from
   `$.clock.after(0, …)`, as the skip path fills it. An empty or blank box
   sends nothing: Claude Code refuses a blank prompt itself.
4. Text typed without Enter during the rest is not sent: the session is
   queued only by a held Enter.
5. A prompt the person sends after the rest ended goes through as typed and
   clears `queued`; the box is then empty, so the tick has nothing to send
   either way, and a new draft started after it is not sent.
6. A held prompt with attachments (`e.attachments`) does not queue and
   clears `queued`, since the box now holds it: the plugin's submission
   cannot carry them. It gets today's held text. An `@`
   mention is sent as typed: the plugin's submission does not expand it, and
   the agent reads the path with its own tools.
7. Any prompt with a skip line during the rest clears `queued`: one that
   lifts the rest, a short reason and an empty powerbank alike, so the tick
   never sends a skip line. Each answers as today. A Remote
   Control (`bridge`) prompt passes with its note as today and does not queue.
8. The toast that starts a rest gains ` Press Enter now to send when it ends.`:
   `Rest until 14:32. Streak 40m, Heating 68. Press Enter now to send when it ends.`

Not in scope: sending during the rest (dropped after the hand-off draft), a
queue that remembers text the box no longer shows, sending attachments, a queue marker in the band.

## Data and cost

No store key is added or changed. One boolean, `queued`, in the session's
`$.state`, in memory only, typed beside `held` in `PluginState`
(`plugin/types/index.d.ts`). The text to send lives in the box, where Claude
Code already keeps it, and the plugin reads it once, at the tick, to send it.
A held prompt is still added to `held` (#208), so a skip without text brings
it back into the box as today; `held` keeps text no longer than the privacy
line in `CLAUDE.md` already allows, which does not change.

Each session queues and sends from its own box, so sessions do not race.
Closing a session during the rest loses its box, as it does today.

A session started before the update holds prompts as today and sends nothing.

Risk: if the person is typing in the box at the minute the
tick fires, the half-typed text goes. The tick is up to a minute after the
rest's end, when the person has had the toast and the band's countdown;
accepted.

**What cogload sees.** A prompt sent during the rest is dropped, so it never
reaches the transcript. The tick's prompt is sent by the plugin after the
rest, without `asUser`, so it is recorded with `origin.kind: "plugin"` and
`promptSource: "system"`. cogload counts that shape as a `report` today
(`bun run stats` over the author's 30 days: `"plugin" "system" - plain →
report 15`), so it is no presence event and the rest's gap still ends the
streak. The model reads it framed as "The cognitive-load plugin sent a
message: …", which the author accepts.

## Tech Stack

Bun 1.4.2+, TypeScript, the Claude Code plugin engine. No new dependencies.

## Commands

```
bun run check
claude plugin test plugin
```

## Project Structure

```
plugin/hooks/register.ts      queued flag, queue text, send from the box in the minute callback, toast line
plugin/types/index.d.ts       `queued: boolean` in PluginState
plugin/tests/register.test.ts cases below
README.md                     the rest paragraph names Enter-to-queue
plugin/README.md              "The rest" names it
docs/reference.md             rest paragraph
```

## Code Style

```ts
const queued = atom({ plugin: "cognitive-load", key: "queued" } as const, false);

// in the clock.every(REFRESH_MS) callback, before tick($)
const sendQueued = async ($: EngineInterface) => {
  if (!(await read($, queued)) || (await restUntil($, await $.clock.now())) !== null) return;
  await update($, queued, () => false);
  const { text } = await $.prompt.read();
  await $.prompt.submit({ text });
  $.clock.after(0, () => void $.prompt.fill({ text: "", mode: "replace" }));
};
```

## Testing Strategy

`claude plugin test plugin`, through the registered hooks with the engine's
fake clock and store, as `register.test.ts` does today.

1. A rest running, a composer prompt → dropped with the `Queued for <until>.`
   text; no `prompt.fill` after `clock.advance(0)`. Fails on main.
2. A queued session, the box then edited to `plan B`, the clock past the
   rest's end and one tick → one plugin `prompt.submit` with `plan B`, then one `prompt.fill` with an empty draft; a second tick sends
   nothing. Fails on main.
3. A queued session whose box is empty at the tick → nothing sent. A queued
   session where the person sends `next` after the rest, then types `draft`
   → `next` passes as typed; the tick sends nothing.
4. Text in the box, no Enter during the rest → nothing sent at the tick.
5. A held prompt with an attachment → today's held text, the tick sends
   nothing.
6. `skip: prod is down now` in a queued session → lifts the rest and fills
   the box from `held` as today; the tick sends nothing. `skip: no` in a
   queued session, or a bridge prompt during a rest → the tick after the
   rest sends nothing. Their answers are pinned already.
7. A queued session whose `reading` is fresh (so `tick` returns early);
   another session lifts the rest with a skip → the next minute callback here
   sends the box, before the original end of the rest.
8. The rest's toast ends with ` Press Enter now to send when it ends.` Fails on
   main.

## Boundaries

- Always: send only what the box shows at the tick; keep no prompt text
  beyond `held`; skip and bridge rules first.
- Ask first: sending before the rest ends, a queue across sessions, a marker
  in the band.
- Never: send text the person did not queue with Enter; drop an attachment by sending
  without it.

## Definition of Done

- Cases 1 to 8 pass under `claude plugin test plugin`; cases 1, 2 and 8 fail
  on main, case 4 fails with the `queued` check removed.
- `bun run check` passes.
- README, `plugin/README.md` and `docs/reference.md` describe Enter during a
  rest, when the box is sent, and the boxes it leaves alone.

## Decisions

- Send at the rest's end, not during it (the author): an idle agent costs
  less than a reply on screen pulling the person back.
- Send the box, not a copy (the author): the text stays where the person can
  see and edit it, and the plugin keeps no copy beyond `held`.
- Only after an Enter during the rest (the author): an unfinished draft
  without Enter stays a draft.
- Sent on the existing minute tick rather than a timer per rest: up to a
  minute late, no timer to cancel when a skip lifts the rest.
- Without `asUser` (the author): the shape cogload already counts as a
  report, so no measurement is needed before the code.
- Mentions are sent as typed (the author): the agent can read the path.
- `$.prompt.read()` is in the engine API (Claude Code 2.1.326 types): it
  returns `{ text, cursor }`, `{ text: "", cursor: 0 }` where no box is drawn,
  and is the `prompt.read` event, so tests answer it with `on("prompt.read")`.
