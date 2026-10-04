# Spec: cognitive-load refreshes every minute

Extends `2026-10-04-zapara-forced-rest-design.md` and the plugin spec it
extends; everything not mentioned here stays as they say. Tracks
[#109](https://github.com/drakulavich/zapara/issues/109).

## Objective

The plugin reads `zapara status` only when a session starts and after a
turn. The streak keeps growing while the author reads a long answer or
thinks, so a rest due at the 40th minute starts at the next turn's end,
which can be many minutes later. The band also says `rest until 10:27` with
no sense of how long is left, and keeps saying it after 10:27 until the next
turn.

With a one-minute timer:

1. Every 60 seconds each session takes a fresh reading: the last one any
   session of the plugin got, when its `asOf` is under 60 seconds old, else a
   new `zapara status` run. Usually that is one run a minute however many
   sessions are open, as with pult; sessions whose ticks fall within one run
   may each run, never more than one a minute each. A reading that is due
   for a rest starts it then, with the same toast as after a turn.
2. During a rest the band reads `▓ Heating 68 · rest until 10:27 (7 min)`,
   the minutes left rounded up, and the count goes down once a minute.
3. Within a minute after the rest ends, the band drops `rest until` and goes
   back to the normal line.

Nothing else changes: the trigger, the hold, the override and `/overrides`
behave as `2026-10-04-zapara-forced-rest-design.md` says.

### How

- Every reading that decodes, from any session, is also written to `$.store`
  as `reading`, beside `restUntil`.
- `session.start` starts `$.clock.every(60_000, tick)` after its first
  refresh. `tick` uses the stored `reading` when `now - asOf` is under 60
  seconds, the way pult judges its file by `asOf`; otherwise it runs
  `zapara status` as a turn does. Turns and `session.start` always run it.
  The timer lives until the module reloads; a reload fires `session.start`
  again, which starts a new one.
- Each reading a tick takes is written to `$.state`, so the band redraws
  once a minute. The band computes the minutes left from `$.clock` when it
  draws. No `$.ui.invalidate`, no second timer.
- A run that fails keeps the last reading and logs as the MVP does; the band
  then redraws at the next good run.
- Runs from the timer and from a turn may overlap; the MVP already keeps the
  run that finishes last.

Cost: usually one `zapara status` a minute across all sessions, at most one
a minute per session when their ticks coincide (`$.store` has no
compare-and-set to claim a run), plus one per turn. A run took 107 ms warm and 399 ms with a transcript being written
(2026-10-04, 490 transcripts, `--verbose`). The stored reading is shared only
by sessions of the plugin; `~/.claude/zapara/status.json` is not read, so a
stub `zapara` in the user scenarios does not race the real one.

## Tech Stack

Claude Code 2.1.289 plugin of function hooks, plain TypeScript, as in the
plugin today. New engine noun: `$.clock.every`; `$.store` gains `reading`.

## Commands

```
claude plugin validate plugin
claude plugin test plugin
bun run check
claude --plugin-dir plugin --debug-file /tmp/cl/debug.log   # user scenarios, in tmux
```

## Project Structure

```
plugin/hooks/register.ts        the timer in session.start; minutes left in the band
plugin/tests/register.test.ts   cases below
plugin/.claude-plugin/plugin.json   0.2.0 → 0.3.0
README.md, CHANGELOG.md
```

No file under `src/` or `tests/` changes.

## Code Style

As `plugin/hooks/register.ts` today. No new comments: the timer's lifetime
fails loudly in the user scenarios if it is wrong.

## Testing Strategy

Unit, `claude plugin test plugin` with `mock.clock`; each case red before its
code:

1. A first reading with `streakMin` 39 and a timer reading a minute later with
   40 starts a rest without any turn: a typed prompt is dropped and one toast
   was shown.
2. During a rest the band reads `rest until HH:MM (10 min)` at its start and
   `(7 min)` three minutes and a timer run later.
3. A timer run after the rest ends draws the normal line, without
   `rest until`.
4. A tick whose stored `reading` is 30 seconds old does not run
   `zapara status`; one older than a minute does; with none stored, it runs.

User scenarios, tmux, `--plugin-dir plugin`, the stub `zapara` from #107 that
derives `streakMin` from a fixed start:

| # | Setup | Action | Expected on screen |
|---|---|---|---|
| 1 | Stub: Heating, streak 39 minutes | Start, send nothing for two minutes | The toast and `rest until HH:MM (10 min)` appear without a prompt |
| 2 | After 1 | Wait until the rest ends, plus a minute | The band shows the normal line |

## Boundaries

- Always: `claude plugin test plugin` and `bun run check` before each commit.
- Ask first: a period other than 60 s, a timer anywhere but `session.start`,
  reading `~/.claude/zapara/status.json`.
- Never: more than one timer per session.

## Success Criteria

- `claude plugin validate plugin` passes; `claude plugin test plugin` passes
  every existing case and 1 to 4, each failing when its behaviour is removed.
- `bun run check` passes; `git diff origin/main -- src tests` is empty.
- User scenarios 1 and 2 pass, with captured screens in the implementation PR.
- README "Inside Claude Code" says the band refreshes every minute and counts
  down a rest; CHANGELOG `## [Unreleased]` / `### Changed` has one entry.

## Open Questions

- None.
