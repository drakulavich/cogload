# zapara quiet days: a day with nothing in it recedes

Extends `2026-09-17-zapara-design.md`. Everything not mentioned here stays as
that says.

## The problem

In the week grid every day gets one row, and a day with no activity gets the
same weight as a working one: twelve characters of label, 24 dots, `-` under
`peak`, `0h00` under `active`, all in the terminal's normal foreground.

```
Fri 18/09    ·  ·  ▒  ▓  ▓  █ ...    75   4h30
Sat 19/09    ·  ·  ·  ·  ·  · ...     -   0h00
Sun 20/09    ·  ·  ·  ·  ·  · ...     -   0h00
Mon 21/09    ·  ·  ▒  ▓  █  █ ...    90   6h30
```

A weekend in the middle of a seven-row grid is two rows the eye has to read
before deciding they say nothing. The grid's shape, which is the reason the
view exists, is carried by the painted glyphs; the dots are only a ruler for
them. Over `--days 30` the ratio gets worse.

## The rule

A day whose `peak` is `null` is **quiet**, and its whole row prints dim.

`peak` is `null` exactly when no hour of the day scored, and an hour scores
unless `sessions === 0` (`score()` in `src/score.ts`). So on a quiet day every
bucket is empty and the row is already fixed: 24 dots, `-`, `0h00`. Two things
follow, and both are load-bearing.

- **The row holds no escape code of its own**, so wrapping it in `\x1b[2m` …
  `\x1b[0m` needs none of the care the legend needs, where a painted glyph's
  own reset cancels the line's dim and the dim has to be re-emitted after it.
- **`activeMin` is 0 on a quiet day.** A run that crosses midnight puts the
  slots it covers into the accumulator of the hour its event falls in, and that
  accumulator has the event, hence a session, hence a score. A day cannot have
  minutes without a score.

Nothing else changes. The label, the 24 cells, `peak` and `active` keep their
widths and their content, so every column still lines up and a quiet row still
answers "which day was this" and "what did the hours look like".

## What stays as it is

- **`--no-color` and pipes.** `dim()` is the identity when `color` is false, so
  a redirected grid is byte for byte what it is today. The change is visual
  only; `--json` does not carry it.
- **The open day.** If today has nothing in it yet, today's row is quiet and
  dims like any other. The snapshot line below the grid (`as of HH:MM, this
  hour is still running`) is printed by `snapshotLine` and is unaffected.
- **`zapara today` on an empty day** prints `no activity on <date>` and no rows.
  There is nothing there to dim.
- **The card and `zapara status`** do not show a day row and are untouched.
- **The totals line** counts what it counts; a quiet day contributes zero to it
  today and still will.

## Rendering

One line in `renderWeek` (`src/render.ts`). The row is built as now, then:

```ts
return d.peak === null ? dim(row, color) : row;
```

`dim` is the helper already in the file. No new import, no change to
`renderDay`, `renderJson` or any core module; `src/render.ts` stays a pure
function from `Day[]` to a string.

## Testing

In `tests/render/render.test.ts`, on the `busy-week` fixture, whose Wednesday
is empty by construction:

- With `color: true`, Wednesday's line starts with `\x1b[2m` and ends with
  `\x1b[0m`, and Monday's line does not start with `\x1b[2m`. Fails under
  dropping the conditional (Wednesday is not dim) and under widening it to
  every row (Monday is).
- With `color: false`, Wednesday's line carries no escape character at all and
  reads as the plain row it does today, which keeps the no-color contract
  honest. Fails under dimming regardless of `color`.

The existing week-grid tests run with `color: false` and stay green as written.
