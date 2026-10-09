# cogload reference

Everything the [README](../README.md) leaves out: every command and flag, the plugin and its rest in full, what is read and kept, the limits, and how the number is made.

Claude Code writes a JSONL transcript for every session under `~/.claude/projects`. cogload reads those files, puts each record in the local hour it happened in, and turns the hour into one number. A week is a heatmap of seven rows by 24 cells; a day is a table with one row per hour and, with `--explain`, the weighted contribution of each component.

## Usage

<p align="center">
  <img src="https://raw.githubusercontent.com/drakulavich/cogload/main/assets/demo.webp" alt="cogload in a terminal: week heatmap, day table, JSON, status" width="800">
</p>

| Command | What it does |
|---|---|
| `cogload` | The last 7 days ending today, one cell per hour, in local time. |
| `cogload --days 30` | The last 30 days. `--days` takes an integer from 1 to 90. |
| `cogload --from 2026-09-01 --to 2026-09-14` | Any window, both days inclusive, at most 90 days. `--to` alone is 7 days ending there, `--days 30 --to 2026-09-14` is 30 days ending there. |
| `cogload today` | Today, one row per hour that had activity. `yesterday` likewise. |
| `cogload 2026-09-14 --explain` | One day, with the six weighted components behind each index. |
| `cogload card` | The last 14 days as one shareable picture, `cogload-card.png` in `~/Downloads`. |
| `cogload card --days 30 --out me.webp` | Any window from 1 to 90 days; `.png`, `.webp` or `.html` by extension. `--json` prints the card's data instead. |
| `cogload status` | Writes today's load to `~/.claude/cogload/status.json` for a status line to read, and prints the same line. The file's fields are in [the status file spec](superpowers/specs/2026-09-19-zapara-status-file-design.md), written when cogload was zapara and kept its files in `~/.claude/zapara/`. Since 0.13.0 the line also carries `restAt`, when the running streak reaches 40 minutes (`null` with no streak), and `restMin`, how long a rest must be to end a streak (`10`). |

| Flag | What it does |
|---|---|
| `--days <N>`, `--from <date>`, `--to <date>` | The window. A date is `YYYY-MM-DD`, `today` or `yesterday`. `--days=30` works as well as `--days 30`. |
| `--explain` | With a day: the six weighted parts behind each index. |
| `--json` | Print the whole window as one JSON document instead of a table. |
| `--projects <dir>` | Read this directory instead of `~/.claude/projects`. |
| `--out <path>` | Where `card` writes instead of `~/Downloads`; the extension picks the format. |
| `--no-color` | Plain glyphs and peaks with no ANSI codes. `NO_COLOR` in the environment does the same. |
| `--no-cache` | Read and parse every transcript again instead of using `~/.claude/cogload/cache.db`. |
| `--verbose` | After the output, prints to stderr where the time went: files scanned and read, megabytes, cache hits and misses (or `off` with `--no-cache`, or when the cache could not be opened or read, including an empty `HOME`), and milliseconds for each step in the order it ran: starting Bun and loading cogload, opening the cache, scanning, looking files up in the cache, reading the files it missed, analysis, saving to the cache, the card's render, and the status file's write. The rows add up to the total within a few milliseconds. It also prints the cogload and Bun versions, platform and CPU count. Numbers only, no path, so the lines are safe to paste into an issue when cogload is slow on your machine. |
| `-h`, `--help` | Usage, exit 0. |
| `-V`, `--version` | The version from `package.json`, exit 0. |

Levels: calm 0–29, warming 30–59, heating 60–84, fried 85–100.

The grid and the day print a text table when stdout is a terminal and JSON otherwise, so `cogload | cat` prints JSON; no flag forces text in a pipe yet. `card` and `status` write their file and print their lines whether piped or not. `card` asks to open the picture only when stdin and stdout are both a terminal, and never on Windows. While the browser engine draws a picture, a terminal's stderr shows `drawing the card…`, cleared before the result. `card --json` is the exception: it prints the card's data and writes no file, so `--out` with it is a usage error. `--json` changes nothing for `status`, whose line is already JSON and whose file is written either way.

A run that works exits 0, and so does a window with no data, which prints an empty grid, or `no activity on <date>` for one day. Exit 1 is a failure cogload can name, printed as one line to stderr that never contains a path: the projects directory missing or unreadable, `status` unable to write its file, `card` unable to write its picture or to find a browser engine, `card` without `--out` on a machine with no `~/Downloads` folder, `card` over a window with no activity (`card --json` prints `null` and exits 0 instead), and whatever else goes wrong below the command line. Exit 2 is a usage error, such as a bad date, an unknown flag or a value flag given twice; it prints one line and a hint to `--help`.

### The card

In a terminal it then asks `open it? [Y/n]`: Enter opens the picture in the default viewer, where ⌘C copies it for a chat. A pipe or a script is never asked.

```
The Marathoner: Longest streak 7h53m without a break, 68% of your hours calm.
wrote cogload-card.png to Downloads
open it? [Y/n]
```

The card in the README comes from the same `busy-week` fixture as its week grid. A headless browser that Bun drives takes the picture: WebKit on macOS, an installed Chromium browser (Chrome, Edge, Brave, Chromium) elsewhere. On Linux or Windows, install one or write `--out card.html` and open the page in any browser.

## Inside Claude Code

The `cognitive-load` plugin draws the level of the last hour above the Claude Code prompt, with the time your rest starts, or your current streak once that streak has nothing left to rest:

```
● Heating · rest at 14:52
```

The level cools after a break: ten minutes away keep about half of the load from before it, twenty minutes keep none, so the band reads lower after a rest.

When the band turns Heating and you want to know why, type `/cogload`. It runs `cogload today --json` and names what drives the last sixty minutes in counts:

```
Heating 80 this hour, at the cap: 16 decisions and 13 context switches, 32 prompts, a 57m streak.
This week: 1 rest taken, 1 skipped (last: "prod is down, fixing it").
```

The first line names every part of the score at its cap, heaviest weight first, or, with none at its cap, the one closest to it: `Warming 45 this hour, mostly 3 sessions at once.` With no scored hour it says `Nothing scored this hour.`, and with an index of 0, after twenty minutes away, `Calm 0 this hour: you have been away.` The second line counts the rests of the last seven days you took and the ones you skipped, and quotes the newest skip's reason; with no rest, it is left out. When `cogload` cannot start it prints the missing-`cogload` text below, and any other failure prints `cogload gave no reading.`

The index, the day's peak and the active time stay in `cogload` in a terminal. The first session after install shows one toast, `Keep your head cold. The dot above the prompt shows how hot this hour runs.`

Install it from this repository's marketplace, in Claude Code:

```
/plugin marketplace add drakulavich/cogload
/plugin install cognitive-load@cogload
```

Coming from the `zapara` marketplace, remove it first (`/plugin marketplace remove zapara`). The plugin's own store starts over with the new marketplace, so a rest in progress ends and the week's counts in `/cogload` start over.

The plugin runs `cogload status` when a session starts and after every turn, and reads the load again every minute: from the reading another session of the plugin took less than a minute ago, or from a new run. It starts `cogload` from the `PATH` Claude Code was started with, and when that fails, `~/.bun/bin/cogload`: a Homebrew Bun, or the Desktop app opened from the Dock, can leave that directory off the `PATH`. The first time neither can start, a toast says `cogload is not on Claude Code's PATH: bun add -g @drakulavich/cogload`, once per install. The band starts with a dot in the level's colour, leaves out a zero streak, keeps only `● Heating` when it is under 50 columns wide unless a rest is ahead or running, and is not drawn when the last sixty minutes hold no session. When a run fails, the band keeps the last good reading, or stays away if there is none, and the reason goes to Claude Code's debug log (`claude --debug`) as one of `not found`, `exit <code>`, `timeout` or `bad line`. The plugin is not part of the npm package; [its spec](superpowers/specs/2026-10-03-zapara-cognitive-load-plugin-design.md) has the rest.

The plugin also makes you rest. When a reading shows a presence streak of 40 minutes or a Fried hour, it holds every prompt you send, typed, queued or from a link in the transcript, in every session that runs it, for ten minutes. While a streak will still start a rest, the band shows when, in place of the streak: `● Heating · rest at 14:32`, the streak's start plus 40 minutes, so the time stays put. A held prompt you typed goes back into the box with the next of eight short ideas for the break, the minutes left and the way out: `Stand up and stretch. 7 min left, your prompt is saved. To go on: "skip: <reason>".`; one from Remote Control gets the same without `your prompt is saved`. The rest can start while you read, and the band counts it down, `rest until 14:32 (7 min)`. Ten minutes without a prompt is the gap that ends a streak in cogload, so the next one starts at zero. A streak makes you rest once, and so does a Fried hour: after a rest a Fried reading starts none for an hour, though a 40-minute streak still does. A `skip: <reason>` line, first or last in the prompt and the reason at least three words, lifts it until that streak ends and sends the rest of the prompt; the same line in the middle does nothing. A shorter reason, or none, gets `A skip needs a reason of three words or more.`, and a typed prompt goes back into the box as a held one does. The band does not count skips; `/cogload` counts the week's and quotes the newest reason. Answers to Claude's questions, slash commands, a running turn, and prompts from notifications, other sessions or scheduled tasks are never held. [The rest's spec](superpowers/specs/2026-10-04-zapara-forced-rest-design.md) has the details.

## Privacy

cogload reads `~/.claude/projects/**/*.jsonl`, skipping subagent transcripts under `subagents/`. It follows no symlink inside that directory, so a project directory that is a symlink is not read; `--projects` itself may be one. It picks files by modification time first, and opens one whose modification time is older than the window only to read the last timestamp in its final 64 KB; nothing from that tail is kept or printed. It compares message text against a few fixed markers, for interrupts, tool rejections and inbound agent messages, then discards it. What survives into an event is a timestamp, a session id, an event kind and a token count.

cogload keeps, writes and prints no message text, prompt length, file path or session title. The CLI never prints a path it derived or read, not even the projects root when it cannot open it. It sends nothing anywhere, installs nothing into Claude Code, and writes no file except the card, the status file and the cache below. The optional `cognitive-load` plugin runs `cogload status` and keeps the eleven values of its line in the session's state, and needs cogload 0.13.0 or newer; `/cogload` runs `cogload today --json` and prints only counts from it. The plugin reads no transcript or tool call and never keeps or logs what a command printed. It reads the prompts you type only to hold them during a rest and to find a `skip:` line. Its own store, a JSON file under Claude Code's configuration directory, keeps when the current rest ends, when the last resting streak was due its rest (`restAt`), the start of each rest for 7 days, when the last Fried rest began (`friedAt`), which idea for the break comes next (`phrase`), whether it has shown the welcome, the missing-`cogload` and the older-`cogload` toasts (`welcomed`, `missingShown`, `olderShown`), and the time and reason of each skip for 7 days; the reason is the only text it keeps. While it draws a PNG or WebP, the card's page also sits in the temporary directory as a `0600` file, removed when the render ends or is interrupted. A process killed outright (`kill -9`) leaves it there until the system clears the temporary directory.

Between runs, cogload caches each transcript's parsed events in `~/.claude/cogload/cache.db`. A hit still reads the last 4 KiB of the file to confirm it matches the cached row, then skips reading and parsing the rest. So a changed file is recognised by its size, modification time and last 4 KiB: an edit earlier in the file that keeps its size and modification time is not seen, and `--no-cache` parses everything again. A row is keyed by the transcript's device and inode, never by its path or a hash of it. Besides the device and inode, a row stores a fingerprint of the parser that wrote it, the file's size and modification time, a hash of its last 4 KiB, the cutoff its events were parsed with, when the row was last used, and the parsed events themselves. No message text, prompt length, path or title is stored. `--no-cache` runs without reading or writing it.

## Limits

- Time is local and buckets are whole hours, so an hour that straddles midnight or a daylight-saving change is bucketed by the local clock. On a fall-back day two wall-clock hours share one label and merge, so that bucket can hold up to 120 active minutes and the day up to 1500.
- cogload reads only Claude Code transcripts. Work in other tools, and time away from the keyboard, is invisible.
- A file whose modification time is older than the window is still read when the last timestamp in it falls inside the window, so a restored or synced transcript is not lost. A very old session touched today is read in full, but only its in-window events count.
- The transcript format is Claude Code's private format, built against version 2.1.274, and it may drift. `bun run stats` shows when it has.
- The norms come from two machines of one user working in auto mode, which makes them a starting point for a conversation about the metric rather than a study.
- The 98-column grid does not adapt to a narrow terminal.
- For the grid and the day a pipe always gets JSON, and there is no flag to ask for text instead.
- The card needs a browser engine: WebKit comes with macOS, elsewhere a Chromium browser (Chrome, Edge, Brave, Chromium) must be installed. `--out card.html` works everywhere.
- A window that includes today is a snapshot: today's entry in the JSON carries `asOf`, the tables end with `as of HH:MM`, and two runs minutes apart differ while Claude Code is still writing. Today's numbers cover everything up to `asOf` and nothing timestamped after it, even if it lands in the same run. `cogload status` writes that snapshot to a file for a status line.

## Under the hood

The formula behind the number and the transcript record behind every column, for when the number surprises you. For the whole path from a transcript line to the status line, with a diagram, read [How the numbers are made](how-the-numbers-are-made.md).

<details>
<summary><b>How the index works</b></summary>

Every hour that had activity gets six components normalized into `[0, 1]` and summed with integer weights:

```
parallel    = clamp((sessions - 1) / 4)                                   # 1 session → 0, 3 → 0.5, 5+ → 1
pace        = clamp(prompts / 20)                                         # 10 prompts/hour → 0.5, 20+ → 1
supervision = clamp((3 * decisions + reports + contextSwitches) / 45)     # 15 decisions alone → 1; 45 reports alone → 1
reading     = clamp(outputTokens / 80000)                                 # 40k → 0.5, 80k+ → 1
streak      = clamp(streakMin / 40)                                       # 20 min → 0.5, 40+ → 1
late        = lateNight ? 1 : 0

index = round(25*parallel + 15*pace + 30*supervision + 10*reading + 10*streak + 10*late)
```

`decisions` is the sum of interrupts, tool rejections, questions, plan reviews and permission-mode switches. Without the late-night flag the index tops out at 90. An hour with no activity has no index at all: it renders as `·` and is `null` in JSON.

| Level | Range |
|---|---|
| Calm | 0–29 |
| Warming | 30–59 |
| Heating | 60–84 |
| Fried | 85–100 |

The norms are the p90 of two weeks of real transcripts on two machines, 116 and 114 active hours. Why each one is what it is, and what surprised me in that data, is in [How the numbers are made](how-the-numbers-are-made.md#5-the-index).

Weights and norms live in one exported constant in `src/lib/metrics/score.ts`, so a recalibration is one diff there plus a line in `CHANGELOG.md`.

</details>

<details>
<summary><b>What each column of the day table counts</b></summary>

| Column | What it counts |
|---|---|
| `sess` | Distinct session ids with at least one user or assistant record in the hour. |
| `prompts` | Messages the human typed. A `user` record whose text is neither an interrupt marker nor an agent-message marker; `isMeta`, sidechain, `claude -p` and Agent SDK records are excluded. |
| `rep` | Inbound messages from subagents, other sessions and background tasks. A `user` record whose text starts with one of the agent-message markers, which is something to read and react to rather than something typed. |
| `intr` | Interrupts. A `user` record whose text block starts with `[Request interrupted by user`, covering both the plain and the tool-use form. |
| `rej` | Tool rejections. A `tool_result` block saying the user did not want to proceed with that tool use. |
| `quest` | `AskUserQuestion` tool calls in an assistant message, one per block. |
| `plan` | `ExitPlanMode` tool calls in an assistant message, one per block. |
| `mode` | Permission-mode switches. A `permission-mode` record whose mode differs from the previous one; the first record of a session sets the baseline and repeats of the same mode count nothing. |
| `ctx-sw` | Context switches. Over the hour's prompts in time order, the number of consecutive pairs that came from different sessions. |
| `streak` | Minutes of the longest presence streak the hour saw. Presence is every action you take: a prompt, an interrupt, a tool rejection, an answer to a question or a plan. A streak is a run of them no more than 10 minutes apart, across sessions, and it may reach back before the hour. Agent activity between two of your actions does not bridge a gap. |
| `out-tok` | Assistant output tokens, summed once per request and only for requests that produced a text block. Claude Code repeats the same usage on each content block of a response, and a request holding only tool calls is not text anyone reads. |

`bun run stats --days 14` is the tool the norms were set with. It prints the per-hour distribution of each signal over the active hours of a window (n, p50, p75, p90, max, and how many hours were zero), the top hours by reports and by human prompts, and a format-drift line comparing records seen against events the parser recognised. Run it on another machine, or after a Claude Code update, to see whether the norms and the parser still fit. It prints numbers and nothing else.

</details>

## A day from the fixture

The fixture's timestamps are UTC and cogload buckets by local time, so pin the zone to get these exact hours:

```bash
TZ=UTC bun src/cli/index.ts --projects tests/fixtures/busy-week --to 2026-09-20 --no-color
```

That prints the week grid in the README. One day of it, with the weighted parts behind each index:

```bash
TZ=UTC bun src/cli/index.ts 2026-09-14 --projects tests/fixtures/busy-week --explain --no-color
```

```
hour   index  level    sess  prompts  intr  rej  quest  plan  mode  ctx-sw  streak  out-tok  par  pace   sup  read  strk  late
09:00     15  Calm        1        6     0    0      0     0     0       0     50m      600    0   4.5     0   0.1    10     0
10:00     15  Calm        1        6     0    0      0     0     0       0    110m      600    0   4.5     0   0.1    10     0
11:00     15  Calm        1        7     0    0      0     0     0       0    179m      600    0   5.3     0   0.1    10     0
12:00     87  Fried       5       55    20    1      1     1     2      54    235m    55.0k   25    15    30   6.9    10     0
13:00     87  Fried       5       55    20    1      1     1     2      54    295m    55.0k   25    15    30   6.9    10     0
14:00     87  Fried       5       55    20    1      1     1     2      54    355m    55.0k   25    15    30   6.9    10     0
20:00     15  Calm        1        6     0    0      0     0     0       0     50m      600    0   4.5     0   0.1    10     0
21:00     15  Calm        1        6     0    0      0     0     0       0    110m      600    0   4.5     0   0.1    10     0
23:00     25  Calm        1        6     0    0      0     0     0       0     50m      600    0   4.5     0   0.1    10    10
  no reports today
```

The grid is a fixed 98 columns wide, its hour header included, and does not reflow, so it needs a terminal at least that wide.

## Development

```bash
git clone git@github.com:drakulavich/cogload.git
cd cogload
bun install
bun link
```

`bun link` registers the clone's `bin` entry, so `cogload` runs this checkout; without it, `bun src/cli/index.ts` does the same thing.

```bash
bun run check    # tsc --noEmit, then the test suite under TZ=UTC
```

Tests are fixture-driven: they build or load transcripts in the real Claude Code format and assert the statistics that come out of the public seams, `analyze()`, `report()` and the CLI itself. No test imports the parser, the deriver or the scanner, so refactoring internals never touches a test. The rules every change follows are in [CLAUDE.md](../CLAUDE.md), the design is in [docs/superpowers/specs/2026-09-17-zapara-design.md](superpowers/specs/2026-09-17-zapara-design.md), and every change is recorded in [CHANGELOG.md](../CHANGELOG.md).

No build step and no runtime dependency: Bun runs `src/cli/index.ts` from the package as it is.

## Install notes

`cogload` lands in Bun's global bin directory, `~/.bun/bin` unless `BUN_INSTALL_BIN` says otherwise; `bun pm bin -g` prints the one in force. Bun's own installer puts that directory on your PATH; a Homebrew Bun does not, so add it yourself.

Coming from zapara, run `bun remove -g @drakulavich/zapara` first: both packages claim the `zapara` command. cogload keeps that command until 1.0.0, and it prints one line on stderr saying it is now cogload. cogload starts over in `~/.claude/cogload/`, rebuilding its cache with one full scan; `~/.claude/zapara/` can be deleted once nothing runs zapara.

## Where it comes from

The question comes from Addy Osmani's [Your parallel Agent limit](https://addyosmani.com/blog/cognitive-parallel-agents/). More agents running does not make more of you available, because "your cognitive bandwidth doesn't parallelize", and the cost of the ones you are not looking at is what he calls the ambient anxiety tax: "the part of your mind that can't fully relax because it knows something might be silently going sideways in a thread you haven't checked in twenty minutes." His own ceiling is "somewhere around three to four threads depending on complexity", and his advice is to start with one thread less than feels right.

The index was calibrated before I read that, from the 90th percentile of two weeks on two machines, and it arrived at the same number: `NORMS.parallelSpan` in [src/lib/metrics/score.ts](../src/lib/metrics/score.ts) is 4, so the fifth session running at once spends all 25 points for parallel work.

The post and this tool disagree about what to watch. Osmani's signal is the quality of your own review: you have passed your ceiling when your confidence in what you are accepting starts dropping. A transcript cannot see that. It can see how much model output went past you, which is the `out-tok` column and ten of the hundred points, and it can see the shape of the hour around it. The index is a proxy with a known blind spot, and the number is worth something only next to your memory of the hour it scores.

Most of the advice in this area stops at fewer threads, smaller scope and more breaks, with few numbers you can hold yourself to. An hour with a score on it is at least something you can disagree with.

Until 0.10.0 the tool was called zapara, Russian slang for a crunch, which told an English reader nothing.
