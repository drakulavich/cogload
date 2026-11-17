# Spec: prompts typed during a rest go to the agent when it ends

Extends `2026-10-04-zapara-forced-rest-design.md`,
`2026-10-10-cognitive-load-held-prompts-back-design.md` and
`2026-10-29-cognitive-load-powerbank-design.md`. Everything not mentioned here
stays as they say. Tracks
[#245](https://github.com/drakulavich/cogload/issues/245).

## Objective

During a rest every prompt the person types goes back into the box, and after
the rest they must send it by hand. A thought written down during the rest
either waits for them to come back and press Enter, or costs a `skip:`.

After this change a rest is a queue: what the person types during it goes to
the agent the moment the rest ends. They choose at the start of the rest:
write the agent a plan and go for tea, or write nothing and go for a walk. In
both cases work starts again ten minutes later, and the agent does nothing
during the rest, so there is nothing on screen to come back and check.

1. During a rest, a held composer prompt is answered
   `Queued for 14:32. Water, then a window. 7 min left.`: the phrase and
   minutes as today, after the queue line. The text is added to `held` as
   today.
2. Claude Code puts a dropped prompt back in the box. The plugin clears it
   (`$.prompt.fill({ text: "", mode: "replace" })` from `$.clock.after(0, …)`,
   as the skip path fills the box), so the person does not send it twice.
3. On the first minute tick (`REFRESH_MS`, already running) at which the
   session has no rest running and `held` is not empty, the plugin sends the
   queue: `$.prompt.submit({ text: joinHeld(held), asUser: true })`, then
   empties `held`. The prompts go as one message, oldest first, as a skip
   already joins them.
4. If the person types a prompt after the rest ended but before that tick, the
   queue goes first in the same message: the prompt is passed on as
   `joinHeld(held)`, a blank line, then its own text, and `held` is emptied.
   Today that path empties `held` and drops the queue.
5. A prompt with an attachment (`e.attachments` present) or an `@` mention (a
   word starting with `@`) is not queued: the plugin's own submission expands
   neither. It is held as today, with today's text, and stays in the box.
6. A skip during the rest works as today: a long reason lifts the rest and
   brings the queue back into the box ([#208](https://github.com/drakulavich/cogload/issues/208));
   a short reason or an empty powerbank answers as today. A Remote Control
   (`bridge`) prompt passes with its note as today and is never queued.
7. The toast that starts a rest gains ` What you type now goes to the agent at 14:32.`:
   `Rest until 14:32. Streak 40m, Heating 68. What you type now goes to the agent at 14:32.`

Not in scope: sending during the rest (the earlier hand-off design, dropped
for this one), a count of queued prompts in the band, queueing prompts with
attachments or mentions.

## Data and cost

No store key is added or changed. The queue is `held`, the session state
(`$.state`) that already holds a held prompt's text in memory until the rest
is lifted or the next prompt after it ends (`CLAUDE.md`, #208); this spec
keeps it until the queue is sent, at most about a minute past the rest's end.
Nothing goes to disk. Each session queues and sends its own prompts, so
sessions do not race.

The cost the person accepts: a queued prompt lives only in the session's
memory. Closing the session during the rest loses it, where today it would
still be in the box until the session closes too.

A session started before the update holds prompts as today and sends nothing.

**What cogload sees.** A prompt typed during the rest is dropped, so it never
reaches the transcript. The queue is sent by the plugin after the rest, with
`origin.kind: "plugin"`. Without `asUser` that shape counts as a `report`
today (`bun run stats` over the author's 30 days: `"plugin" "system" - plain
→ report 15`), so it is no presence event and the rest's ten-minute gap still
ends the streak. With `asUser` the record's fields are not yet measured.
Implementation step 1 is one real queued send and `bun run stats`:

- the `asUser` record falls in a `report` group: keep `asUser`;
- it falls in a `prompt` group: send without `asUser`. The model then reads it
  framed as "The cognitive-load plugin sent a message: …".

The PR quotes the stats line it decided on. In the case of rule 4 the queue
rides on the person's own prompt, which is presence anyway.

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
plugin/hooks/register.ts      queue text, box clear, send on tick, queue-first on the next prompt, toast line
plugin/tests/register.test.ts cases below
README.md                     the rest paragraph names the queue
plugin/README.md              "The rest" names it
docs/reference.md             rest paragraph; privacy paragraph on how long held text stays in memory
```

## Code Style

```ts
const MENTION = /(^|\s)@\S/;
const queued = (until: number) => `Queued for ${clockTime(until)}.`;

// tick: after the reading, every minute
const queue = await read($, held);
if (queue.length > 0 && (await restUntil($, now)) === null) {
  await update($, held, () => []);
  void $.prompt.submit({ text: joinHeld(queue), asUser: true });
}
```

## Testing Strategy

`claude plugin test plugin`, through the registered hooks with the engine's
fake clock and store, as `register.test.ts` does today.

1. A rest running, a composer prompt → dropped with `Queued for <until>.`,
   the phrase and minutes; after `clock.advance(0)` one `prompt.fill` with an
   empty draft. Fails on main.
2. Two prompts during the rest, then the clock past the rest's end and one
   tick → one plugin `prompt.submit` with both texts joined, oldest first,
   `asUser`, and `held` empty; a second tick sends nothing. Fails on main.
3. A queued prompt, the rest ends, and the person types `next` before the
   tick → the prompt passed on is the queue, a blank line, then `next`; no
   plugin submit at the next tick. Fails on main, which drops the queue.
4. A prompt with an attachment, and one with `see @src/x.ts` → today's held
   text, no box clear, not in the queue.
5. `skip: prod is down now` with two queued prompts → lifts the rest and
   fills the box with both, as today; no plugin submit at the next tick.
   `skip: no` and an empty powerbank answer as today and queue nothing. A
   bridge prompt passes with its note and queues nothing.
6. The rest's toast ends with the queue line. Fails on main.
7. No rest has run and `held` is empty → ticks send nothing.

## Boundaries

- Always: queued text in session memory only; one message per queue; skip
  and bridge rules first.
- Ask first: sending before the rest ends, a queue shared across sessions,
  showing the queue in the band.
- Never: queue a prompt whose attachments or mentions would be lost.

## Definition of Done

- Cases 1 to 7 pass under `claude plugin test plugin`; cases 1, 2, 3 and 6
  fail on main.
- `bun run check` passes.
- The PR quotes the `bun run stats` line for one real queued send and says
  whether `asUser` was kept.
- README, `plugin/README.md` and `docs/reference.md` describe the queue, when
  it is sent, the prompts it leaves in the box, and that held text now stays
  in memory until the queue is sent.
- The privacy line in `CLAUDE.md` says held text stays in `$.state` until the
  queue is sent, at most a minute past the rest.

## Decisions

- Send at the rest's end, not during it (the author, after the hand-off
  draft of this spec): the agent idling ten minutes costs less than a reply
  on screen pulling the person back, and the person chooses between leaving
  a plan and leaving nothing.
- One message for the whole queue, as a skip already joins held prompts.
- Sent on the existing minute tick rather than a timer per rest: up to a
  minute late, no new timer to cancel when a skip lifts the rest.
- The box is cleared after each queued prompt, so a second Enter on the same
  text does not queue it twice; the drop answer says it is queued.
