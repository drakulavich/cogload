# cognitive-load

A fuse for your head in Claude Code. It shows how hot this hour runs above the
prompt, and after 40 minutes without a break it holds your prompts for ten
minutes so you take one.

Works in Claude Code only. It needs the free
[cogload](https://github.com/drakulavich/cogload) command line tool, which you
install yourself; the plugin never installs anything.

## Install

```
bun add -g @drakulavich/cogload
/plugin marketplace add drakulavich/cogload
/plugin install cognitive-load@cogload
```

cogload 0.13.0 or newer, with [Bun](https://bun.sh) on the machine.

## Use it

- **The band.** A dot in the level's colour (Calm, Warming, Heating, Fried),
  the streak, and when a rest is due or how long it has left.
- **`/cogload`.** Names what drives the last sixty minutes in counts, and the
  week's rests taken and skipped.
- **The rest.** After a 40-minute streak, or once an hour when the hour reads
  Fried, the prompts you type are held for ten minutes, each with a short idea
  for the break. A held prompt goes back into the box.
- **Going on anyway.** Add `skip: <reason>` (three words or more) as the first
  or last line of a prompt. Sent on its own, it lifts the rest and brings the
  held prompts back into the box.
- **From your phone.** A prompt sent through Remote Control is not held; it
  carries a visible note, and Claude's reply begins by saying it went past the
  rest.

## What it runs and keeps

- It runs `cogload status` when a session starts, after each turn and every
  minute, and `cogload today --json` for `/cogload`. It looks for `cogload` on
  Claude Code's `PATH`, then in `~/.bun/bin`.
- cogload reads Claude Code's transcripts under `~/.claude/projects` on your
  machine and turns them into counts: prompts, sessions, decisions, tokens,
  minutes. It keeps, writes and prints no message text, prompt length, file path
  or session title.
- Nothing is sent over the network, by the plugin or by cogload.
- The plugin reads the prompts you type only to hold them during a rest and to
  find a `skip:` line. While a rest lasts, the held prompts' text stays in the
  session's memory, never on disk, until the rest is lifted or the first prompt
  after it ends.
- Its store, a JSON file under Claude Code's configuration directory, keeps
  when the current rest ends, which streak's rest was taken, when the last
  Fried rest began, the start of each rest for seven days, which
  break idea comes next, which one-time notices it has shown, and the time and
  reason of each skip for seven days. The skip reason is the only text it
  writes to disk.

[How the numbers are made](https://github.com/drakulavich/cogload/blob/main/docs/how-the-numbers-are-made.md)
explains the score. MIT licensed.
