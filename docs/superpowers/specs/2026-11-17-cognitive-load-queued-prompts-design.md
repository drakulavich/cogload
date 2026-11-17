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
3. On the first minute tick (`REFRESH_MS`, already running) at which the
   session is queued and no rest is running, the plugin reads the box
   (`$.prompt.read()`) and clears `queued`. If the box holds text, the plugin
   sends that text exactly (`$.prompt.submit({ text, asUser: true })`) and
   then empties the box (`$.prompt.fill({ text: "", mode: "replace" })`).
   An empty box sends nothing.
4. Text typed without Enter during the rest is not sent: the session is
   queued only by a held Enter.
5. A prompt the person sends after the rest ended but before that tick goes
   through as typed, and clears `queued`: what it carries is the box, which is
   what the tick would have sent.
6. A box whose text has an `@` mention (a word starting with `@`) is not sent
   at the tick: the plugin's own submission does not expand it. It stays in
   the box. The same holds when the held prompt carried attachments
   (`e.attachments`): `queued` is not set and the answer is today's held
   text.
7. A skip during the rest works as today and clears `queued`. A Remote
   Control (`bridge`) prompt passes with its note as today and does not queue.
8. The toast that starts a rest gains ` Press Enter now to send at 14:32.`:
   `Rest until 14:32. Streak 40m, Heating 68. Press Enter now to send at 14:32.`

Not in scope: sending during the rest (dropped after the hand-off draft), a
queue that remembers text the box no longer shows, sending prompts with
mentions or attachments, a queue marker in the band.

## Data and cost

No store key is added or changed. One boolean, `queued`, in the session's
`$.state`, in memory only. No prompt text is kept by the plugin at all: the
text lives in the box, where Claude Code already keeps it, and the plugin
reads it once, at the tick, to send it. The privacy line in `CLAUDE.md` does
not change. `held` (#208) works as today for a skip.

Each session queues and sends from its own box, so sessions do not race.
Closing a session during the rest loses its box, as it does today.

A session started before the update holds prompts as today and sends nothing.

Risk: if the person is typing in the box at the minute the
tick fires, the half-typed text goes. The tick is up to a minute after the
rest's end, when the person has had the toast and the band's countdown;
accepted.

**What cogload sees.** A prompt sent during the rest is dropped, so it never
reaches the transcript. The tick's prompt is sent by the plugin after the
rest, with `origin.kind: "plugin"`. Without `asUser` that shape counts as a
`report` today (`bun run stats` over the author's 30 days: `"plugin" "system"
- plain → report 15`), so it is no presence event and the rest's gap still
ends the streak. With `asUser` the record's fields are not yet measured.
Implementation step 1 is one real queued send and `bun run stats`:

- the `asUser` record falls in a `report` group: keep `asUser`;
- it falls in a `prompt` group: send without `asUser`. The model then reads it
  framed as "The cognitive-load plugin sent a message: …".

The PR quotes the stats line it decided on.

## Tech Stack

Bun 1.4.2+, TypeScript, the Claude Code plugin engine. No new dependencies.

## Commands

```
bun run check
claude plugin test plugin
bun run stats              # step 1: the queued send's record shape
```

## Project Structure

```
plugin/hooks/register.ts      queued flag, queue text, send from the box on tick, toast line
plugin/tests/register.test.ts cases below
README.md                     the rest paragraph names Enter-to-queue
plugin/README.md              "The rest" names it
docs/reference.md             rest paragraph
```

## Code Style

```ts
const queued = atom({ plugin: "cognitive-load", key: "queued" } as const, false);
const MENTION = /(^|\s)@\S/;

// tick, every minute
if ((await read($, queued)) && (await restUntil($, now)) === null) {
  await update($, queued, () => false);
  const { text } = await $.prompt.read();
  if (text.trim() !== "" && !MENTION.test(text)) {
    void $.prompt.submit({ text, asUser: true });
    void $.prompt.fill({ text: "", mode: "replace" });
  }
}
```

## Testing Strategy

`claude plugin test plugin`, through the registered hooks with the engine's
fake clock and store, as `register.test.ts` does today.

1. A rest running, a composer prompt → dropped with the `Queued for <until>.`
   text; no `prompt.fill` after `clock.advance(0)`. Fails on main.
2. A queued session, the box then edited to `plan B`, the clock past the
   rest's end and one tick → one plugin `prompt.submit` with `plan B` and
   `asUser`, then one `prompt.fill` with an empty draft; a second tick sends
   nothing. Fails on main.
3. A queued session whose box is empty at the tick → nothing sent.
4. Text in the box, no Enter during the rest → nothing sent at the tick.
5. A queued session, the rest ends, the person sends `next` before the tick →
   `next` passes as typed; the tick sends nothing.
6. A box with `see @src/x.ts` at the tick → nothing sent, no fill. A held
   prompt with an attachment → today's held text, the tick sends nothing.
7. `skip: prod is down now` in a queued session → lifts the rest as today;
   the tick sends nothing. A bridge prompt → passes with its note and does
   not queue.
8. A queued session; another session lifts the rest with a skip → the next
   tick here sends the box, before the original end of the rest.
9. The rest's toast ends with ` Press Enter now to send at <until>.` Fails on
   main.

## Boundaries

- Always: send only what the box shows at the tick; keep no prompt text in
  the plugin; skip and bridge rules first.
- Ask first: sending before the rest ends, a queue across sessions, a marker
  in the band.
- Never: send text the person did not queue with Enter; send a mention or
  attachment the plugin cannot expand.

## Definition of Done

- Cases 1 to 9 pass under `claude plugin test plugin`; cases 1, 2 and 9 fail
  on main, case 4 fails with the `queued` check removed.
- `bun run check` passes.
- The PR quotes the `bun run stats` line for one real queued send and says
  whether `asUser` was kept.
- README, `plugin/README.md` and `docs/reference.md` describe Enter during a
  rest, when the box is sent, and the boxes it leaves alone.

## Decisions

- Send at the rest's end, not during it (the author): an idle agent costs
  less than a reply on screen pulling the person back.
- Send the box, not a copy (the author): the text stays where the person can
  see and edit it, and the plugin keeps none of it.
- Only after an Enter during the rest (the author): an unfinished draft
  without Enter stays a draft.
- Sent on the existing minute tick rather than a timer per rest: up to a
  minute late, no timer to cancel when a skip lifts the rest.
