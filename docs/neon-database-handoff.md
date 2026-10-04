# Neon database handoff

This document is the shared handoff for contributors and coding agents working
on the catering platform's remote Neon PostgreSQL database. Read it before
changing database code, applying migrations, adding a dashboard/reporting
feature, or requesting database access.

## Architecture agreement

```text
Customer or caterer conversation
  ↓
Fetch.ai agent
  ↓
Validated TypeScript tools
  ↓
Deterministic marketplace services
  ↓
Drizzle ORM and committed migrations
  ↓
Remote Neon PostgreSQL
```

The agent decides which tool to call. The tool and service layer validate data,
enforce authorization, calculate prices, enforce order transitions, and read or
write Neon. An LLM, conversation layer, dashboard, or client must never query
Neon directly or generate arbitrary SQL.

## Remote database status

- A shared remote Neon development project exists and is the intended database
  for this repository's current development environment.
- The base marketplace schema is applied to its `main` branch.
- Fictional development data was loaded and verified on **2026-10-04 (UTC)**:
  **9 customers, 5 caterers (4 active), 15 menu items, and 25 orders** covering
  all six order statuses. Availability, order items, conversations, messages,
  and structured request states are also populated.
- The verified inventory and teammate/dashboard setup are documented in
  [`dashboard-data.md`](dashboard-data.md). These counts describe the initial
  seed; application activity can change them afterward.
- Local `.env` values are ignored by Git and point to the database only on the
  machine where they were provisioned. They are not collaboration artifacts.

Do not commit a connection string, a Neon project identifier, branch identifier,
role password, API key, or any other credential to this repository.

## Schema source of truth

Do not rebuild this schema manually in a dashboard. The authoritative files are:

- `src/db/schema/index.ts` — Drizzle schema definitions
- `drizzle/0000_initial_marketplace_schema.sql` — marketplace, order, and
  messaging schema
- `drizzle/0001_add_catering_request_states.sql` — persisted conversational
  request state
- `drizzle/0002_caterer_operations.sql` — caterer product definitions, forms,
  preorders, notification drafts, and agent sessions
- `src/db/migrate.ts` — migration runner

The additive `drizzle/0002_caterer_operations.sql` migration introduces caterer
product/container definitions, order forms, preorders, notification drafts, and
agent sessions. After isolated-branch testing and explicit user approval, it was
applied to the shared development database using Drizzle's session-capable Neon
WebSocket migrator with the direct connection. All five tables, eight foreign keys,
and the recorded migration hash were verified. Existing marketplace record counts
were unchanged. See the [caterer database services](../src/services/caterer-operations.ts).

| Caterer operations table | Responsibility |
| --- | --- |
| `caterer_product_specs` | Immutable recipe and container revisions belonging to a caterer's menu items. |
| `caterer_order_forms` | Published product and price snapshots, fulfillment details, and package limits. |
| `caterer_preorders` | Requested orders, customer fulfillment details, and historical item snapshots. |
| `caterer_notification_drafts` | Customer notification drafts and delivery-attempt status. |
| `caterer_agent_sessions` | Structured draft state scoped to a caterer and session. |

The two base migrations create these application tables:

| Area | Tables | Responsibility |
| --- | --- | --- |
| Identity | `users` | Customer and caterer-owner records. Messaging identifiers are flexible and not assumed to be phone numbers. |
| Catalog | `caterers`, `menu_items`, `availability` | Caterer service details, active menus, dietary tags, capacity, fulfillment support, and date availability. |
| Commerce | `orders`, `order_items` | Customer requests and immutable menu-price snapshots for historical orders. |
| Conversation | `conversations`, `messages`, `catering_request_states` | Messaging-provider mapping, idempotent external message IDs, and partial structured catering-request state. |

Key relationships:

```text
users (CATERER) 1 ── * caterers 1 ── * menu_items
                                   └ ── * availability

users (CUSTOMER) 1 ── * orders * ── 1 caterers
                         │
                         └ ── * order_items * ── 1 menu_items

users 1 ── * conversations 1 ── * messages
                 │
                 └ ── 1 catering_request_states
```

Foreign keys use restrictive delete behavior. Never hard-delete a caterer or
menu item that may be referenced by an order; use `active = false` instead.
Money uses Postgres `numeric(12,2)`, not floating point.

## Runtime and migration connections

The application uses two local-only variables:

```dotenv
DATABASE_URL=             # pooled application connection
DATABASE_URL_UNPOOLED=    # direct connection for Drizzle migrations
DATABASE_DRIVER=         # optional: neon or postgres
```

`DATABASE_URL` supports normal app traffic. Neon URLs now use the official Neon
WebSocket driver by default, including interactive transactions, so local
application access works when TCP port 5432 is unavailable. Use Node.js 22+.
`DATABASE_DRIVER=postgres` explicitly selects Postgres.js instead.
`DATABASE_URL_UNPOOLED` is used by
`npm run db:migrate` because migrations need a direct, session-capable Neon
connection. Both connection URLs are secrets and belong only in a local secret manager or
ignored `.env` file.

The migration runner currently prefers `DATABASE_URL_UNPOOLED` and falls back to
`DATABASE_URL` only when the direct value is unavailable. Keep `prepare: false`
in the Postgres.js migration client for Neon/PgBouncer compatibility. Migrations
continue to use the direct Postgres.js connection; seeding does not run migrations.

## Collaborative access procedure

No collaborator or agent should request the shared owner password. Request
least-privilege, environment-specific access from **NLI** through the team's
approved private secret channel.

Use this exact request when database access is necessary:

> I need **[read-only inspection | migration | seed-data]** access to the
> **[development | staging | production]** Neon database for **[specific task]**.
> Please provision a least-privilege, time-bounded connection or role through
> the approved secret channel. I will keep it only in an ignored local secret
> store, and I will not paste, log, commit, or send it to an agent or chat.

For an agent without database credentials:

1. Continue with deterministic unit tests, schema inspection, or mocks where
   possible.
2. Do not invent database contents, access tokens, connection strings, or
   project identifiers.
3. Do not replace the database with local SQLite, a new random provider, or
   ad-hoc SQL simply to bypass the missing access.
4. Pause and ask NLI only when a real remote operation is required.

## Change workflow

1. Inspect `src/db/schema/index.ts`, existing migrations, service types, and
   tests before proposing a schema change.
2. Change the Drizzle schema first.
3. Generate and review a new Drizzle migration.
4. Test it on an isolated Neon branch before the shared branch.
5. Obtain explicit approval before applying a migration to the shared branch.
6. Run relevant tests, type-checking, and build steps.
7. Document the change in the pull request without exposing connection data.

The base schema was initially applied remotely after the local Postgres client
path timed out. Applying `0002_caterer_operations` has now established Drizzle's
migration history for all three migrations on shared development. The standard
`npm run db:migrate` command still uses direct TCP; this environment used the
official `drizzle-orm/neon-serverless/migrator` with a WebSocket pool and the direct
connection because TCP timed out. Future changes must follow the same isolated
branch testing and shared-branch approval workflow.

## Reporting and dashboard boundary

An eventual dashboard must use a read-only TypeScript reporting service or API.
It must not receive `DATABASE_URL` or connect directly to Neon from a browser.
The current schema already supports core marketplace metrics:

- customer count from `users` filtered to `CUSTOMER`
- active caterer count from `caterers`
- requests awaiting caterer action from `orders` filtered to `REQUESTED`
- order volume by date, caterer, and status
- upcoming capacity/availability from `availability` joined to `caterers`

`getMarketplaceSummary()` in `src/services/reporting.ts` now provides live
database-backed aggregate counts and completed order value. A dashboard backend
can call it from an authenticated route. `npm run db:summary` verifies the same
reporting path locally without starting an HTTP server.

Use the same shared development branch, provisioned through NLI, for each
teammate's backend. Git transfers code; Neon holds the shared data. Pulling the
repository does not copy credentials or automatically refresh a dashboard.

Add dashboard authentication before exposing these metrics externally.
