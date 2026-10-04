<h1 align="center">zapara</h1>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
  <a href="https://www.npmjs.com/package/@drakulavich/zapara"><img src="https://img.shields.io/npm/v/@drakulavich/zapara?logo=npm&color=cb3837" alt="npm"></a>
</p>

<p align="center"><b>How hard was today?</b> zapara reads the transcripts Claude Code already writes on your machine and scores every hour 0–100 from parallel sessions, prompt pace, agent supervision, model output, streak length and late-night work. Nothing leaves the machine, no message text is kept.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/drakulavich/zapara/main/assets/demo.webp" alt="zapara demo: week heatmap, day table, JSON" width="800">
</p>

Claude Code writes a JSONL transcript for every session under `~/.claude/projects`. zapara reads those files, puts each record in the local hour it happened in, and turns the hour into one number. A week is a heatmap of seven rows by 24 cells; a day is a table with one row per hour and, with `--explain`, the weighted contribution of each component.

## Quick start

```bash
# Skip this if you already have Bun 1.4.2 or newer
curl -fsSL https://bun.sh/install | bash

# Run it once, without installing
bunx @drakulavich/zapara@latest
```

To keep it, install it with Bun. The same command upgrades it later.

```bash
bun add -g @drakulavich/zapara
```

`zapara` lands in Bun's global bin directory, `~/.bun/bin` unless `BUN_INSTALL_BIN` says otherwise; `bun pm bin -g` prints the one in force. Bun's own installer puts that directory on your PATH; a Homebrew Bun does not, so add it yourself. Then:

```bash
zapara                      # the last 7 days
zapara yesterday --explain  # one day, with the components behind each index
zapara card                 # the picture
```

No build step and no runtime dependency: Bun runs `src/cli/index.ts` from the package as it is.

## What it looks like

The week below, and the day behind the fold under it, come from the synthetic fixture in `tests/fixtures/busy-week`: a calm morning of one session, a five-session storm in the middle of the day, and a late tail that runs past midnight.

```
            00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23   peak  active
Mon 14/09    ·  ·  ·  ·  ·  ·  ·  ·  ·  ░  ░  ░  █  █  █  ·  ·  ·  ·  ·  ░  ░  ·  ░     87    8h50
Tue 15/09    ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ░  ░  ░  ░  ▒  ▒  ▒  ░  ·  ·  ·  ·  ·  ·     33    7h55
Wed 16/09    ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·      -    0h00
Thu 17/09    ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ░  ░  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·     15    1h55
Fri 18/09    ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ▓  ·  ·  ·  ·  ·  ·  ·  ·     81    0h35
Sat 19/09    ░  ░  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·     25    1h55
Sun 20/09    ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·      -    0h00

  ░ calm   ▒ warming   ▓ heating   █ fried
  21h10 active   323 prompts   0 reports   86 decisions   5 sessions at once
```

<details>
<summary><b>Monday hour by hour, and the commands that print both</b></summary>

The fixture's timestamps are UTC and zapara buckets by local time, so pin the zone to get these exact hours:

```bash
TZ=UTC bun src/cli/index.ts --projects tests/fixtures/busy-week --to 2026-09-20 --no-color
```

That prints the grid above. One day of it, with the weighted parts behind each index:

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

</details>

## Share a card

`zapara card` turns your last two weeks into one picture: a character named after the kind of load that dominates your hours, the sentence behind it, the peak hour, the share of calm, warming, heating and fried hours, and up to three highlights. It carries no dates and no hour totals, so it does not read as a timesheet.

```bash
zapara card                    # writes zapara-card.png to ~/Downloads
zapara card --out card.webp    # WebP instead; --out card.html writes the page itself
```

In a terminal it then asks `open it? [Y/n]`: Enter opens the picture in the default viewer, where ⌘C copies it for a chat. A pipe or a script is never asked.

```
The Marathoner: Longest streak 7h53m without a break, 68% of your hours calm.
wrote zapara-card.png to Downloads
open it? [Y/n]
```

<p align="center"><img src="https://raw.githubusercontent.com/drakulavich/zapara/main/assets/card.webp" alt="zapara card: The Marathoner, longest streak 7h53m, 68% of hours calm" width="800"></p>

This one comes from the same `busy-week` fixture as the pictures above. A headless browser that Bun drives takes the picture: WebKit on macOS, an installed Chromium browser (Chrome, Edge, Brave, Chromium) elsewhere. On Linux or Windows, install one or write `--out card.html` and open the page in any browser.

If your card told you something about your week, star [the repository](https://github.com/drakulavich/zapara) so other people can find zapara.

## Usage

| Command | What it does |
|---|---|
| `zapara` | The last 7 days ending today, one cell per hour, in local time. |
| `zapara --days 30` | The last 30 days. `--days` takes an integer from 1 to 90. |
| `zapara --from 2026-09-01 --to 2026-09-14` | Any window, both days inclusive, at most 90 days. `--to` alone is 7 days ending there, `--days 30 --to 2026-09-14` is 30 days ending there. |
| `zapara today` | Today, one row per hour that had activity. `yesterday` likewise. |
| `zapara 2026-09-14 --explain` | One day, with the six weighted components behind each index. |
| `zapara card` | The last 14 days as one shareable picture, `zapara-card.png` in `~/Downloads`. |
| `zapara card --days 30 --out me.webp` | Any window from 1 to 90 days; `.png`, `.webp` or `.html` by extension. `--json` prints the card's data instead. |
| `zapara status` | Writes today's load to `~/.claude/zapara/status.json` for a status line to read, and prints the same line. See [Status line](#status-line). |

| Flag | What it does |
|---|---|
| `--days <N>`, `--from <date>`, `--to <date>` | The window. A date is `YYYY-MM-DD`, `today` or `yesterday`. `--days=30` works as well as `--days 30`. |
| `--explain` | With a day: the six weighted parts behind each index. |
| `--json` | Print the whole window as one JSON document instead of a table. |
| `--projects <dir>` | Read this directory instead of `~/.claude/projects`. |
| `--out <path>` | Where `card` writes instead of `~/Downloads`; the extension picks the format. |
| `--no-color` | Plain glyphs and peaks with no ANSI codes. `NO_COLOR` in the environment does the same. |
| `--no-cache` | Read and parse every transcript again instead of using `~/.claude/zapara/cache.db`. |
| `--verbose` | After the output, prints to stderr where the time went: files scanned and read, megabytes, cache hits and misses (or `off` with `--no-cache`, or when the cache could not be opened or read, including an empty `HOME`), and milliseconds for each step in the order it ran: starting Bun and loading zapara, opening the cache, scanning, looking files up in the cache, reading the files it missed, analysis, saving to the cache, the card's render, and the status file's write. The rows add up to the total within a few milliseconds. It also prints the zapara and Bun versions, platform and CPU count. Numbers only, no path, so the lines are safe to paste into an issue when zapara is slow on your machine. |
| `-h`, `--help` | Usage, exit 0. |
| `-V`, `--version` | The version from `package.json`, exit 0. |

Levels: calm 0–29, warming 30–59, heating 60–84, fried 85–100.

The grid and the day print a text table when stdout is a terminal and JSON otherwise, so `zapara | cat` prints JSON; no flag forces text in a pipe yet. `card` and `status` write their file and print their lines whether piped or not. `card` asks to open the picture only when stdin and stdout are both a terminal, and never on Windows. While the browser engine draws a picture, a terminal's stderr shows `drawing the card…`, cleared before the result. `card --json` is the exception: it prints the card's data and writes no file, so `--out` with it is a usage error. `--json` changes nothing for `status`, whose line is already JSON and whose file is written either way.

A run that works exits 0, and so does a window with no data, which prints an empty grid. Exit 1 is a failure zapara can name, printed as one line to stderr that never contains a path: the projects directory missing or unreadable, `status` unable to write its file, `card` unable to write its picture or to find a browser engine, `card` without `--out` on a machine with no `~/Downloads` folder, `card` over a window with no activity (`card --json` prints `null` and exits 0 instead), and whatever else goes wrong below the command line. Exit 2 is a usage error, such as a bad date, an unknown flag or a value flag given twice; it prints one line and a hint to `--help`.

## Status line

A status line wants one number every thirty seconds and cannot wait half a second for a transcript scan, so zapara writes the number down and the status line reads it back. `zapara status` computes today exactly as `zapara today` does, writes it as one line of JSON to `~/.claude/zapara/status.json`, and prints the same line. Only `--projects`, `--no-cache` and `--verbose` apply, `--json` and `--no-color` change nothing, and the window flags, `--explain` and `--out` are usage errors. There is one file per user, whatever `--projects` said, created with mode `0600` in a directory with mode `0700`; the write goes to a temporary file and is renamed into place, so a reader sees the old line or the new one and never half of one. The file holds the nine values below and nothing else: no path, no project, no session count, no text.

```json
{"schema":1,"asOf":"2026-09-19T12:30:38.300Z","date":"2026-09-19","hour":15,"index":36,"level":"Warming","peak":41,"activeMin":555,"streakMin":166}
```

| Field | Meaning |
|---|---|
| `schema` | The shape of this file: `1`. A reader that sees a number it does not know shows nothing. It changes only when a field changes meaning or goes away; adding a field does not bump it. A field that keeps its name, unit and range but is measured differently (the presence rule of 2026-09-19 for `activeMin` and `streakMin`) does not bump it either: a reader shows the corrected number, and the change is a CHANGELOG entry. |
| `asOf` | When the snapshot was taken, ISO 8601 UTC: the `Day.asOf` of the base spec, the `now` of this run. A reader decides staleness from this field, never from the file's mtime. |
| `date` | The local calendar day the numbers describe, `YYYY-MM-DD`. |
| `hour` | The local hour that contains `asOf`, `0`..`23`. |
| `index` | The load index of the sixty minutes ending at `asOf`, `0`..`100`, or `null` when they hold no session. It does not reset at an hour boundary: the hour buckets of `zapara today` are calendar hours, this one is the clock's last hour. |
| `level` | That index's level, `Calm`, `Warming`, `Heating` or `Fried`, or `null` with `index`. A reader colors by this field so it never needs the thresholds. |
| `peak` | The day's peak index so far, including the last sixty minutes, so it is never below `index`; `null` on a day with no activity. |
| `activeMin` | Minutes of your presence in the day so far: the 5-minute slots covered by your actions and the gaps of at most 10 minutes between them; `0` on a day with no action of yours. |
| `streakMin` | Minutes of your live presence streak as of `asOf`: from the streak's first action to `asOf`, when your last action is no more than 10 minutes before `asOf`; `0` once you have been away longer. It keeps growing while you sit there, and it does not reset at an hour boundary. |

Refreshing is the reader's job, and zapara adds no hook, no timer and no daemon. A reader that finds the file stale or missing starts `zapara status` detached and draws what it has, which is also how the file first comes to exist on a machine that never ran zapara. The rest of the contract, from strict decoding to concurrent runs, is in [the status file spec](docs/superpowers/specs/2026-09-19-zapara-status-file-design.md). The `cognitive-load` plugin below reads it another way: it runs `zapara status` itself, after every turn and once a minute, and reads the line it prints.

## Inside Claude Code

The `cognitive-load` plugin draws the same number above the Claude Code prompt:

```
▓ Heating 68 · peak 81 · streak 2h40 · active 6h15
```

Install it from this repository's marketplace, in Claude Code:

```
/plugin marketplace add drakulavich/zapara
/plugin install cognitive-load@zapara
```

The plugin runs `zapara status` when a session starts and after every turn, and reads the load again every minute: from the reading another session of the plugin took less than a minute ago, or from a new run. So `zapara` has to be on the `PATH` Claude Code was started with; a Homebrew Bun leaves `~/.bun/bin` off it. The band is coloured by level, keeps only `▓ Heating 68` when it is under 50 columns wide, and is not drawn when the last sixty minutes are calm or hold no session. When a run fails, the band keeps the last good reading, or stays away if there is none, and the reason goes to Claude Code's debug log (`claude --debug`) as one of `not found`, `exit <code>`, `timeout` or `bad line`. The plugin is not part of the npm package; [its spec](docs/superpowers/specs/2026-10-03-zapara-cognitive-load-plugin-design.md) has the rest.

The plugin also makes you rest. When a reading shows a presence streak of 40 minutes or a Fried hour, it holds every prompt you send, typed, queued or from a link in the transcript, in every session that runs it, for ten minutes: `Rest until 14:32 (7 min). Start with "override: <reason>" to go on.` The rest can start while you read, and the band counts it down, `rest until 14:32 (7 min)`. Ten minutes without a prompt is the gap that ends a streak in zapara, so the next one starts at zero. A streak makes you rest once. A first line `override: <reason>`, the reason at least three words, lifts it until that streak ends and sends what follows it; the band then counts `overrides this week`, and `/overrides` lists the last 14 days with their reasons, for the week's review. Answers to Claude's questions, slash commands, a running turn, and prompts from notifications, other sessions or scheduled tasks are never held. [The rest's spec](docs/superpowers/specs/2026-10-04-zapara-forced-rest-design.md) has the details.

## Privacy

zapara reads `~/.claude/projects/**/*.jsonl`, skipping subagent transcripts under `subagents/`. It follows no symlink inside that directory, so a project directory that is a symlink is not read; `--projects` itself may be one. It picks files by modification time first, and opens one whose modification time is older than the window only to read the last timestamp in its final 64 KB; nothing from that tail is kept or printed. It compares message text against a few fixed markers, for interrupts, tool rejections and inbound agent messages, then discards it. What survives into an event is a timestamp, a session id, an event kind and a token count.

zapara keeps, writes and prints no message text, prompt length, file path or session title. The CLI never prints a path it derived or read, not even the projects root when it cannot open it. It sends nothing anywhere, installs nothing into Claude Code, and writes no file except the card, the status file and the cache below. The optional `cognitive-load` plugin runs `zapara status` and keeps the nine values of its line in the session's state; it reads no transcript or tool call and never keeps or logs what the command printed. It reads the prompts you type only to hold them during a rest and to find an `override:` line. Its own store, a JSON file under Claude Code's configuration directory, keeps when the current rest ends, when the last resting streak began, and the time and reason of each override for 14 days; the reason is the only text it keeps. While it draws a PNG or WebP, the card's page also sits in the temporary directory as a `0600` file, removed when the render ends.

Between runs, zapara caches each transcript's parsed events in `~/.claude/zapara/cache.db`. A hit still reads the last 4 KiB of the file to confirm it matches the cached row, then skips reading and parsing the rest. So a changed file is recognised by its size, modification time and last 4 KiB: an edit earlier in the file that keeps its size and modification time is not seen, and `--no-cache` parses everything again. A row is keyed by the transcript's device and inode, never by its path or a hash of it. Besides the device and inode, a row stores a fingerprint of the parser that wrote it, the file's size and modification time, a hash of its last 4 KiB, the cutoff its events were parsed with, when the row was last used, and the parsed events themselves. No message text, prompt length, path or title is stored. `--no-cache` runs without reading or writing it.

## Limits

- Time is local and buckets are whole hours, so an hour that straddles midnight or a daylight-saving change is bucketed by the local clock. On a fall-back day two wall-clock hours share one label and merge, so that bucket can hold up to 120 active minutes and the day up to 1500.
- zapara reads only Claude Code transcripts. Work in other tools, and time away from the keyboard, is invisible.
- A file whose modification time is older than the window is still read when the last timestamp in it falls inside the window, so a restored or synced transcript is not lost. A very old session touched today is read in full, but only its in-window events count.
- The transcript format is Claude Code's private format, built against version 2.1.274, and it may drift. `bun run stats` shows when it has.
- The norms come from two machines of one user working in auto mode, which makes them a starting point for a conversation about the metric rather than a study.
- The 98-column grid does not adapt to a narrow terminal.
- For the grid and the day a pipe always gets JSON, and there is no flag to ask for text instead.
- The card needs a browser engine: WebKit comes with macOS, elsewhere a Chromium browser (Chrome, Edge, Brave, Chromium) must be installed. `--out card.html` works everywhere.
- A window that includes today is a snapshot: today's entry in the JSON carries `asOf`, the tables end with `as of HH:MM`, and two runs minutes apart differ while Claude Code is still writing. Today's numbers cover everything up to `asOf` and nothing timestamped after it, even if it lands in the same run. `zapara status` writes that snapshot to a file for a status line.

## Under the hood

The formula behind the number and the transcript record behind every column, for when the number surprises you. For the whole path from a transcript line to the status line, with a diagram, read [How the numbers are made](docs/how-the-numbers-are-made.md).

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

The norms are the p90 of two weeks of real transcripts on two machines, 116 and 114 active hours. Why each one is what it is, and what surprised me in that data, is in [How the numbers are made](docs/how-the-numbers-are-made.md#5-the-index).

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

## Development

```bash
git clone git@github.com:drakulavich/zapara.git
cd zapara
bun install
bun link
```

`bun link` registers the clone's `bin` entry, so `zapara` runs this checkout; without it, `bun src/cli/index.ts` does the same thing.

```bash
bun run check    # tsc --noEmit, then the test suite under TZ=UTC
```

Tests are fixture-driven: they build or load transcripts in the real Claude Code format and assert the statistics that come out of the public seams, `analyze()`, `report()` and the CLI itself. No test imports the parser, the deriver or the scanner, so refactoring internals never touches a test. The rules every change follows are in [CLAUDE.md](CLAUDE.md), the design is in [docs/superpowers/specs/2026-09-17-zapara-design.md](docs/superpowers/specs/2026-09-17-zapara-design.md), and every change is recorded in [CHANGELOG.md](CHANGELOG.md).

## Where it comes from

The question comes from Addy Osmani's [Your parallel Agent limit](https://addyosmani.com/blog/cognitive-parallel-agents/). More agents running does not make more of you available, because "your cognitive bandwidth doesn't parallelize", and the cost of the ones you are not looking at is what he calls the ambient anxiety tax: "the part of your mind that can't fully relax because it knows something might be silently going sideways in a thread you haven't checked in twenty minutes." His own ceiling is "somewhere around three to four threads depending on complexity", and his advice is to start with one thread less than feels right.

The index was calibrated before I read that, from the 90th percentile of two weeks on two machines, and it arrived at the same number: `NORMS.parallelSpan` in [src/lib/metrics/score.ts](src/lib/metrics/score.ts) is 4, so the fifth session running at once spends all 25 points for parallel work.

The post and this tool disagree about what to watch. Osmani's signal is the quality of your own review: you have passed your ceiling when your confidence in what you are accepting starts dropping. A transcript cannot see that. It can see how much model output went past you, which is the `out-tok` column and ten of the hundred points, and it can see the shape of the hour around it. The index is a proxy with a known blind spot, and the number is worth something only next to your memory of the hour it scores.

Most of the advice in this area stops at fewer threads, smaller scope and more breaks, with few numbers you can hold yourself to. An hour with a score on it is at least something you can disagree with.

---

<p align="center">Made with ❤️ and 🥤 energy under <a href="LICENSE">MIT License</a></p>
