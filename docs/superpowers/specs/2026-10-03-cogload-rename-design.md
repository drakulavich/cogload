# zapara becomes cogload

Everything not mentioned here stays as the earlier specs say. Their file
names keep `zapara`; they are a record.

## Purpose

`zapara` is Russian slang for a crunch. To an English reader it says nothing
and is hard to search for. `cogload` reads as "cognitive load", which is what
the tool measures. On 2026-10-03 it was free as an npm name, absent from
Homebrew, and the 31 GitHub repositories with it in their name were research
code with at most 3 stars, none about Claude Code.

## Names

| Thing | Now | After |
|---|---|---|
| GitHub repository | `drakulavich/zapara` | `drakulavich/cogload` |
| npm package | `@drakulavich/zapara` | `@drakulavich/cogload` |
| Command | `zapara` | `cogload` |
| Data directory | `~/.claude/zapara/` | `~/.claude/cogload/` |
| Card file | `zapara-card.png` | `cogload-card.png` |
| Message prefix | `zapara: …` | `cogload: …` |
| Plugin marketplace | `zapara` | `cogload` |
| Plugin | `cognitive-load` 0.1.0 runs `zapara status` | `cognitive-load` 0.2.0 runs `cogload status` |

The plugin keeps its name: `/plugin install cognitive-load@cogload` reads
well. The status file's format and `schema` 1 do not change; only its
directory does.

## No migration

The first `cogload` run finds no `~/.claude/cogload/` and starts from
nothing: the cache is rebuilt by one full scan, and the status file is
written by the first `cogload status`. `~/.claude/zapara/` is left as it
is. The README says it can be deleted once the person no longer runs zapara.

There is no `zapara` alias command and no last zapara release. The old
package gets `npm deprecate @drakulavich/zapara "renamed to
@drakulavich/cogload"`; its installs keep working until removed.

GitHub redirects the old repository name, so existing clones, the
`drakulavich/zapara` marketplace URL and links in old issues keep working.

## Order

1. This repository: every name in the table, in code, tests, README,
   `docs/how-the-numbers-are-made.md`, scripts, the demo tape, CI. The
   README's "Where it comes from" keeps the story of the old name in one
   sentence. CHANGELOG `## [0.10.0]` says the package, command and directory
   were renamed and that the cache starts over.
2. The person renames the repository on GitHub and sets up npm trusted
   publishing for `@drakulavich/cogload` (see Open question).
3. Release 0.10.0 by tag, as `npm-publish.yml` does today.
4. `npm deprecate` the old package.
5. pult: its `--zapara` flag becomes `--cogload`, it reads
   `~/.claude/cogload/status.json` and starts `cogload status`; a pult PR.
6. dotfiles: the status line in `claude/settings.ayak-air.json` and
   `claude/settings.ayak-PAI-FGWWC4TN29.json` passes `--cogload`, and the
   project description in `settings.ayak-air.json` names cogload.

## Open question for the person

npm trusted publishing is configured per package on npmjs.com. A package that
does not exist yet may need its first version published another way before
the trusted publisher can be added, and #83 recorded that npm refuses token
publishing here. Step 2 is the person's: either add the trusted publisher for
the new name if npmjs.com allows it before the first version, or publish
0.10.0 once by hand with `npm publish --provenance` from a logged-in machine.

## Testing

- Existing tests change their expected strings and paths only; the count
  stays the same. A test that asserted `.claude/zapara` asserts
  `.claude/cogload`.
- `tests/cli/package.test.ts` pins the package name and the `bin` entry.
- `git grep -i zapara` outside `docs/superpowers/specs/`, `CHANGELOG.md`
  history and the README's "Where it comes from" finds nothing.
- The plugin's tests expect `["cogload", "status"]`.

## Definition of done

- `bun run check` and `claude plugin test plugin` pass in CI.
- `git grep -i zapara` finds only the places named above.
- `bun pm pack --dry-run` shows `@drakulavich/cogload` with bin `cogload`.
- After release: `bunx @drakulavich/cogload@latest status` writes
  `~/.claude/cogload/status.json`; the plugin installed from
  `drakulavich/cogload` draws the band; pult with `--cogload` shows the load.
- `npm view @drakulavich/zapara deprecated` prints the rename notice.
