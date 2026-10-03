# Catering platform — Phase 2 marketplace logic

This project is the backend foundation for an agentic catering marketplace that will connect customers with local and home-owned caterers through conversational interfaces.

Phase 2 adds deterministic marketplace services on top of the database model: structured caterer search, availability and menu retrieval, order creation, order transitions, and ownership-protected caterer management. It intentionally does **not** implement a frontend, UI, iMessage, Photon, Spectrum, Fetch.ai, Agentverse, ASI:One, LLMs, authentication, or payments.

## Planned architecture

```text
iMessage
  ↓
Photon
  ↓
Backend
  ↓
Fetch.ai
  ↓
Marketplace Tools
  ↓
Neon PostgreSQL
```

- **Photon** will provide messaging infrastructure.
- **Fetch.ai** will provide agent orchestration.
- **Neon/PostgreSQL** persist marketplace data.

Photon and Fetch.ai are planned for later phases and are **not implemented** here.

## Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- A Neon PostgreSQL project and connection string

## Installation and environment

Install dependencies:

```bash
npm install
```

Copy the example environment file and set the Neon connection string locally:

```bash
cp .env.example .env
```

`.env` requires one variable:

```dotenv
DATABASE_URL=
```

Set `DATABASE_URL` to the connection string from the Neon dashboard. Never commit `.env`; it is excluded by `.gitignore`.

## Neon setup

1. Create a Neon project and a database if you do not already have one.
2. Copy its PostgreSQL connection string into local `.env` as `DATABASE_URL`.
3. Ensure the selected Neon branch/database is the one intended for development.
4. Run the migration and seed commands below.

No credentials are stored in source control. The runtime uses `DATABASE_URL` only through `src/db/index.ts`.

## Commands

```bash
# Start the lightweight development entry point
npm run dev

# Compile TypeScript into dist/
npm run build

# Type-check without emitting files
npm run typecheck

# Run foundational validation tests
npm test

# Create SQL migrations from the Drizzle schema
npm run db:generate

# Apply generated migrations to DATABASE_URL
npm run db:migrate

# Insert idempotent, completely fictional development records
npm run db:seed

# Query caterers, menu items, availability, and orders to check connectivity
npm run db:verify

# Run the deterministic marketplace lifecycle demonstration
npm run db:demo
```

For a new database, run these in order after setting `DATABASE_URL`:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
npm run db:demo
```

## Database model

The Drizzle schema lives in `src/db/schema/index.ts` and defines:

- `users` with customer and caterer roles, keyed by a flexible messaging identifier.
- `caterers` with multi-value cuisine types, capacity, location, service radius, and minimum order.
- Caterers also declare exact-match service areas, supported event styles, fulfillment support, and future-ready delivery settings (radius, fee, and minimum delivery order).
- `menu_items` with exact PostgreSQL `numeric(12,2)` prices and extensible string-array dietary tags.
- `availability` with one record per caterer/date.
- `orders` and `order_items`, storing historical item prices directly on order items plus the customer’s requested dishes/cuisines, event style, dietary requirements, event location, and fulfillment preference.
- `conversations` and `messages`, with unique external provider IDs for future idempotent messaging ingestion.

Foreign keys use restrictive delete behavior to preserve marketplace and historical order data. The schema includes the lookup indexes needed for the next phase, including messaging IDs, caterer location/activity, availability dates, order fields, and external conversation/message IDs.

## Seed data

`npm run db:seed` uses fixed, fictional IDs and conflict-safe inserts. It adds five fictional businesses:

- Chinese
- Mexican
- Vegan
- Mediterranean
- Korean

It also adds a fictional customer, availability records, menu data, a sample request, and a sample conversation/message. `Jade Juniper Kitchen` is an active Chinese caterer serving Ann Arbor with vegetarian dumplings, buffet support, delivery, capacity for 30 guests, availability, and a plausible price point for a $450 request. The surrounding records intentionally differ by availability, price, cuisines, capacities, event styles, dietary options, service areas, and fulfillment support.

## Marketplace services

`src/services/` exposes normal TypeScript functions, ready for a future agent or HTTP layer:

- `searchCaterers(criteria)` checks date, budget plausibility, cuisine/dish availability, headcount, event style, dietary menu data, exact location/service-area match, and fulfillment method.
- `checkAvailability(catererId, eventDate, headcount)` returns typed availability reasons.
- `getMenu(catererId, filters)` returns active menu items, optionally filtered by dietary restrictions and dish terms.
- `createOrder(input)` validates a customer, caterer, requirements, selected menu items, and database-derived prices; it creates the order and items in one transaction.
- `requestOrder(orderId, customerId)`, `acceptOrder(orderId, catererId)`, `declineOrder(orderId, catererId)`, `cancelOrder(orderId, customerId)`, and `completeOrder(orderId, catererId)` enforce valid state transitions and ownership.
- `getOrder` and `getOrders` retrieve structured order data.
- Caterer owners can update availability, menu items, and marketplace service settings through actor-ID-protected functions.

Location matching is intentionally an exact normalized string comparison against `location` and `serviceAreas`. The isolated `LocationMatcher` interface can later be replaced with distance-aware geographic logic without changing service callers.

## Project structure

```text
src/
  agent/          Future Fetch.ai boundary (placeholder only)
  db/
    schema/       Drizzle PostgreSQL schema
    index.ts      Shared Neon/PostgreSQL connection
    migrate.ts    Migration runner
    seed.ts       Fictional development data
    verify.ts     Read-only database verification
  messaging/      Future Photon/Spectrum boundary (placeholder only)
  services/       Deterministic marketplace logic and domain errors
  tools/          Future agent-callable functions (placeholder only)
  types/          Shared domain constants and inferred types
  validation/     Zod request and management validation schemas
tests/
  marketplace-logic.test.ts
  validation.test.ts
drizzle/          Generated SQL migrations (after db:generate)
```

## Intentional Phase 2 boundaries

The `agent/`, `messaging/`, and `tools/` directories remain future integration seams. There is no Fetch.ai, Photon, Spectrum, iMessage, LLM, authentication, payment, frontend, or UI implementation in this phase.
