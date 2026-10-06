# zapara card: to Downloads, then offer to open it

Extends `2026-09-18-zapara-card-design.md`. Everything not mentioned here stays
as that says.

## The problem

`zapara card` writes `zapara-card.png` into the current directory. The person
running it is usually standing in a repository, so the picture lands next to
source code, shows up in `git status` and can end up in a commit. And the
file is not the goal: people run `card` to look at the picture or to paste it
somewhere. Today that takes remembering where the file went, opening it, and
copying it; the README carries an `osascript` one-liner for the last step.

## Behavior

```
$ zapara card
The Marathoner: Longest streak 7h53m without a break, 68% of your hours calm.
wrote zapara-card.png to Downloads
open it? [Y/n]
```

Where the card goes:

- Without `--out`, the card is written to `zapara-card.png` in the
  `Downloads` directory of the home directory (`homedir()`), on every
  platform. `XDG_DOWNLOAD_DIR` is not consulted: it usually lives in
  `~/.config/user-dirs.dirs`, not the environment, and half-support is worse
  than none. An existing file is overwritten: the card is a picture to share,
  not a record to keep, and `zapara` itself is the history.
- When that directory does not exist (or is not a directory), zapara does not
  create it: stderr gets one line, `no Downloads folder: pass --out <path>`,
  exit 1, nothing written. A machine without a Downloads folder is a machine
  where the person wants to say where the file goes.
- When the card cannot be written there (Downloads is not writable, or a
  directory sits at `zapara-card.png`), stderr gets one line, `cannot write
  zapara-card.png to Downloads: pass --out <path>`, exit 1. The card spec's
  `check the --out directory` would name a flag the person never used.
- `--out` is unchanged: a relative path is relative to the current directory,
  the extension picks the format, the value is echoed verbatim.

What it prints:

- The second stdout line is `wrote zapara-card.png to Downloads` for the
  default: the directory's name, never its path, since the base spec forbids
  printing a path the CLI derived. With `--out` it is `wrote <file name>`, the
  last segment of the person's argument (#155).

Offering to open it:

- After the file is written, and only when both stdin and stdout are
  terminals and the platform is not Windows, zapara writes `open it? [Y/n] ` to stdout (no newline) and reads
  one line from stdin. Input typed before the question, such as an Enter
  pressed while the card was drawn, is discarded first (`tcflush` through
  libc, where it can be loaded), so only a key pressed after the question
  answers it.
- An empty line, `y` or `yes` (any case, surrounding whitespace ignored)
  opens the file: `open <file>` on macOS, `xdg-open <file>` elsewhere, where
  `<file>` is the written path made absolute (`resolve()`), so an `--out`
  such as `-card.html` reaches the opener as a file and never as an option.
  The opener is started in the background through `sh -c 'trap "" HUP; "$0" "$@" </dev/null >/dev/null 2>&1 &'`
  and not waited for. The opener ignores SIGHUP: when zapara itself leads
  the terminal's session (`ssh -t host zapara card`, a test's
  pseudo-terminal), its exit hangs up the terminal and would kill the
  opener before it shows anything. zapara exits 0 whether or not the opener exists or succeeds:
  the card is written, which is what the command promised.
- Any other answer, or end of input, exits 0 without opening.
- When stdin or stdout is not a terminal (a pipe, a script, CI, the test
  suite) there is no question, no read from stdin and nothing is opened.
- Windows gets no question: it has no `sh` to start the opener through and
  CI does not run there, so an opener there would be code nobody ran. The
  card is written and the run ends as in a pipe.
- It applies to every format: `--out card.html` opens the page in the
  default browser.
- `--json` writes no file, so it asks nothing.
- No flag is added. The question is the control: a person who does not want
  a window answers `n`, and a script never sees the question.

This replaces the card spec's "Colors and TTY detection do not apply": TTY
detection now decides the question, and nothing else. The picture is still
the same everywhere.

## Privacy amendment

The card spec's amendment becomes: `card` writes exactly one file, at the path
the person gave or at `zapara-card.png` in the home directory's `Downloads`
folder, and prints back the path the person gave or the words
`zapara-card.png to Downloads`. It never writes anywhere else. Opening the
file hands its path to the platform's opener, a program on the machine; no
network request is made and nothing is printed.

## Code

- `src/index.ts`: the default `--out` becomes the Downloads path; `card()`
  checks the directory before rendering, prints the `wrote` line, asks the
  question when both streams are terminals, and calls `openCard`.
- `src/image.ts`: `openCard(path)` starts the opener through `sh`. The
  `Bun.spawn` `detached` + `unref()` route is not used: a child started that
  way dies when the parent exits first (seen in pult, 2026-09-19).
- `CLAUDE.md`: the rule listing the shell files says `src/image.ts` is also
  the one file that may start another program.
- README (Share a card, the command table, `--out`, errors, privacy), `--help`
  and a CHANGELOG line under Unreleased. The `osascript` clipboard example
  goes: the opened picture is copied with ⌘C.

## Testing

In `tests/shell/card-cli.test.ts`, with `HOME` set to a temporary directory.
Without a terminal (the child's stdin and stdout pipes):

- the default card lands in `$HOME/Downloads/zapara-card.png`, and the
  current directory stays empty;
- stdout says `wrote zapara-card.png to Downloads` and contains no `/`;
- without `$HOME/Downloads`, exit 1, the one stderr line, no path, no file;
- in a pipe there is no `open it?` on stdout and the run finishes with stdin
  held open, so it never waits for an answer.

In a terminal: the child runs in a pseudo-terminal through `Bun.spawn`'s
`terminal` option, with a directory first on `PATH` that holds fake `open`
and `xdg-open` scripts appending their arguments to a log file. No test seam
is added to shipped code.

- an empty answer and `y` each open the card once, with its absolute path;
- `n` and end of input (^D) print the question, exit 0 and open nothing;
- `--out=-card.html` answered with `y` opens the absolute path of
  `-card.html`, never the bare `-card.html`.

Opening happens in the background, so a test waits for a logged line (up to
2 s: macOS checks a freshly written executable for about 400 ms before it
runs) and a test expecting no open waits for the child to exit and then
checks the log stays empty. Each test must fail under a one-line mutation of
what it pins.
