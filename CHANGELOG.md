# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- The `cognitive-load` band warns before a rest: from a 35-minute streak it
  says `rest in 5 min` and counts down. A held prompt says
  `Rest until 14:32. Your prompt is saved.` (from a link,
  `Rest until 14:32.`), and only the first one after install says how to
  override.
- The `cognitive-load` band colours only the level, `▓ Heating 68`, and
  dims the rest of the line. Heating is orange in the band and in the CLI's
  week grid and legend.

## [0.10.0] - 2026-10-05

### Added
- The `cognitive-load` Claude Code plugin shows the current load above the
  prompt. Install it from this repository's marketplace
  (`/plugin marketplace add drakulavich/cogload`, then
  `/plugin install cognitive-load@cogload`); it is not part of the npm package.

### Changed
- zapara is now cogload: the package is `@drakulavich/cogload`, the command
  `cogload`, the data directory `~/.claude/cogload/`, the card
  `cogload-card.png`, the plugin marketplace `cogload`. The cache starts over
  with one full scan. Run `bun remove -g @drakulavich/zapara` before installing.
  A `zapara` command stays until 1.0.0 and says on stderr that it was renamed.
- The `cognitive-load` plugin holds the prompts you type for ten minutes
  after a 40-minute streak or a Fried hour. `override: <reason>` goes on and
  is counted in the band; `/overrides` lists the reasons of the last 14 days.
  The band is hidden while the last hour is calm.
- The `cognitive-load` band reads the load every minute, one `cogload status`
  run a minute across sessions, so a rest starts at the 40th minute even
  between turns, and the band counts the rest down.

## [0.9.0] - 2026-09-27

### Changed
- The Night Owl's motto is "The best commits happen after dark." It used to
  repeat the sentence before it: "… of your hours late at night. The best
  commits happen late at night."
- zapara needs Bun 1.4.2 or newer, up from 1.4.0. CI checks one version, the
  one it runs on.
- `--help` says a pipe gets JSON for the grid and a day only; `card` and
  `status` in a pipe print their usual lines.
- The status file's `peak` counts the last sixty minutes as well as the
  day's calendar hours, so `index` is never above it. Sixty minutes that
  straddle two hours can score above both, and a status line could read
  `load 13 · peak 11`. `peak` in `--json`, the grid and the day table
  still covers calendar hours only.

### Fixed
- The card no longer shows a highlight worth nothing. A Night Owl whose hours
  were all at 23:xx showed `0m / longest streak` as its second panel. A second
  or third highlight that is zero is now left out, and the panels left share
  the row; the character's own first number always shows, so a card has
  three, two or one panels.
- A transcript larger than 2 GiB is skipped like an unreadable file instead of
  failing every command, `status` included, with `Cannot create a string longer
  than 2147483647 characters`. The rest of the report stands, and zapara no
  longer reads such a file into memory at all.
- `zapara status` no longer cuts a live streak at local midnight. Its day
  looked back only to 21:00 the evening before, so a six-hour streak read
  `"streakMin":360` at 23:51 and 230 at 00:51 while you kept typing. `status`
  now traces the streak back to its first action, up to 25 hours before now;
  no other number in the file changes.
- `zapara status` writes a streak longer than 25 hours as `"streakMin":1500`,
  the ceiling the status file promises its readers. It used to write up to
  1620 late in the evening, and a reader that decodes the file strictly,
  like pult, dropped the whole line as no data.
- A run that finds `~/.claude/zapara/cache.db` unreadable deletes it only
  if it is still the same file. Two runs that started on a damaged cache
  could race, and the later one deleted the cache the earlier one had just
  recreated, so that run went without a cache. The output was right either
  way.
- `zapara card` no longer counts records timestamped after the moment it
  runs, which the grid, the day and `status` already left out. A transcript
  from a machine whose clock runs ahead could put hours on the card that no
  other view showed.
- The Night Owl's card says "late at night" instead of "after midnight" in
  its sentence, caption and motto. The late hours are 23 and 0 to 5, so a
  card whose late hours were all 23:xx read "100% of your hours after
  midnight".
- The Marathoner's sentence takes its calm share from the spectrum under it,
  so one card no longer says 33% calm in the sentence and 34% in the legend.
- A level with any hours shows at least 1% on the card's spectrum. One fried
  hour among 200 calm ones used to read `100% calm · 0% fried` beside a
  Fried peak.
- A card whose remaining highlight candidates all score zero shows the
  character's two highlights instead of a third reading `1 / sessions at
  once`, and a highlight whose value is 1 has a singular caption
  (`1 / session at once`).
- `zapara card` replaces a symlink at the card's path instead of writing the
  picture into the file it points to. An archive unpacked into Downloads
  could leave a `zapara-card.png` link that aimed the card at another file.
- The card's file mode follows your umask. With the cache on it used to come
  out 0600, because the cache narrowed the umask for the whole run; the cache
  now sets its own files' modes and leaves the umask alone.
- Ctrl-C while `zapara card` draws the picture removes its temporary page
  instead of leaving it in the temporary directory.
- Without `--out`, a card that Downloads cannot take says `cannot write
  zapara-card.png to Downloads: pass --out <path>` instead of pointing at an
  `--out` directory the person never gave.
- `card --json --out me.png` is a usage error, `--json writes no file; drop
  --out`, instead of printing the data, writing nothing and exiting 0.
- A `card` window with no activity names its dates, `no activity from
  2026-08-01 to 2026-08-31`, instead of `no activity in the last 31 days`,
  which was false for a window that ended in the past.
- `card --json` over a window with no activity prints `null` and exits 0,
  so a script gets a document either way. The picture still exits 1.
- A projects directory that can be listed but not entered (mode 444) says
  `projects directory cannot be read (check its permissions)` and exits 1,
  as one with mode 000 does, instead of reporting no activity.
- `--projects` pointing at a file, such as one transcript, says `projects
  path is not a directory` instead of `projects directory not found`.
- A transcript that starts with a UTF-8 byte order mark, as an editor may
  save it, keeps its first record instead of dropping it as malformed.
- A cache row whose events no longer decode is rebuilt by the next run
  instead of missing on every run until its transcript changed.
- A `cache.db` corrupt past its header is deleted and created again, as
  one that fails to open already was, instead of leaving the cache off for
  good. When a lookup fails, `--verbose` prints `cache   off` instead of
  counting every file as a miss.
- zapara sets the modes of `~/.claude/zapara` (0700) and `cache.db` (0600)
  only when it creates them, instead of resetting them on every run;
  `zapara status` no longer resets the directory either. `status.json`
  is still written 0600 each time.
- The week grid ends with `as of HH:MM, this hour is still running` when
  `--to` names a day after today, as the JSON's `asOf` already did.
- A window across a calendar day the time zone skipped (Samoa went from 29
  to 31 December 2011) lists that date once as an empty day, instead of
  listing the next day twice with its counts doubled.
- An Enter pressed while the card is being drawn no longer answers `open
  it? [Y/n]` before the question is shown: input typed before the question
  is discarded.
- An empty value, as in `--projects ''` or `--projects=`, is a usage error,
  `--projects needs a value`, exit 2, instead of `projects directory not
  found`.

## [0.8.1] - 2026-09-27

### Changed
- `--verbose` now accounts for the whole run. New rows time Bun's start
  and zapara's module load, opening the cache, and saving to it, and
  `zapara status` adds the write of its status file. The `cache` row now
  carries the milliseconds spent looking files up in the cache, so `read`
  counts only the reads of files the cache missed.
- A PNG or WebP card loads its page from a file in the temporary directory
  instead of a data: URL, and zapara removes that file when the render ends,
  whether it succeeded or failed. With six processes rendering at once, 0
  of 288 renders from a file hung, against about 1 in 48 from a data: URL,
  which ended in `render timed out`. The median render is about 120 ms
  slower. When the temporary directory cannot be written, zapara exits 1
  with `cannot draw the card: the temporary directory is not writable`.
- When `zapara card` finds no browser engine, the message suggests any
  Chromium browser, such as Chrome or Edge, instead of only Google Chrome.

## [0.8.0] - 2026-09-26

### Added
- zapara caches each transcript's parsed events between runs, in
  `~/.claude/zapara/cache.db`, and reparses a file only when it has changed.
  A row is a hit when its size, modification time and the SHA-256 of its
  last 4 KiB all match the cached one; the row is keyed by the transcript's
  device and inode, never by its path. On one machine, with nothing changed
  since the run before, `zapara card --json --verbose` went from 4362 ms
  (816 files read, 0 cache hits) to 246 ms (0 files read, 816 hits).
  `--no-cache` runs without reading or writing the cache, and `--verbose`
  gains a `cache` line with the hit and miss counts, or `off`.

### Changed
- A PNG card renders in about 0.7 s instead of 1.1 s on macOS. zapara opens
  one browser view instead of two, and writes WebKit's screenshot as it is
  when it already has the card's size, instead of encoding the same PNG a
  second time. The file is about 2.6 MB instead of 2.1 MB: WebKit's PNG
  encoder compresses less, and the pixels are the same.

## [0.7.4] - 2026-09-26

### Changed
- On a high-density screen, `zapara card` draws the picture at its final size
  instead of at double size and scaling it down. The PNG render on a Mac went
  from about 3.4 s to 1.6 s. The picture is the same.

### Fixed
- `--verbose` no longer counts the wait at `open it? [Y/n]` in the `total` row.

## [0.7.3] - 2026-09-26

### Added
- `--verbose` prints timings and counts to stderr after the output, with no
  path in them: files scanned and read, megabytes, milliseconds per stage,
  versions, platform and CPU count. It is meant for diagnosing a slow run on
  someone else's machine.
- `zapara card` says `drawing the card…` on a terminal's stderr while the
  browser engine renders the picture, which takes a few seconds.

## [0.7.2] - 2026-09-26

### Changed
- Transcripts are read sixteen at a time instead of one by one. On a machine
  with 1.6 GB of transcripts in a 14-day window, reading took 0.9 s instead
  of 5.4 s.
- Transcript lines older than the window's three-hour look-back are skipped
  before parsing, except assistant replies, whose request ids dedupe output
  tokens. A long session's file holds its whole history, and on one machine
  59% of what a 14-day window read was such history. Results are unchanged.
  Together with parallel reads, `zapara card --json` there went from 5.6 s to
  about 2 s.

## [0.7.1] - 2026-09-25

### Added
- `zapara --help` ends with where to report bugs, share ideas and star the
  project.

### Fixed
- Sessions started by a script through `claude -p` or the Agent SDK no longer
  count as yours. A batch of 200 of them showed up as "204 sessions at once"
  and inflated that hour's prompts, context switches and index.

## [0.7.0] - 2026-09-23

### Added
- In a terminal, `zapara card` asks `open it? [Y/n]` and opens the picture in
  the default viewer on Enter. Pipes, scripts and Windows are never asked.

### Changed
- `zapara card` writes to `~/Downloads/zapara-card.png` instead of the current
  directory, and says `wrote zapara-card.png to Downloads`. Without that
  folder it asks for `--out`.

## [0.6.0] - 2026-09-22

### Changed
- The week grid dims a day no hour scored in, so a weekend recedes behind the
  working days around it.

## [0.5.0] - 2026-09-22

### Changed
- The week grid's `peak` column is painted in a TTY with the color of the level its index falls in, by the same thresholds `zapara status` reads a level from; `--no-color` and a pipe are unchanged.
- The status file's `index` and `level` are the load of the sixty minutes ending at `asOf`, not of the calendar hour that contains it: the number no longer drops to nothing at every hour boundary (90 at 11:59:30, 6 at 12:00:30 on one machine) and no longer climbs through the hour as the bucket fills. `Day.live` in `--json` carries that bucket on the open day. Same formula, same norms; `schema` stays 1.

## [0.4.0] - 2026-09-21

### Changed
- Streak norm recalibrated for the presence rule: 40 minutes of your own uninterrupted actions now score the full streak points (was 120, the p90 of the old rule that let agent activity keep a streak alive; the p90 under the new rule is 33 on one machine and 48 on another, and 40 sits between them).
- Presence counts every human action, not only prompts: an interrupt, a tool rejection and an answer to a question or a plan hold a streak open and fill active minutes the same way a prompt does. They remain decisions where they already were; nothing is counted twice.
- An hour's streak is the longest streak seen in it, not the one it happened to end on. A single prompt after a break no longer erases the run the hour held, nor the streak points of that hour's index.
- The status file's streak is live: it counts from the first action of the streak you are in up to `asOf`, and resets to `0` once you have been away for more than ten minutes. Before, it was the current hour's bucket, so it fell to zero at every hour boundary.
- `Day.presence` in `--json`: the day's last human action and the start of the streak it belongs to, as instants, or `null` on a day with no action of yours.

### Fixed
- The card's longest streak is no longer under-reported: a run that ended in an hour where another began used to be measured only up to the end of the hour before.
- The status line's streak no longer drops to zero at each hour boundary.
- `card --out` into a directory that does not exist or refuses the write says `cannot write the card: check the --out directory` instead of printing the full path back in a file-system error.
- A permission-mode switch made before the first message of a session counts: it is attributed to the first timestamped record that follows, instead of vanishing.
- A transcript whose modification time is outside the window is read when its last record is a big one: the rescue that looks for the last timestamp reads 64 KB from the end instead of 4 KB, so a day that ended on a large tool result is no longer dropped in full.
- An output-token count that is not a finite non-negative integer is ignored instead of poisoning the day: a corrupt transcript could put `NaN` in the token column and `null` in the JSON, beside a made-up level.
- A prompt with a pasted screenshot counts again: the image block comes before the typed text, and such prompts were read as no text at all, so a day spent pasting screenshots showed no prompts and no active minutes.

## [0.3.1] - 2026-09-19

### Changed
- Streak and active minutes count your presence, not the agent's: a streak is your prompts no more than 10 minutes apart across sessions, and active minutes are the five-minute slots those streaks cover. Agent work while you are away no longer keeps a streak alive or fills the day.

## [0.3.0] - 2026-09-19

### Added
- A window that includes today says when the snapshot was taken: `asOf` on today's JSON entry and an `as of HH:MM, this hour is still running` line under the tables.
- `zapara status` writes today's load to `~/.claude/zapara/status.json` for a status line to read; the file format and the reader's refresh contract are in the spec.

### Fixed
- A window or output flag given twice (`--days 3 --days 5`) is a usage error, `--days given twice`, instead of the last value winning silently.
- A transcript whose modification time is older than the window is still read when the last timestamp in it falls inside the window; before, a restored or synced file was dropped in full without a word.

## [0.2.0] - 2026-09-18

### Changed
- The command line is the window and the view, not names for windows: `zapara` is the grid of the last 7 days, `zapara --days 30`, `zapara --to 2026-09-14` or `zapara --from 2026-09-01 --to 2026-09-14` any window up to 90 days; `zapara today`, `zapara yesterday` or `zapara 2026-09-14` one day, hour by hour; `zapara card` the picture, with the same window flags. `week` and `day` are gone. A date is `YYYY-MM-DD`, `today` or `yesterday` everywhere; `--days=30` works beside `--days 30`; `-V` beside `--version`.
- A usage error prints its line and `run 'zapara --help' for usage`, exit 2, instead of the whole usage screen; `--help` is one screen under 80 columns.

### Fixed
- `--days -1` is answered by the range message (`--days must be 1..90, got -1`) instead of `--days needs a value`: a negative number is a value, not a flag.
- A projects directory that exists but cannot be read says so (`projects directory cannot be read (check its permissions)`, exit 1) instead of `not found`; the message still names no path.
- The README's screencast and card show on npmjs.com: both images use absolute raw.githubusercontent.com URLs, and the demo files left Git LFS, whose objects the raw endpoint serves as pointer text.

## [0.1.0] - 2026-09-18

### Added
- Project scaffold: Bun runs `src/index.ts` directly, `bun run check` typechecks and tests.
- `analyze()`: hourly buckets with sessions, prompts, decisions, context switches, active minutes, streak and late-night flag, scored 0–100, from real-format transcripts.
- CLI: `zapara week` and `zapara day` with `--json`, `--to`, `--days`, `--projects`; scans `~/.claude/projects`, skipping subagent transcripts and files older than the window.
- Week heatmap and day table with `--explain`; colors in a TTY, JSON in a pipe.
- Inbound messages from subagents, other sessions and background tasks are counted as `reports`, separate from human `prompts`; assistant output tokens are summed once per request as `outputTokens`. Both are measured and shown in the day table, week totals and JSON.
- `bun run stats`: per-hour signal distributions (n, p50, p75, p90, max, zero) over the active hours of a window, top 8 hours by reports and by human prompts, and a transcript-format drift line (records vs. events recognised by the parser), for comparing the same window across two machines before calibrating `src/score.ts`. Numbers only; never a file path or message text.
- `zapara card`: the last 14 days as one 2400×1260 picture (PNG, WebP, or the HTML page itself): one of four characters by dominant load, a sentence, the peak hour, the share of hours at each level, three highlights. Rendered locally by `Bun.WebView`; the page embeds its fonts and character sheet and references nothing. `--json` prints the card's data. The only command that writes a file.
- Published on npm as `@drakulavich/zapara`: `bunx @drakulavich/zapara@latest` runs it without a clone; releases publish from GitHub Actions with OIDC trusted publishing and provenance, no npm token.

### Changed
- Score weights are integer points of 100 so half-point sums round exactly; the index is the rounded sum of the unrounded weighted parts.
- Index calibrated on two machines × 14 days: parallel 25 (norm 4 sessions), pace 15 (norm 20 prompts/h), supervision 30 (3·decisions + reports + context switches, norm 45), reading 10 (norm 80k output tokens), streak 10, late night 10. `parts` in JSON and `--explain` are now six: `par pace sup read strk late`.
- Week footer: the legend drops the ranges and the "none" entry, the totals line drops its prefix and commas, and both are dimmed in a TTY; the level ranges are in `--help`; counts past 9 999 print compact (12k, 1.2M).
- Day table: an event column that is 0 in every row is left out, and one dimmed line names what the day had none of; the skeleton columns always show.

### Fixed
- A symlink loop or an unreadable directory anywhere under the projects root no longer aborts the scan as `projects directory not found`; that directory is skipped and every other transcript still counts. Symlinks are not followed.
- "1 session at once", "1 agent report", "1 prompt": the card sentence and the week footer use the singular for exactly one.
