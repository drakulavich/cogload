# zapara card: a shareable picture of your last two weeks

Extends `2026-09-17-zapara-design.md`. Everything not mentioned here stays as
that spec says.

## Purpose

`zapara card` turns a window of transcripts into one image a person wants to
send to a colleague: a character that names how they drive Claude Code, one
sentence with two numbers behind that name, the peak hour, a load spectrum,
three highlights, and the project's line. It exists to make the tool travel:
the week heatmap convinces the person who ran it, the card convinces the
person they show it to.

The card's privacy boundary is schedule and identity, not volume. It never
shows when the person worked (no dates, weekdays or clock hours, no heatmap),
how long they worked (no count or sum of active hours, no per-day totals), or
on what (no project, file, prompt or title: the base spec's contract). It
does show interaction volumes on purpose, because they are the traits the
card is about: the peak number of parallel sessions, the most context
switches in one hour, the longest unbroken streak, the sums of agent reports,
output tokens and interrupts, and the peak load. The one time-of-day number,
the share of late-night hours, appears only on the Night Owl's own card,
where it is the trait. Every number reads as an achievement, not as a
timesheet; a person should never want to hide their card from a manager or a
partner.

The card is a picture of numbers zapara already computes. It adds no new
signal, no new score, and no new data source.

## CLI

```
zapara card [--days N | --to <date> | --from <date> --to <date>] [--out PATH] [--json] [--projects DIR]
```

- The window flags are the grid's (base spec, CLI), with `--days` defaulting
  to 14 instead of 7.
- `--out` defaults to `zapara-card.png` in the current directory. The format
  is the extension: `.png` or `.webp` for the picture, `.html` for the page
  the picture is taken of (written as is, no browser involved, for checking
  the design). Any other extension is a usage error (exit 2). A value
  containing a control character (any code point below 0x20, or 0x7f) is a
  usage error too (exit 2, the message names the flag, not the value), so
  the `wrote …` line is always one line of plain text and can never carry a
  terminal escape. An existing file is overwritten: the person named it.
- `--json` prints the card's data (below) to stdout and writes no file.
- Without `--json`, stdout gets two lines: the character line
  (`The Conductor: 5 sessions at once, 54 context switches in one hour`) and
  `wrote zapara-card.png`, echoing `--out` exactly as given. No other path is
  ever printed.
- A window with no active hour prints `no activity in the last 14 days`
  (with the actual `--days`) to stderr, writes nothing, exits 1.
- When the picture cannot be rendered because no browser engine is available
  (see Rendering), stderr gets one line, `card needs a browser engine:
  install a Chromium browser such as Chrome or Edge, or write --out card.html`, exit 1. A render that
  does not finish within 15 seconds is `render timed out`, exit 1.
- When the file cannot be written (the directory does not exist, is not
  writable, is not a directory, or the file system is read-only), stderr
  gets one line, `cannot write the card: check the --out directory`, exit 1.
  The message names no path: the error the file system raises quotes the
  whole path, and the CLI never prints one.
- Colors and TTY detection do not apply: the card is the same everywhere.

Privacy amendment to the base spec: `card` is the one command that writes a
file. It writes exactly one file, at the path the person gave or the default in
the current directory, and prints that path back verbatim. It never writes
anywhere else and never prints a path it derived from the projects tree or
from its own install location. The page it renders is self-contained: no
network request is made while rendering, and the browser engine runs
headless with an ephemeral data store. The README's privacy section says "no
file is written except the card you ask for".

## Card data

From the `Day[]` of the window, over the buckets with a score ("active
hours"):

```
share.conductor  = Σ(parts.parallel + parts.pace)        / (40 · activeHours)
share.supervisor = Σ(parts.supervision + parts.reading)  / (40 · activeHours)
share.marathoner = Σ(parts.streak)                        / (10 · activeHours)
share.nightOwl   = Σ(parts.late)                          / (10 · activeHours)
```

Each share is the fraction of that character's maximum possible points the
window actually collected, so a 10-point component competes fairly with a
40-point one. The character is the largest share; ties break in the order
Conductor, Supervisor, Marathoner, Night Owl. With every share zero (possible
only for a window of lone single-event hours) the tie rule gives Conductor.

| Character | Name | Sentence (numbers from the window; bold spans marked with `**`) | Motto |
|---|---|---|---|
| conductor | The Conductor | `**{maxSessions} sessions** at once, **{maxContextSwitches} context switches** in one hour.` | `You run agents like an orchestra.` |
| supervisor | The Supervisor | `**{reports} agent reports** and **{outputTokens} tokens** of output read.` | `Nothing ships without your eyes on it.` |
| marathoner | The Marathoner | `Longest streak **{streak}** without a break, **{calmShare}%** of your hours calm.` | `You do not stop while it compiles.` |
| nightOwl | The Night Owl | `**{lateShare}%** of your hours **after midnight**.` | `The best commits happen after midnight.` |

Where `maxSessions` and `maxContextSwitches` are the window maxima over
buckets, `reports`, `outputTokens` and `interrupts` are window sums, `streak`
is the maximum `streakMin` over buckets, which is the window's longest
presence streak exactly: each bucket reports the longest streak it saw, a
streak is longest at its last event, and that event falls in one bucket.
`activeHours` is the count of
active buckets (used only as a divisor, never shown), `lateShare` is the
share of active buckets with `lateNight` in whole percent, `calmShare` the
share of active buckets at Calm, `days` the `--days` value. `CardData`
carries the sentence as segments, `{ text, strong }[]`, and the motto as a
separate string, so the page can set the bold spans without parsing anything;
the stdout character line and the JSON `sentence` are the segments joined,
without the motto.

Transcript-derived numbers have no upper bound, so every value on the card
goes through a compact format with a fixed longest form:

| Kind | Format | Longest form |
|---|---|---|
| count (`maxSessions`, `maxContextSwitches`, `reports`, `interrupts`) | as is under 10 000; then `12k` (integer thousands) under a million, `1.2M` (one decimal) under 10 M, `12M` under a billion, `1.2B` / `12B` likewise; `999B+` from 1000 B | `999B+` (5) |
| tokens (`outputTokens`) | as is under 1000; then the same ladder from `1k` | `999B+` (5) |
| streak (`streakMin`) | `48m` under an hour, `5h12m` under 10 h, `12h` (whole hours) under 1000 h, `999h+` from there | `999h+` (5) |
| percent (`lateShare`, `calmShare`, spectrum) | whole percent, 0 to 100 | `100%` (4) |
| index | 0 to 100 | `100` (3) |

With these bounds the longest sentence any character can produce is under
110 characters, and the longest highlight value is 5 characters, so the
layout in Picture is sized for the longest forms and nothing on the card can
overflow; the fit is verified by rendering, see Testing. A value the format
cannot represent (negative, `NaN`) cannot come out of `analyze()` and is
not handled.

**Peak**: the maximum index over active buckets and its level.

**Spectrum**: the share of active buckets at each level, four whole percents
that sum to 100 by largest-remainder rounding (a level with no hours is 0).

**Highlights**: three, chosen from this pool. Each has a key, a value string
and a one-line caption in sentence case that carries the unit. `norm` is the
value divided by its calibration norm, for ranking:

| Key | Value | Caption | norm |
|---|---|---|---|
| peakSessions | `{maxSessions}` | `sessions at once` | `(maxSessions − 1) / 4` |
| contextSwitches | `{maxContextSwitches}` | `switches in one hour` | `maxContextSwitches / 45` |
| longestStreak | `{streak}` | `longest streak` | `maxStreakMin / NORMS.streakMin (40)` |
| reportsRead | `{reports}` | `agent reports read` | `reports / (12 · activeHours)` |
| tokensRead | `{outputTokens}` | `tokens of output read` | `outputTokens / (65000 · activeHours)` |
| interrupts | `{interrupts}` | `times you stopped Claude` | `interrupts / (3 · activeHours)` |
| lateShare | `{lateShare}%` | `of hours after midnight` | `lateShare / 25` |

The first two highlights are the character's own pair, in this order: Conductor
`peakSessions, contextSwitches`; Supervisor `reportsRead, tokensRead`;
Marathoner `longestStreak, interrupts`; Night Owl `lateShare, longestStreak`.
The third is the remaining key with the largest `norm`; `lateShare` is
eligible as the third only for the Night Owl (a late-night number on someone
else's card is exactly the kind of thing they would hide). Ties keep the
table order. The first three norms in the table are the index's own
(`NORMS.parallelSpan`, `NORMS.supervisionPerHour`, `NORMS.streakMin`), so
recalibrating one of those in `src/score.ts` also changes which candidate wins
the third slot; the last four are the card's own `CARD_NORMS`, which rank
highlights on a picture and never enter the index.

Window label: `LAST {days} DAYS`. No dates appear on the card.

`--json` prints:

```json
{ "from": "2026-09-05", "to": "2026-09-18", "days": 14, "character": "conductor",
  "name": "The Conductor", "sentence": "6 sessions at once, 38 context switches in one hour.",
  "motto": "You run agents like an orchestra.",
  "shares": { "conductor": 0.61, "supervisor": 0.33, "marathoner": 0.52, "nightOwl": 0.06 },
  "peak": { "index": 89, "level": "Fried" },
  "spectrum": { "calm": 62, "warming": 25, "heating": 10, "fried": 3 },
  "highlights": [
    { "key": "peakSessions", "value": "6", "caption": "sessions at once" },
    { "key": "contextSwitches", "value": "38", "caption": "switches in one hour" },
    { "key": "longestStreak", "value": "5h35m", "caption": "longest streak" } ] }
```

Shares are rounded to two decimals in JSON only. `from` and `to` are added
by the CLI from the window, for scripts; they are not part of `CardData`, so
no date can reach the page.

## Picture

The card is an HTML page, 1200×630 CSS pixels, produced by a pure function
from the card data, and photographed by a headless browser engine that Bun
drives through `Bun.WebView` (WebKit on macOS, an installed Chrome
elsewhere). The output picture is always 2400×1260 pixels: the page is
loaded in a 2400×1260 viewport with `zoom: 2` on the root element, so the
engine lays the card out at twice its size and text is rendered at that
size rather than upscaled; the screenshot is then resized to exactly
2400×1260 with `Bun.Image` when the device pixel ratio made it larger. PNG
is the screenshot's own format; WebP is re-encoded from it with `Bun.Image`
at quality 90.

The page is self-contained. Fonts and character pictures are embedded as
`data:` URIs; the template contains no `http`, `https` or protocol-relative
reference, and a test guards that.

### Look

Raycast-like: a near-black card, a few blurred diagonal light streaks in
the character's accent behind the character, film grain over the whole
card, and one glass panel holding all the text. Type is Inter for the name,
the sentence and the numbers; every small label is JetBrains Mono.

| Element | Position and style (CSS px) |
|---|---|
| Background | `#07070a` |
| Streaks | a 900×1100 group at (−200, −260) rotated 38°, blurred 22 px, opacity 0.9: four vertical bars (widths 150, 70, 200, 90 at x = 120, 320, 440, 700, radius 40) with vertical gradients from transparent through the accent (peak alpha 0.9, 0.7, 0.35 with a cyan `#22d3ee` touch, 0.5) back to transparent; a radial vignette centred at (30 %, 40 %) fades everything to the background beyond 75 % |
| Grain | an SVG `feTurbulence` fractal-noise tile (300×300, base frequency 0.9, two octaves, alpha 0.6 through a colour matrix) as a repeating background over the whole card, opacity 0.35, blend mode overlay |
| Character | the character's crop of the sheet (see Characters), longer side 360 px, centred at (195, 300), drop shadow 0 30 40 at 70 % black |
| Panel | at (380, 56), 760×518, radius 20, 1-px border at 10 % white, fill a vertical gradient from 4.5 % to 2 % white, inner 1-px top highlight at 8 % white, shadow 0 30 80 at 50 % black, padding 36 px 40 px; everything below sits inside it, top to bottom |
| Label | JetBrains Mono 13 px, `#6b6b76`, uppercase, letter-spacing 0.5 px: `LAST 14 DAYS` (the day count from `--days`) |
| Peak pill | right end of the same row: JetBrains Mono 12 px uppercase `#6b6b76` in a pill (padding 6×12, radius 8, 1-px border at 10 % white, 3 % white fill): `PEAK HOUR` then `{index} · {LEVEL}` in the level colour, weight 500 |
| Name | 18 px below, Inter 700 76 px, letter-spacing −3 px, white, text shadow 0 0 40 at 18 % white |
| Sentence | 22 px below, Inter 400 22 px, line height 31, `#a1a1aa`, max width 660, the bold spans white Inter 600, the motto in the same paragraph |
| Divider | 30 px below, 1 px at 10 % white, 26 px of space after it |
| Spectrum bar | 8 px tall, radius 4, four segments in order calm, warming, heating, fried, widths in percent, 2-px gaps, segments of 0 % omitted |
| Legend | 14 px below the bar, JetBrains Mono 12.5 px `#6b6b76`: a 6-px dot, the percent in `#a1a1aa` weight 500, the level name, items separated by two spaces |
| Highlights | 30 px below, three equal panels with 16-px gaps: radius 12, 1-px border at 10 % white, 2.5 % white fill, inner top highlight, padding 18×16; value Inter 700 38 px, letter-spacing −1.6 px, tabular figures, white; caption 8 px below, JetBrains Mono 12 px `#6b6b76`, sentence case, one line (`sessions at once`, `switches in one hour`, `longest streak`, …) |
| Repo link | at (60, 566), two lines: JetBrains Mono 11 px uppercase `#6b6b76`, letter-spacing 1.5 px, `GET YOURS`; 8 px below, JetBrains Mono 500 17 px in the character's light accent, letter-spacing −0.2 px: `github.com/drakulavich/zapara` |
| Source line | right-aligned to x = 1140 at y = 588, JetBrains Mono 12 px `#a1a1aa`: `computed locally from your Claude Code transcripts · nothing leaves your machine` |

Level colours: calm `#7ee2a3`, warming `#fbd77a`, heating `#c4a0ff`, fried
`#ff6b8f`. Each character has an accent for the streaks and a light accent for
the repo link: Conductor `#8b5cf6` / `#c4b5fd`, Supervisor `#22d3ee` /
`#a5f3fc`, Marathoner `#f59e0b` / `#fde68a`, Night Owl `#60a5fa` / `#bfdbfe`.

The table is the complete description of the look; the template is written
from it. `docs/superpowers/specs/assets/2026-09-18-zapara-card-reference.webp`
is the owner-approved render of the design mock built from this table
(2400×1260, tracked by LFS), kept for comparing the implementation's output
by eye. It shows the Conductor with the `busy-week` peak and spectrum and
the Conductor's own highlights, not the `busy-week` card itself, which is
the Marathoner's. It is a reference, not an input: nothing
reads it.

### Characters

Four illustrations in one style, generated once by the owner as a single
sheet with a transparent background (Conductor top left, Supervisor top
right, Marathoner bottom left, Night Owl bottom right; they do not respect
exact quadrants), stored as `assets/characters.webp`: the sheet resized to
1024×1024, lossy WebP at quality 85 with alpha, about 200 KB, committed as
an ordinary file (not LFS) so a plain clone renders cards. The template
shows each character through a crop rectangle given in sheet fractions
`[x, y, w, h]`, a constant `CHARACTER_RECTS` in `src/cardhtml.ts` measured
on the current sheet (Conductor `[0.02, 0.01, 0.53, 0.543]`, Supervisor
`[0.55, 0.07, 0.38, 0.505]`, Marathoner `[0.02, 0.553, 0.50, 0.437]`, Night
Owl `[0.54, 0.585, 0.45, 0.41]`); the box is scaled so the rectangle's longer
side is 360 px, and centred at (195, 300), using CSS `background-size` and
`background-position`, so no cropping tool is involved anywhere.
`scripts/prepare-characters.ts` turns the source PNG into the WebP with
`Bun.Image` (resize to 1024, alpha kept) and is how it is regenerated when
the art changes; a new sheet means re-measuring the four rectangles. The
source PNG is not in the repository.

### Fonts

Inter 400, 700 and 800 and JetBrains Mono 500, Latin subsets as WOFF2, in
`assets/fonts/` with their SIL Open Font License texts, committed as ordinary
files (about 30 KB each). `scripts/fetch-fonts.ts` downloads them from pinned
URLs and checks pinned SHA-256 digests; it is how they are regenerated. The
template declares them with `@font-face` and `data:font/woff2;base64,` URIs.

## Architecture

Core (pure, no `node:`, no `Bun`, no clock), all taking plain data:

```
src/card.ts      cardData(days: Day[], w: { days: number }) → CardData | null   (null when no active hour)
                 CardData = { days, character, name, sentence: { text, strong }[], motto, shares,
                              peak, spectrum, highlights }: every string already formatted, every
                              selection already made; the only representation of the card
src/cardhtml.ts  cardHtml(card: CardData, assets: CardAssets) → string
                 CardAssets = { fonts: { inter400, inter700, inter800, mono500 }, characters: string }  (the sheet)
                 every field a base64 string; the function sees no Day, no date and no raw metric,
                 only CardData's formatted strings and numbers, and escapes nothing because nothing
                 from the transcripts reaches it
```

Shell:

```
src/image.ts     loadAssets() → Promise<CardAssets>      reads assets/fonts and assets/characters next to the source
                 renderCard(html: string, out: string) → Promise<void>
```

`loadAssets` reads the five files relative to `import.meta.dir`; a missing
or unreadable one is `assets missing: reinstall zapara` on stderr, exit 1,
with no path. `renderCard` writes the HTML as is when `out` ends in `.html`. Every write
goes through one helper that maps any failure to the `cannot write the card`
line above, so no path reaches stderr.
Otherwise it opens `new Bun.WebView({ width: 2400, height: 1260 })`,
navigates to a `data:text/html;charset=utf-8` URL of the page, waits until
`document.fonts.status` is `loaded` and every `<img>` reports `complete`
(polled through `evaluate`, 15-second budget), takes a PNG screenshot, resizes
it to 2400×1260 with `Bun.Image` when it is larger, re-encodes to WebP when
asked, writes the file, and closes the view (also on failure). A constructor
or navigation failure whose message says no browser is available becomes the
`card needs a browser engine` line.

`Bun.WebView` has been in Bun since April 2026 and `Bun.Image` since May
2026; `engines` says `>= 1.4.0`, which has both.

This is why the shell grows a fourth file: the base spec's Architecture
section and the CLAUDE.md shell rule are amended in the same change to list
`src/image.ts` as the only module that may use `Bun.WebView` or `Bun.Image`,
read the assets, or write a file.

`src/index.ts` gains the `card` command and its flags. `report()` is reused
unchanged; `card` never reads the projects tree itself.

## Testing

Same rules as the base spec: fixtures in the real transcript format, through
`analyze()` (for `cardData` and `cardHtml`) or the CLI; nothing imports
`parse`, `derive` or `scan`; every new test fails under a one-line mutation.
`cardHtml` tests get the real assets through the same loader the CLI uses,
handed in as data.

Scenarios:

- `busy-week` through `analyze()` then `cardData()` (window `--to
  2026-09-20 --days 14`, the default): the character and the full sentence with its numbers
  pinned; `peak` pinned; the spectrum pinned (22 active hours: 15 calm, 3
  warming, 1 heating, 3 fried → 68 / 14 / 4 / 14, and a test that the four
  numbers sum to 100); the three highlights pinned by key, value and caption
  (the fixture's long calm days make it the Marathoner, shares 0.31 / 0.19 /
  0.99 / 0.14: longestStreak `7h53m`, interrupts `70`, then contextSwitches
  `54` as the largest remaining norm, 1.2 against peakSessions' 1.0); the
  four shares pinned to two decimals. The Marathoner's share was 0.81 under
  the 0.2.0 streak norm of 120 minutes; at 40 every active hour but Friday's
  half storm caps, so it reads 0.99.
- One small fixture per character, each built so that one share clearly
  wins, pinning the character, the sentence's numbers and the two owned
  highlights. A tie fixture (two equal shares) pins the tie order. A fixture
  where `lateShare` has the largest remaining norm on a non-Night-Owl card
  pins that it is skipped for the third highlight.
- Spectrum rounding: a fixture whose raw shares are 33.3 / 33.3 / 33.3 / 0
  pins 34 / 33 / 33 / 0 (largest remainder).
- An empty window through `cardData()` is `null`.
- `cardHtml` on `busy-week`: the page contains the name and the sentence
  once each; the peak pill carries `87 · Fried` in the fried class; the
  spectrum bar has exactly four segments whose inline widths are `68%`,
  `14%`, `4%`, `14%`; three highlight panels in the pinned order; the
  character box carries the marathoner's class; the sheet and all four fonts
  are embedded as `data:` URIs; no `http:`, `https:` or `//` reference
  anywhere; no date string (`2026-`) anywhere in the page; the page's
  SHA-256 is pinned as a golden value with a comment naming the command that
  regenerates it (any change to the look has to be acknowledged in the test).
- Formats: a fixture whose window carries 12 345 sessions' worth of
  parallel session ids in one hour is not practical, so the format ladder is
  pinned through `cardData()` on a fixture with 1 200 storm replies carrying
  1 000 tokens each (`outputTokens` renders `1.2M`) and 10 000 prompts in
  the window (`reports` and switch counts render `10k`); the streak ladder
  through a fixture with one 11-hour streak (`11h`).
- Fit, rendered: for each character, `cardHtml` on a hand-built `CardData`
  holding every value's longest form (`999B+` counts and tokens, `999h+`
  streak, `100%` shares, the widest spectrum legend `100% / 100% / 100% /
  100%` is impossible so `25%` each, index `100`, `--days 90`) is loaded
  into a `Bun.WebView` and measured through `evaluate`: no element's
  `scrollWidth` exceeds its `clientWidth`, the sentence's height is at most
  three lines (93 px), every highlight value stays on one line, and the
  panel's content does not exceed its height. This is the only fit test;
  character counts are never used as a proxy for layout.
- CLI on the `busy-week` tree: `--out x.html` writes exactly the `cardHtml`
  string; `--json` prints the data and creates no file; an empty window
  exits 1 with the one-line message and no file; `--out x.gif` exits 2 with
  a usage line; `--out` with an embedded newline and `--out` with an ESC byte
  each exit 2, print one stderr line without the value, and create no file;
  stdout's second line is `wrote <exactly the --out given>`.
- CLI rendering and the fit test run only where a `Bun.WebView` can be
  constructed: the suite probes once; when the probe fails the tests skip,
  unless `ZAPARA_REQUIRE_WEBVIEW=1` is set, in which case they fail with
  the probe's message. `ci.yml` sets that variable, so the raster coverage
  cannot disappear silently after a runner image or Bun change (GitHub's
  Ubuntu runners ship Chrome today; the variable is what guarantees it is
  still there). `--out x.png` produces a file whose `Bun.Image` metadata
  is 2400×1260 PNG; `--out x.webp` a 2400×1260 WebP; both larger than
  20 KB.
- Assets: `loadAssets` on the checked-in files returns five non-empty
  base64 strings (four fonts and the sheet), and the sheet decodes to
  1024×1024 WebP through `Bun.Image`.

`tests/helpers` gains `webview.ts` (the one-time engine probe and
`openPage`); the character fixtures are composed from the existing
builders.

## README and repository

README gets a section `## Share a card` after `## What it looks like`: the
command, the two stdout lines, the card rendered from `busy-week`
(`assets/card.webp`, 2400×1260, a plain file like `characters.webp` so clones do
not spend the LFS bandwidth quota on it; `.gitattributes` tracks
`docs/superpowers/specs/assets/*.webp` by LFS), and one line saying the picture
needs macOS or an installed Chromium browser (Chrome, Edge), while `--out card.html` works
anywhere. CHANGELOG under Unreleased/Added. The demo screencast stays as it
is.

## Later

Not in this change: a `--theme light`, a card for `day`, custom text, or
posting anywhere. If people share the card, the next thing to consider is a
tiny caption they can edit; until then the card says only what the data says.
