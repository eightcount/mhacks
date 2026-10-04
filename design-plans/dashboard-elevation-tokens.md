# Shadows follow the documented elevation system

Written against: 87bb164 (plus uncommitted dashboard restyle in `src/web/public/`)

## Evidence chain

- Surface: dashboard home (open stat tile, date chips) and detail views (current chart column).
- Problem: three rules add tone-colored glows: `.stat.is-active` box-shadow, `.date` box-shadow, `.chart-col.is-current .chart-stack` drop-shadow.
- Design evidence: `src/web/public/styles.css` `:root` comment: "Elevation, tinted toward the ink rather than gray. Things you can click float (raised, lifted on hover); things you read sit close to the page." Tokens `--ring`, `--shadow-rest`, `--shadow-raised`, `--shadow-lifted`.
- Owner: `src/web/public/styles.css`.
- Scope and affected surfaces: open stat tile, every date chip, every column chart's current column.
- Uncertainty: none.

## Design decision

Clickable tiles keep their raised elevation when open, with the 2px tone ring as the selected-state signal. Date chips are read, not clicked, so they sit at rest. The current chart column is already marked by its bold label, so it gets no shadow.

## Reuse

- `--ring`, `--shadow-rest`, `--shadow-raised`
- Exemplar: `.stat` resting state; `.panel`

## Changes

1. `.stat.is-active` → `box-shadow: 0 0 0 2px var(--tone), var(--shadow-raised)`.
2. `.date` → keep the 1px tone ring, replace the colored drop with `var(--shadow-rest)`.
3. `.chart-col.is-current .chart-stack` → remove the `filter: drop-shadow(...)` rule.

## Scope

- Inherit: all tiles, chips, charts.
- Exclude: icon tiles (already flat), status pills.

## Validation

- Interface: open each detail view at 1280px; no colored halos remain.
- Repository: `npm test` → all pass.

## Stop conditions

- Stop if the elevation comment or tokens are removed.

## Design documentation

- None.
