# Catering platform — Phase 1 backend foundation

This project is the backend foundation for an agentic catering marketplace that will connect customers with local and home-owned caterers through conversational interfaces.

Phase 1 provides the database model, validation, fictional development data, and database verification tooling. It intentionally does **not** implement a frontend, UI, iMessage, Photon, Spectrum, Fetch.ai, Agentverse, ASI:One, LLMs, authentication, payments, or marketplace business operations.

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
```

For a new database, run these in order after setting `DATABASE_URL`:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
```

## Database model

The Drizzle schema lives in `src/db/schema/index.ts` and defines:

- `users` with customer and caterer roles, keyed by a flexible messaging identifier.
- `caterers` with multi-value cuisine types, capacity, location, service radius, and minimum order.
- `menu_items` with exact PostgreSQL `numeric(12,2)` prices and extensible string-array dietary tags.
- `availability` with one record per caterer/date.
- `orders` and `order_items`, storing historical item prices directly on order items.
- `conversations` and `messages`, with unique external provider IDs for future idempotent messaging ingestion.

Foreign keys use restrictive delete behavior to preserve marketplace and historical order data. The schema includes the lookup indexes needed for the next phase, including messaging IDs, caterer location/activity, availability dates, order fields, and external conversation/message IDs.

## Seed data

`npm run db:seed` uses fixed, fictional IDs and conflict-safe inserts. It adds five fictional businesses:

- Chinese
- Mexican
- Vegan
- Mediterranean
- Korean

It also adds a fictional customer, availability records, menu data, a sample request, and a sample conversation/message. `Jade Juniper Kitchen` is an active Chinese caterer with vegetarian choices, capacity for 30 guests, availability, and a plausible price point for a $450 request; the surrounding sample records provide useful filtering variation.

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
  services/       Future marketplace business logic (placeholder only)
  tools/          Future agent-callable functions (placeholder only)
  types/          Shared domain constants and inferred types
  validation/     Zod input validation schemas
tests/
  validation.test.ts
drizzle/          Generated SQL migrations (after db:generate)
```

## Intentional Phase 1 boundaries

The `agent/`, `messaging/`, `services/`, and `tools/` directories document future integration seams only. In particular, no `searchCaterers`, order workflow, availability workflow, menu mutation, iMessage, Photon, or Fetch.ai functionality exists yet. Those belong to the next phase.
