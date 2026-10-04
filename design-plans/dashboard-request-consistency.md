# Pending requests read like the rest of the dashboard

Written against: 87bb164 (plus uncommitted dashboard restyle in `src/web/public/`)

## Evidence chain

- Surface: home view of the caterer dashboard, `GET /?catererId=…&actorUserId=…`, "Pending requests" section.
- Problem: (a) home pending rows are built inline without a date chip or wait time, while the same `REQUESTED` orders in the Awaiting detail view use `requestRow()` with both; (b) the "Awaiting your reply" tile (8) and the "Pending requests" badge (7) show different counts for what reads as the same thing, and the list gives no scope.
- Design evidence: `src/web/public/app.js` `requestRow()` (line 253) used by `detailRenderers.awaiting` (line 618); `renderRequests()` (line 370) builds a different row. README "Caterer dashboard": *Awaiting your reply* = `REQUESTED` catering orders and preorders for the month's events; *Pending requests* = `REQUESTED` orders waiting for the caterer (all dates). Exemplar for a scope note: Upcoming's `<span class="section-note">Accepted orders</span>` in `index.html`.
- Owner: `src/web/public/app.js`, `src/web/public/index.html`.
- Scope and affected surfaces: home "Pending requests" list and its section head only.
- Uncertainty: none.

## Design decision

Use the existing request row everywhere a `REQUESTED` catering order appears, and state the list's scope in its section head so its count is not mistaken for the month-scoped tile.

## Reuse

- `requestRow(order, todayIso)`; `.section-note`
- Exemplar: Upcoming section head in `src/web/public/index.html`

## Changes

1. `src/web/public/app.js` → `renderRequests()`
   - Change: map `data.pendingRequests` through `requestRow(order, data.today)`.
   - Preserve: badge count, empty state text.
   - Verify: each pending row shows a date chip, total, and "Waiting N days" / "Received today".
2. `src/web/public/index.html` → Pending requests section head
   - Change: add `<span class="section-note">All dates</span>` beside the badge, grouped so the head keeps title-left, meta-right.
   - Preserve: `#requests-count` badge.
   - Verify: note and badge sit right-aligned on one line beside the title at 1280px and 390px. ("Catering requests, all dates" was tried first and wrapped the head in the 1fr column; the tile's own subtitle already names catering vs. preorders, so the date scope is the missing fact.)

## Scope

- Inherit: home pending list.
- Verify: Awaiting detail view (unchanged).
- Exclude: data definitions and counts.

## Validation

- Product: a caterer can see at a glance how long each request has waited.
- Interface: 1280px and 390px, list with notes and without.
- System: no new row builder.
- Repository: `npm test` → all pass.

## Stop conditions

- Stop if `requestRow()` changes signature or the API stops returning `requestedOn`.

## Design documentation

- After acceptance: none (README already documents both scopes).
