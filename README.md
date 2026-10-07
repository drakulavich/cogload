<h1 align="center">cogload</h1>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun"></a>
  <a href="https://www.npmjs.com/package/@drakulavich/cogload"><img src="https://img.shields.io/npm/v/@drakulavich/cogload?logo=npm&color=cb3837" alt="npm"></a>
</p>

<p align="center"><b>How hard was today?</b> cogload reads the transcripts Claude Code already writes on your machine and scores every hour 0–100 from parallel sessions, prompt pace, agent supervision, model output, streak length and late-night work. Nothing leaves the machine, no message text is kept.</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/drakulavich/cogload/main/assets/plugin.webp" alt="The cognitive-load plugin in Claude Code: a rest holds a prompt, a skip lifts it, /cogload names what drives the hour" width="800">
</p>

## Install

Run these in a terminal, or paste this repository's link into Claude Code and ask it to install cogload.

> **For an AI agent installing cogload:** run the block below top to bottom, skipping the Bun step if `bun --version` prints 1.4.2 or newer. Each command is safe to rerun. Then ask the user to restart Claude Code so the plugin loads.

```bash
# Bun 1.4.2 or newer; skip if `bun --version` already prints one
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# The CLI; the same command upgrades it
bun add -g @drakulavich/cogload
cogload --version

# The cognitive-load plugin for Claude Code
claude plugin marketplace add drakulavich/cogload
claude plugin install cognitive-load@cogload
```

Restart Claude Code to load the plugin. With a Homebrew Bun, put `~/.bun/bin` on your `PATH` yourself. To try the CLI without installing it, run `bunx @drakulavich/cogload@latest`.

```bash
cogload                      # the last 7 days
cogload yesterday --explain  # one day, with the components behind each index
cogload card                 # the picture
```

## What it looks like

A week from the synthetic fixture in `tests/fixtures/busy-week`: a calm morning of one session, a five-session storm in the middle of the day, and a late tail that runs past midnight.

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

Levels: calm 0–29, warming 30–59, heating 60–84, fried 85–100.

## Share a card

`cogload card` turns your last two weeks into one picture: a character named after the kind of load that dominates your hours, the sentence behind it, the peak hour, the share of calm, warming, heating and fried hours, and up to three highlights. It carries no dates and no hour totals, so it does not read as a timesheet.

```bash
cogload card                    # writes cogload-card.png to ~/Downloads
cogload card --out card.webp    # WebP instead; --out card.html writes the page itself
```

<p align="center"><img src="https://raw.githubusercontent.com/drakulavich/cogload/main/assets/card.webp" alt="cogload card: The Marathoner, longest streak 7h53m, 68% of hours calm" width="800"></p>

macOS draws it with WebKit; elsewhere it needs an installed Chromium browser, or write `--out card.html` and open the page in any browser.

If your card told you something about your week, star [the repository](https://github.com/drakulavich/cogload) so other people can find cogload.

## Inside Claude Code

The `cognitive-load` plugin draws the last hour's level above the prompt, with the time your rest starts, and `/cogload` says what drives it:

```
● Heating · rest at 14:52
```

```
Heating 80 this hour, at the cap: 16 decisions and 13 context switches, 32 prompts, a 57m streak.
This week: 1 rest taken, 1 skipped (last: "prod is down, fixing it").
```

It also makes you rest. After 40 minutes of work without a ten-minute gap, or in a Fried hour, it holds your prompts for ten minutes. Each prompt you send then gets a short idea for the break, the minutes left and the way out: a line `skip: <reason>` at the start or the end of the prompt, the reason three words or more.

## Privacy

cogload reads `~/.claude/projects` on your machine and sends nothing anywhere. It keeps, writes and prints no message text, prompt length, file path or session title: what survives from a transcript is timestamps, session ids, event kinds and token counts. The plugin keeps one piece of text, the reason you give for an override. [The reference](docs/reference.md#privacy) lists every file cogload and the plugin write.

## More

- [Reference](docs/reference.md): every command and flag, exit codes, the plugin and its rest in full, privacy and the cache, limits, the formula and what each column counts, development, and where cogload comes from.
- [How the numbers are made](docs/how-the-numbers-are-made.md): the path from a transcript line to the status line.
- [Changelog](CHANGELOG.md).

---

<p align="center">Made with ❤️ and 🥤 energy under <a href="LICENSE">MIT License</a></p>
