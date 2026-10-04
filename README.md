# The catering platform

This project is an agentic catering marketplace connecting customers with local, small, and home-owned caterers through conversational interfaces. The backend stores marketplace data in Neon PostgreSQL and keeps business rules deterministic.

Phase 3 adds one customer-facing Fetch.ai conversational agent. It collects a partial catering request over multiple messages, persists that state, invokes the existing marketplace tools, and turns grounded tool data into concise replies. It does not implement Photon, Spectrum, iMessage, authentication, payments, or a multi-agent system. The only UI is a local, read-only [caterer dashboard](#caterer-dashboard).

## Architecture

```text
Natural-language message
  ↓
Fetch.ai uAgent (conversation and tool selection)
  ↓ authenticated loopback HTTP boundary
TypeScript marketplace tools
  ↓
Deterministic TypeScript services
  ↓
Neon PostgreSQL
```

The long-term messaging path remains planned:

```text
iMessage → Photon / Spectrum → Backend → Fetch.ai → Marketplace Tools → Neon PostgreSQL
```

Photon is messaging infrastructure; Fetch.ai is agent orchestration; Neon/PostgreSQL is persistent marketplace data. Photon/iMessage is **not implemented** in this phase.

## Why standard uAgent Chat Protocol

The Fetch adapter uses a standard Python `uagents.Agent` and Fetch's Agent Chat Protocol (`Protocol(spec=chat_protocol_spec)`). This is the documented route for Agentverse and ASI:One-compatible chat agents. `ChatAgent` is intentionally not used because Fetch currently labels it experimental. The core conversation engine is independent of Fetch transport, so the same engine also runs in the local CLI and can later be reached from Photon.

The Python agent never reads PostgreSQL or contains marketplace business logic. It calls an authenticated, loopback-only TypeScript tool API. That API validates input and delegates to the Phase 2 services, which remain responsible for authorization, availability, pricing, order transitions, and database writes.

Useful official references:

- [Fetch uAgents documentation](https://uagents.fetch.ai/docs)
- [Fetch Agent Chat Protocol guide](https://uagents.fetch.ai/docs/guides/chat_protocol)
- [Fetch ChatAgent documentation (experimental)](https://uagents.fetch.ai/docs/getting-started/chatprotocol)
- [Fetch ASI:One-compatible uAgent example](https://uagents.fetch.ai/docs/examples/asi-1)
- [Agentverse local uAgent guide](https://docs.agentverse.ai/documentation/create-agents/local-agent-u-agent)
- [ASI:One Agent Chat Protocol tutorial](https://docs.asi1.ai/documentation/tutorials/agent-chat-protocol)

## Prerequisites

- Node.js 22+
- npm 10+
- Python 3.10+
- A Neon PostgreSQL database and connection string

The shared development database already contains fictional customers, caterers,
menus, availability, and orders. For dashboard integration, follow
[the shared-data setup](docs/dashboard-data.md) and obtain private access to the
same development branch from NLI.

## Installation

Install the TypeScript dependencies:

```bash
npm install
```

Create an isolated Python environment and install the Fetch agent dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set the values locally. Do not commit `.env`.

```bash
cp .env.example .env
```

Generate the persistent local Fetch seed and internal token without printing them:

```bash
npm run agent:configure
```

Required values:

```dotenv
DATABASE_URL=
DATABASE_URL_UNPOOLED=
AGENT_INTERNAL_TOKEN=
FETCH_AGENT_DEFAULT_CUSTOMER_ID=
FETCH_AGENT_SEED=
```

`DATABASE_URL` is the Neon pooled connection string used by the running application. `DATABASE_URL_UNPOOLED` is the direct Neon connection string used only for Drizzle migrations; it is strongly recommended because migrations need a session-capable connection. Obtain both from Neon’s **Connect** dialog and keep them local. `AGENT_INTERNAL_TOKEN` is a random private value shared only by the local Python agent and loopback TypeScript API. After `npm run db:seed`, the fictional local customer ID is `11000000-0000-4000-8000-000000000006`.

`FETCH_AGENT_SEED` is only required when running the Fetch uAgent, not the local CLI. Generate and keep it private according to the uAgents setup flow. Optional variables are `FETCH_AGENT_NAME`, `FETCH_AGENT_PORT` (default `8001`), `FETCH_AGENT_MAILBOX` (default `false`), `FETCH_AGENT_LOG_LEVEL` (default `INFO`), `ASI1_API_KEY`, `ASI1_BASE_URL` (default `https://api.asi1.ai/v1`), and `ASI1_MODEL` (default `asi1`). The optional ASI:One key improves natural-language extraction; no paid model call is required for the local rule-based demo.

## Database setup

For a new, isolated development database, create and apply migrations, then add
fictional development data. Shared development users should follow the handoff
and use the data already loaded in Neon:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
npm run db:verify
```

Use the direct, non-`-pooler` Neon URL in `DATABASE_URL_UNPOOLED` before running `db:migrate`. The migration runner falls back to `DATABASE_URL` only when a direct URL is unavailable. See [the database architecture](docs/database-architecture.md) for the table relationships and the intended dashboard boundary.

The schema includes users, caterers, menu items, availability, orders, order items, conversations, messages, and `catering_request_states`. The latter persists the partial eight-field request, most recent search result IDs, selected caterer, and current order ID per conversation. It is not an LLM transcript or a store for secrets.

## Run locally

Start the TypeScript agent-tool boundary in one terminal:

```bash
npm run agent:backend
```

In another terminal, activate the Python environment and start the local conversation CLI:

```bash
source .venv/bin/activate
npm run agent:cli
```

Try this seeded-data flow (include a dish so the agent has an explicit order item):

```text
I need Chinese dumplings for 30 people on 2030-06-15.
$500, Ann Arbor, delivery.
Buffet style, and we need vegetarian options.
Show me the first one's menu.
Let's use that caterer.
Book it.
```

The agent carries known fields forward, calls `search_caterers`, resolves “first one” from persisted result IDs, retrieves the actual menu, and submits an order as `REQUESTED`. It never changes an order directly to `ACCEPTED`.

The rule-based extractor also understands “next Saturday”; it will only return a match when the database has availability for that resolved date. The fixed date above is the seeded, repeatable local demonstration date.

The agent will ask for a menu item instead of guessing one when the customer has not supplied an unambiguous dish selection. This preserves the requirement that an order composition be explicit and grounded in menu data.

## Fetch, Agentverse, and ASI:One

To run the Fetch transport after starting `agent:backend`:

```bash
source .venv/bin/activate
npm run agent:fetch
```

Set `FETCH_AGENT_MAILBOX=true` to use the documented mailbox/Agentverse connection path, keep `FETCH_AGENT_SEED` private, and use the Agentverse dashboard flow described in Fetch's local-uAgent documentation to inspect or chat with the running agent. The agent publishes the standard chat protocol manifest, which is the compatibility mechanism used by ASI:One.

For optional ASI:One extraction, obtain an API key from ASI:One, put it in local `ASI1_API_KEY`, and restart the Python process. The core request state and tools still work without it. Do not expose API keys, mailbox credentials, or agent seeds in source control or logs.

## Agent tools

The agent-facing TypeScript tools validate structured inputs and call existing services:

- `search_caterers`
- `get_caterer`
- `get_menu`
- `check_availability`
- `create_order`
- `request_order`
- `get_order`

Tool results are structured data. The Python layer may summarize those results but does not invent caterers, menus, prices, availability, delivery support, IDs, or order statuses.

## Commands

```bash
npm run dev          # development TypeScript entry point
npm run build        # compile TypeScript into dist/
npm run typecheck    # TypeScript type check
npm test             # Phase 1/2 Vitest suite
npm run db:generate  # generate Drizzle SQL migrations
npm run db:migrate   # apply migrations to DATABASE_URL
npm run db:seed      # fictional data
npm run db:verify    # read-only database verification
npm run db:demo      # deterministic Phase 2 service demonstration
npm run agent:backend
npm run agent:cli
npm run agent:fetch
python3 -m unittest fetch_agent.test_conversation
npm run dashboard    # local read-only caterer dashboard on http://localhost:3000
```

## Caterer dashboard

`npm run dashboard` serves a local, read-only dashboard for one caterer at `http://localhost:3000`. The server reads Neon through the TypeScript services (`getCatererDashboard`, which also uses `getMenu`), so `DATABASE_URL` stays on the server and the browser only calls the dashboard's JSON endpoint. It uses Node's built-in `http` module and binds to `127.0.0.1`.

Open it with a caterer ID and the user ID of that caterer's owner. In the shared fictional data, caterer `22000000-0000-4000-8000-00000000000N` is owned by user `11000000-0000-4000-8000-00000000000N` for N = 1–5:

| N | Caterer | What its fictional data shows |
| --- | --- | --- |
| 1 | Jade Juniper Kitchen | Growing month over month; three open order forms |
| 2 | Copper Cactus Taqueria | Busy summer that has cooled; a nearly sold-out form closed to new orders |
| 3 | Verdant Table Collective | Small, steady formal events; a paused order form |
| 4 | Saffron Harbor Mezze | Fewer, larger events; sold-out preorder products |
| 5 | Seoul Meadow Supper Club | Inactive, with no orders (empty states) |

```text
http://localhost:3000/?catererId=22000000-0000-4000-8000-000000000001&actorUserId=11000000-0000-4000-8000-000000000001
```

The page shows only what a caterer needs day to day. Every figure comes from Neon records:

- **Revenue:** stored order totals of `ACCEPTED` and `COMPLETED` orders with an event date in the current month, split into completed and still to fill. Booked preorders for the month are shown separately. Payments are not tracked, so this is booked order value.
- **Orders to fill** and **Upcoming:** `ACCEPTED` orders with an event date from today on.
- **Awaiting your reply:** `REQUESTED` catering orders and preorders.
- **Customers:** distinct customers with an `ACCEPTED` or `COMPLETED` order, and how many have more than one.
- **Pending requests:** `REQUESTED` orders waiting for the caterer, with event style, fulfillment, dietary restrictions, items, and special requests.
- **Customer notifications:** pickup and delivery notification drafts (`caterer_notification_drafts`), newest first, with counts by delivery status.
- **Menu for the week:** the active menu, busiest first, with the servings in booked catering orders and the packages in booked preorders dated in the next seven days, starting today. An inactive item appears only if something is still booked for it.

The JSON endpoint also returns availability, booked value by month, the order pipeline, order forms, a production plan, request mix, top customers, the full menu, and order history for other clients; the page doesn't display them.

Draft orders are hidden because the customer has not submitted them. Order lines use each order item's stored price snapshot, and money is added in integer cents.

The page refreshes every 30 seconds and when its tab regains focus, so orders created or changed through the agent's tools appear without agent-specific dashboard code. Add `&today=YYYY-MM-DD` to view the dashboard as of another date; order forms are then judged open or closed as of noon UTC that day. The JSON is at `GET /api/caterers/:catererId/dashboard?actorUserId=...`. Set `DASHBOARD_PORT` to use a port other than 3000.

Until authentication exists, the owner check uses the same actor-ID boundary as the other caterer services: the caller states who they are in the URL. Keep the server local; do not expose it publicly.

## Project structure

```text
src/
  agent/       Internal TypeScript tool boundary for the Fetch adapter
  db/          Shared Neon connection, Drizzle schema, migrations, seed data
  services/    Deterministic marketplace and persisted request-state services
  tools/       Validated, structured agent-callable marketplace tools
  validation/  Zod schemas
  types/       Shared TypeScript domain types
  web/         Local read-only caterer dashboard (server, page, styles, script)
fetch_agent/   Python Fetch uAgent, local CLI, extraction, and transport adapter
tests/         Phase 1/2 Vitest tests
```

## Intentional Phase 3 boundaries

There is one primary customer marketplace agent. Caterer-side agent actions, Photon/Spectrum, iMessage, authentication, payments, and multi-agent coordination remain later phases. The only UI is the local, read-only caterer dashboard.
