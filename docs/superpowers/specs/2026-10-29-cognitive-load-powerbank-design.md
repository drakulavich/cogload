# Spec: five skips per calendar week

Extends `2026-10-04-zapara-forced-rest-design.md` (rule 5, the skip) and
`2026-10-07-cognitive-load-skip-and-rest-phrases-design.md`. Everything not
mentioned here stays as they say. Tracks
[#234](https://github.com/drakulavich/cogload/issues/234).

## Objective

A `skip:` line with a reason of three words or more lifts any rest, as often
as it is typed. Three words come out on autopilot, and then the rest does
nothing. The author's plugin store shows 12 skips in the week of 2026-10-05,
the week 0.10.x was being tested, and none in the three weeks since, against
2 rests and 1 rest. The limit below would not have fired in those three
weeks: it guards against skipping becoming a habit, it is not a response to
one.

After this change:

1. A calendar week holds five skips. It starts Monday 00:00 in the local
   time zone of the machine the plugin runs on.
2. "A skip line" below is what `SKIP` matches today: `skip:` or its older
   spelling `override:`, first or last in the prompt. During a rest, a typed
   prompt with a skip line, when five skips are already recorded since
   Monday, does not lift the rest, whatever its reason. It is dropped with
   `The powerbank is empty until Monday: 5 skips this week. 7 min left. Your prompt is back in the box.`
   The minutes are counted as for a held prompt. The prompts the rest held
   stay held, and `phrase` does not advance.
3. With skips left, a skip line behaves as today: a short reason gets
   `A skip needs a reason of three words or more.`, and a long one lifts the
   rest and spends one skip. That includes a Remote Control prompt, which
   today lifts the rest and records a skip like a typed one.
4. A Remote Control prompt is never dropped. With an empty powerbank its
   skip line lifts nothing and records nothing: the prompt goes through with
   the note every Remote Control prompt gets during a rest, as it does today
   without a skip line.
5. During a rest the band shows the skips left after the countdown:
   `● Heating · rest until 14:32 (7 min) · 3 skips left`, and
   `1 skip left`, `no skips left`, from 50 columns, where the band also
   shows the streak; narrower, the rest countdown alone. Outside a rest the
   band does not show them.
6. The `/cogload` week line counts from Monday 00:00 local, not over the
   last seven days, and ends with the skips left:
   `This week: 1 rest taken, 1 skipped (last: "prod is down, fixing it"), 4 skips left.`
   `skipped` is every skip since Monday, also one that lifted a rest begun
   before Monday; `taken` stays the rests since Monday minus the skips that
   followed one of them. The line appears when there is a rest or a skip
   since Monday, and is left out otherwise, so a Sunday rest skipped at
   Monday 00:01 gives `This week: 0 rests taken, 1 skipped (last: "…"), 4 skips left.`
   where today the line is left out.
7. Nothing else changes: a skip line outside a rest is ordinary text, and a
   lifted rest stays lifted until that streak ends.

Not in scope: a rest that runs to the end earning a skip back (a rest, skip,
rest, skip loop makes skips cheap again; it would also need when each rest
ended, which the store does not keep), a higher price for a skip in a Fried
hour, a skip without a reason, a configurable limit, an emergency way past an
empty powerbank (turning the plugin off in `/plugin` is that).

## Data and cost

No store key is added or changes type (`CLAUDE.md`: a key keeps its type).
The count is read from `overrides`, the existing list of `{ at, reason }`:
skips left = `5 - (entries with at >= weekStart(now))`, never below 0. Every
reader of the week (the limit, the band, the week line) uses this one
`>=` predicate; a skip at exactly Monday 00:00 belongs to the new week.

Today each skip trims `overrides` to `at > now - WEEK_MS`. A calendar week
can be longer than `WEEK_MS`: the week that ends daylight saving has 169
hours, so on its last Sunday evening the rolling trim would drop the skips
of its first Monday hour and let a sixth skip through. The write therefore
trims to `at >= weekStart(now)` instead, and the rests list keeps its
seven-day trim (the week line reads rests since `weekStart(now)`, which a
169-hour week can also outrun by one hour; a rest in that hour is left out
of `taken`, which is acceptable for a count that only informs). The list
then holds at most five entries, about 60 bytes each. Reading it is one `store.get` per prompt during a rest and
per band render during a rest, as the countdown already does for
`restUntil`.

A session started before the update runs the old code: it lets a sixth skip
through and records it, and an updated session counts that record. Its
seven-day trim keeps more than the new one, never less, except in the
169-hour week above. The limit holds once every session is restarted. The
CHANGELOG line says so.

Monday is computed from `$.clock.now()` with the local `Date` methods
(`setHours(0, 0, 0, 0)`, then back `(getDay() + 6) % 7` days), the same
local time the band's `clockTime` already uses. Across a daylight-saving
change `setHours` keeps it at local midnight.

## Tech Stack

Bun 1.4.2+, TypeScript, the Claude Code plugin engine. No new dependencies.

## Commands

```
bun run check
claude plugin test plugin
```

## Project Structure

```
plugin/hooks/register.ts      SKIPS_PER_WEEK, weekStart(), skipsLeft(); the overrides trim;
                              prompt.submit,
                              AbovePrompt and the /cogload week line use them
plugin/tests/register.test.ts cases below
README.md                     the rest paragraph names the limit
plugin/README.md              "Going on anyway" names the limit
docs/reference.md             rest paragraph, week line, store paragraph
```

## Code Style

```ts
const SKIPS_PER_WEEK = 5;

const weekStart = (now: number): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};
```

`weekLine` and the band read the same helper, so the two numbers cannot
disagree.

## Testing Strategy

`claude plugin test plugin`, through the registered hooks with the engine's
fake clock and store, as `register.test.ts` does today. Times in the new
cases are built with the local `Date` constructor, so they hold in any time
zone the suite runs in.

1. Five skips since Monday, a rest running, `skip: prod is down now` →
   dropped with the empty-powerbank text, `restUntil` unchanged,
   `overrides` unchanged. The same with `override: prod is down now`.
   Both fail on main, which lifts the rest.
2. Five skips, all before Monday 00:00 of this week, the same prompt → the
   rest is lifted and `overrides` gains one entry. Pins that the week
   resets on Monday, not seven days after each skip.
3. Four skips before Monday and one at exactly Monday 00:00 → 4 skips left.
   Pins the `>=`.
4. A skip on Saturday with a stored skip from the previous Saturday, under
   seven days old, and one at Monday 00:00 → `overrides` keeps the Monday
   one and drops the other. Fails with the rolling trim, which keeps both.
   This pins the trim's edge, not a daylight-saving week itself: `claude
   plugin test` runs in the machine's zone and ignores `TZ`, and its
   environment has no `process` to set it from (checked on Claude Code
   2.1.312).
5. A Remote Control prompt `skip: prod is down now` with five skips since
   Monday → passes with the Remote Control note, `restUntil` and
   `overrides` unchanged. Fails with a check that drops before the bridge
   branch.
6. Two skips since Monday, a rest running → the band reads
   `rest until … · 3 skips left`; four skips → `1 skip left`; five →
   `no skips left`. Fails on main.
7. No rest running → the band shows no skips, five skips since Monday or
   not.
8. A rest on Sunday and the week line on Saturday six days later → the
   Sunday rest is left out of `taken`. Fails on main, whose seven-day window
   still holds it.
9. A rest on Sunday and its skip at Monday 00:01 → the week line reads
   `This week: 0 rests taken, 1 skipped (last: "…"), 4 skips left.` Fails
   on main, which leaves the line out.
10. Five skips since Monday and `skip: no` → the empty-powerbank text, not
    the short-reason one.

The existing tests stay green with only their expected week line, and the
band during a rest from 50 columns, gaining the skips-left tail.

## Boundaries

- Always: count from `overrides`, keep its type, keep the reason the only
  text in the store.
- Ask first: a new store key, a limit other than five, any way past an empty
  powerbank.
- Never: hold or drop a Remote Control prompt for an empty powerbank; count
  a `skip:` line typed outside a rest.

## Definition of Done

- Cases 1 to 10 pass under `claude plugin test plugin`; cases 1, 6, 8, 9
  and 10 fail on main, case 3 fails with `>`, case 4 with the rolling trim,
  case 5 with the limit checked before the bridge branch.
- `bun run check` passes.
- README, `plugin/README.md` and `docs/reference.md` name the five-skip
  week, the Monday reset, the empty-powerbank text and the band's skips
  left; `docs/reference.md` says the week line counts from Monday.
- The PR body carries the CHANGELOG line, including that sessions started
  before the update ignore the limit until restarted.

## Decisions

- Five per calendar week, reset Monday 00:00 local, chosen by the author over
  a rolling seven days: "two left until Monday" is easier to plan around.
- An empty powerbank leaves waiting or turning the plugin off, chosen by the
  author over a costlier skip or borrowing from next week.
- The band says `3 skips left` rather than the `skips 3/5` of the idea
  draft: `3/5` reads as used or as left.
- The empty-powerbank check runs before the reason check, so a short reason
  on an empty powerbank learns the real obstacle first. For a Remote Control
  prompt it routes to the bridge branch instead of dropping.
- A Remote Control skip keeps spending a skip, as it records one today; only
  an empty powerbank changes what it does.
