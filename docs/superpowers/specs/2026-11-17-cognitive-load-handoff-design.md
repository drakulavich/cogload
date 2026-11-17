# Spec: hand off one prompt to the agent during a rest

Extends `2026-10-04-zapara-forced-rest-design.md`,
`2026-10-10-cognitive-load-held-prompts-back-design.md` and
`2026-10-29-cognitive-load-powerbank-design.md`. Everything not mentioned here
stays as they say. Tracks
[#245](https://github.com/drakulavich/cogload/issues/245); hiding the reply is
[#246](https://github.com/drakulavich/cogload/issues/246), not this spec.

## Objective

During a rest every prompt the person types goes back into the box. The agent
idles for up to ten minutes, and the only way to set it working is a `skip:`,
which spends one of the week's five skips. The author named both: the idle
agent and skips spent only to avoid the wait.

After this change:

1. During a rest, the first composer prompt that the rest would hold is handed
   off: the plugin drops it and submits the same text itself with
   `$.prompt.submit({ text, asUser: true })`. The rest goes on and no skip is
   spent.
2. The drop answer is `Sent to the agent; the rest goes on. 7 min left.`, the
   minutes counted as for a held prompt. The prompt is not added to `held`.
3. Claude Code puts a dropped prompt back in the box. After a hand-off the
   plugin replaces the box with an empty draft (`$.prompt.fill({ text: "",
   mode: "replace" })` from `$.clock.after(0, …)`, as the skip path fills it),
   so the text is not sent twice.
4. One hand-off per rest, across every session: the second and later prompts
   of that rest are held as today, in any session.
5. A prompt is not handed off, and is held as today, when it carries an
   attachment (`e.attachments` present) or an `@` mention (a word starting
   with `@`): the plugin's own submission expands neither.
6. A prompt with a skip line is a skip, not a hand-off: the skip rules run
   first, unchanged. A Remote Control (`bridge`) prompt passes with its note
   as today and does not use the hand-off.
7. The toast that starts a rest gains ` Your next prompt goes to the agent.`:
   `Rest until 14:32. Streak 40m, Heating 68. Your next prompt goes to the agent.`

Not in scope: hiding the agent's reply (#246), one hand-off per session, a
hand-off sent when the rest ends, re-sending prompts with attachments.

## Data and cost

One new store key, `handoff`: a number, the `restUntil` of the rest whose
hand-off was used. A rest has a hand-off left when `handoff !== restUntil`.
No existing key changes type (`CLAUDE.md`). Eight bytes plus the key name; it
is overwritten, never grows. No text is stored: the handed-off prompt goes
straight to `$.prompt.submit` and is kept nowhere.

A session started before the update holds every prompt as today and ignores
`handoff`; an updated session sharing the store still hands off once per rest.

**What cogload sees.** A prompt the plugin submits is recorded with
`origin.kind: "plugin"`. Without `asUser`, that shape is counted as a `report`
today (`bun run stats` over the author's 30 days: `"plugin" "system" - plain →
report 15`), so it is no presence event and the rest's ten-minute gap still
ends the streak. With `asUser` the record's fields are not yet measured.
Implementation step 1 is one real hand-off and `bun run stats`:

- the `asUser` record falls in a `report` group: keep `asUser`;
- it falls in a `prompt` group: submit without `asUser`. The model then reads
  it framed as "The cognitive-load plugin sent a message: …", which the
  author accepts over a rest that no longer resets the streak.

The PR quotes the stats line it decided on.

## Tech Stack

Bun 1.4.2+, TypeScript, the Claude Code plugin engine. No new dependencies.

## Commands

```
bun run check
claude plugin test plugin
bun run stats              # step 1: the hand-off's record shape
```

## Project Structure

```
plugin/hooks/register.ts      handoff key, the hand-off branch in prompt.submit, the toast line
plugin/tests/register.test.ts cases below
README.md                     the rest paragraph names the hand-off
plugin/README.md              "The rest" names it
docs/reference.md             rest paragraph and store paragraph
```

## Code Style

```ts
const MENTION = /(^|\s)@\S/;

// in prompt.submit, after the skip and bridge branches, before holding:
const until = await restUntil($, now);
if ((await $.store.get("handoff")) !== until && !e.attachments && !MENTION.test(e.text)) {
  await $.store.set("handoff", until);
  $.clock.after(0, () => void $.prompt.fill({ text: "", mode: "replace" }));
  void $.prompt.submit({ text: e.text, asUser: true });
  return { drop: `${SENT} ${left}.` };
}
```

## Testing Strategy

`claude plugin test plugin`, through the registered hooks with the engine's
fake clock and store, as `register.test.ts` does today.

1. A rest running, a composer prompt → dropped with the hand-off text, one
   `prompt.submit` from the plugin with the same text and `asUser`, one
   `prompt.fill` with an empty draft, `handoff` set to `restUntil`. Fails on
   main, which holds it.
2. A second prompt in the same rest → held with the phrase text, no submit.
3. `handoff` already equal to `restUntil` (another session's hand-off) → the
   first prompt in this session is held.
4. The next rest, with `handoff` holding the old rest's `restUntil` → its
   first prompt is handed off.
5. A prompt with an attachment, and one with `see @src/x.ts` → held, `handoff`
   unset. Fails with the checks removed.
6. `skip: prod is down now` during a rest → lifts the rest as today, `handoff`
   unset. A bridge prompt → passes with its note, `handoff` unset.
7. The rest's toast ends with ` Your next prompt goes to the agent.` Fails on
   main.

## Boundaries

- Always: keep no prompt text in the store; one hand-off per rest across
  sessions; skip and bridge rules first.
- Ask first: a hand-off per session, sending at the rest's end, hiding replies.
- Never: hand off a prompt whose attachments or mentions would be lost.

## Definition of Done

- Cases 1 to 7 pass under `claude plugin test plugin`; cases 1 and 7 fail on
  main, case 5 fails with its checks removed.
- `bun run check` passes.
- The PR quotes the `bun run stats` line for one real hand-off and says
  whether `asUser` was kept.
- README, `plugin/README.md` and `docs/reference.md` describe the hand-off,
  its one-per-rest limit, the prompts it leaves in the box and the `handoff`
  store key.

## Decisions

- The prompt goes at once, not at the rest's end: the pain is the idle agent,
  and the rest is for the person's head, not the agent's.
- One hand-off per rest across sessions, not per session: five sessions would
  mean five prompts typed during the rest.
- The plugin re-submits instead of letting the typed prompt through, so the
  record is not presence and the rest still resets the streak.
- Hiding the reply waits for #246, after two weeks of use.
