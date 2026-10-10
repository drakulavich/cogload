# Privacy policy

Applies to the `cogload` command line tool (npm `@drakulavich/cogload`) and the
`cognitive-load` Claude Code plugin, both published from this repository by
Anton Yakutovich. Last changed 2026-10-10; earlier versions are in this file's
git history.

## In short

Both run only on your machine. Neither has an account, a server, analytics or
telemetry, and neither sends anything over the network. The author receives no
data from you.

## What cogload reads

cogload reads Claude Code's transcripts under `~/.claude/projects` (or the
folder you pass with `--projects`) to count how you work: prompts, sessions,
decisions, output tokens, active minutes and streaks. It compares message text
against a few fixed markers, such as an interrupt, and then discards it. It
keeps, writes and prints no message text, prompt length, file path or session
title.

## What cogload writes

- `~/.claude/cogload/cache.db`: per transcript, the parsed events (a timestamp,
  a session id, an event kind, a token count), keyed by the file's device and
  inode, with its size, modification time and a hash of its last 4 KiB. It
  stays until you delete it.
- `~/.claude/cogload/status.json`: today's load as eleven numbers and labels,
  overwritten on every `cogload status`.
- `~/Downloads/cogload-card.png`, or the path you give with `--out`, when you
  run `cogload card`. While
  it renders, a copy of the page sits in the temporary directory as a `0600`
  file and is removed when the render ends.

## What the plugin keeps

- It reads the prompts you type only to hold them during a rest and to find a
  `skip:` line.
- A held prompt's text stays in the Claude Code session's memory, never on disk,
  until the rest is lifted or the first prompt after it ends.
- Its store, a JSON file in Claude Code's plugin data, keeps when the current
  rest ends, which streak's rest was taken, when the last Fried rest began, the
  start of each rest for seven days, which break idea comes next, which
  one-time notices it has shown, and the time and reason of each `skip:` for
  seven days. The skip reason you type is the only text it writes to disk.
  Entries older than seven days are dropped the next time it writes them.
- It runs `cogload status` and `cogload today --json` on your machine and keeps
  the numbers they print in the session's memory.

## Sharing

Nothing is shared with the author or any third party. A card you create is a
file on your machine; sharing it is up to you.

## Deleting your data

Delete `~/.claude/cogload/` to remove everything cogload wrote. Uninstall the
plugin, or delete its store file under `~/.claude/plugins/store/`, to remove
what the plugin kept. Held prompts go when the session ends.

## Children

cogload and the plugin are developer tools and are not intended for people
under 18.

## Contact

Questions or concerns: open an issue at
https://github.com/drakulavich/cogload/issues.
