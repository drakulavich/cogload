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
| Plugin | `cognitive-load` 0.3.0 runs `zapara status` | `cognitive-load` 0.4.0 runs `cogload status` |

The plugin keeps its name: `/plugin install cognitive-load@cogload` reads
well. The status file's format and `schema` 1 do not change; only its
directory does.

## No migration

The first `cogload` run finds no `~/.claude/cogload/` and starts from
nothing: the cache is rebuilt by one full scan, and the status file is
written by the first `cogload status`. `~/.claude/zapara/` is left as it
is. The README says it can be deleted once the person no longer runs zapara.

The plugin's own store starts over too. Claude Code keys it by plugin and
marketplace, so `cognitive-load` from the `cogload` marketplace finds no
`restUntil`, `spent`, `reading` or `overrides`: a rest in progress ends, and
`/overrides` lists nothing until the next override. The README says so.

## The `zapara` alias

For a while `zapara` keeps answering. `@drakulavich/cogload` declares two
`bin` entries, `cogload` and `zapara`, pointing at the same
`src/cli/index.ts`. Run as `zapara`, it does exactly what `cogload` does,
with the same data directory, and first writes one line to stderr:

```
zapara is now cogload; the zapara command goes away in 1.0.0
```

stdout is unchanged, so readers of `zapara status` keep working: the plugin
0.3.0 reads stdout only. The command
name is taken from `process.argv[1]`'s base name. The alias goes in 1.0.0, a
tracked issue.

Both packages installed globally would claim the `zapara` bin. The README's
install section says to run `bun remove -g @drakulavich/zapara` first, and
the CHANGELOG entry repeats it.

There is no last zapara release. The old package gets `npm deprecate
@drakulavich/zapara "renamed to @drakulavich/cogload"`; its installs keep
working until removed.

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
5. dotfiles: the status line in `claude/settings.ayak-air.json` and
   `claude/settings.ayak-PAI-FGWWC4TN29.json` drops `--zapara`, since the
   band shows the load and pult is not moved to cogload. In
   `settings.ayak-air.json` the marketplace key `zapara` becomes `cogload`,
   `enabledPlugins` names `cognitive-load@cogload`, and the project
   description names cogload.

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
- `tests/cli/package.test.ts` pins the package name and both `bin` entries.
- The CLI run through a `zapara` symlink to `src/cli/index.ts`: `status`
  prints the same stdout as `cogload status` and the notice line on stderr;
  run as `cogload`, stderr is empty.
- `git grep -i zapara` outside `docs/superpowers/specs/`, `CHANGELOG.md`,
  the README's "Where it comes from" and install note, and the alias (its
  `bin` entry, the notice and their tests) finds nothing.
- The plugin's tests expect `["cogload", "status"]`.

## Definition of done

- `bun run check` and `claude plugin test plugin` pass in CI.
- `git grep -i zapara` finds only the places named above.
- `bun pm pack --dry-run` shows `@drakulavich/cogload` with bins `cogload`
  and `zapara`.
- After `bun add -g @drakulavich/cogload`, both `cogload status` and
  `zapara status` work, and only the second prints the notice.
- After release: `bunx @drakulavich/cogload@latest status` writes
  `~/.claude/cogload/status.json`; the plugin installed from
  `drakulavich/cogload` draws the band.
- `npm view @drakulavich/zapara deprecated` prints the rename notice.
