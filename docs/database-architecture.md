# Catering-platform Neon database architecture

## Runtime boundary

```text
Customer or caterer conversation
  ↓
Fetch.ai agent (intent, request-state collection, presentation)
  ↓
Validated TypeScript tools
  ↓
Deterministic marketplace services
  ↓
Drizzle ORM
  ↓
Neon PostgreSQL
```

The agent does not query Neon directly. Services own validation, authorization,
availability, order transitions, and price calculation. Drizzle schema files and
migrations are the sole source of truth for database structure.

## Connection model

- `DATABASE_URL`: pooled Neon connection for the running service and agent.
- `DATABASE_URL_UNPOOLED`: direct Neon connection, used only for Drizzle
  migrations.
- `.env` contains those values locally and is ignored by Git.

Use a direct connection for migration work. This avoids PgBouncer session-mode
limitations and keeps production schema changes reproducible through the two
committed Drizzle migrations.

## Table groups

| Group | Tables | Purpose |
| --- | --- | --- |
| Identity | `users` | Customer and caterer-owner identities, keyed independently from any specific messaging provider. |
| Marketplace catalog | `caterers`, `menu_items`, `availability` | Caterer profile, active menu, dietary tags, capacity, supported event styles, fulfillment, and date-specific availability. |
| Commerce | `orders`, `order_items` | Customer requests and historical, price-snapshotted menu selections. |
| Conversation | `conversations`, `messages`, `catering_request_states` | External conversation mapping, idempotent inbound/outbound message identifiers, and partial structured request state. |

## Relationships

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

All historical relationships use `ON DELETE RESTRICT`. A menu item or caterer
should be deactivated rather than deleted when it appears in historical orders.

## Key constraints and indexes

- Unique messaging identifiers, external conversation IDs, and external message
  IDs make identity and messaging ingestion idempotent.
- Each caterer can have only one availability entry for a date.
- A menu item may appear at most once in an order; quantity and the price
  snapshot are constrained to non-negative/positive values.
- Money uses `numeric(12,2)`, never floating point.
- Indexed lookup paths include caterer location/active state, availability date,
  menu ownership, order customer/caterer/date/status, and request-state owner.

## Dashboard boundary

An eventual dashboard should call a read-only TypeScript reporting endpoint or
service, never use `DATABASE_URL` in the browser. Existing tables already
support core metrics without a duplicate analytics table:

- customer count: `users` where `role = 'CUSTOMER'`
- active caterer count: `caterers` where `active = true`
- orders awaiting action: `orders` where `status = 'REQUESTED'`
- orders by status/date/caterer: indexed fields on `orders`
- upcoming capacity and availability: `availability` joined to `caterers`

`src/services/reporting.ts` provides `getMarketplaceSummary()` for database-backed
counts, order statuses, and completed order value. Integrate it in an authenticated
server route when the dashboard is built. The shared fictional data and teammate
setup are described in [dashboard-data.md](dashboard-data.md).

Neon application URLs automatically use the official WebSocket driver with
transaction support; `DATABASE_DRIVER=postgres` selects the original Postgres.js
transport. Migration connections still use Postgres.js and the direct URL.
Use Node.js 22+ and keep database access on the server.

## Applying the schema

The committed migrations are:

1. `0000_initial_marketplace_schema` — identity, catalog, orders, and messaging.
2. `0001_add_catering_request_states` — persisted conversational request state.

After a Neon project is selected and both connection variables are local:

```bash
npm run db:migrate
npm run db:seed
npm run db:verify
```

Seed data is entirely fictional and is for shared development/demo verification.
It has already been loaded into the shared development database. Repeated seed
runs preserve existing records and add only missing fixtures and availability.
