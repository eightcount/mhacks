# The catering platform

This project is an agentic catering marketplace connecting customers with local, small, and home-owned caterers through conversational interfaces. The backend stores marketplace data in Neon PostgreSQL and keeps business rules deterministic.

Phase 3 includes a customer-facing Fetch.ai conversational agent. It collects a partial catering request over multiple messages, persists that state, invokes the existing marketplace tools, and turns grounded tool data into concise replies.

A separate [caterer operations workflow](docs/caterer-workflow.md) adds guided product/recipe setup, shareable order forms, weekly production and ingredient totals, distribution labels, grocery-provider adapters, and customer notification drafts. Start with `npm run caterer:configure`, then `npm run caterer:backend` and `npm run caterer:cli` after applying the caterer migration to your intended database. The [caterer Photon/iMessage adapter](docs/photon-imessage.md) is implemented; configure your Photon project and owner address, then run `npm run photon:start`. Live activation requires those local credentials. Multi-tenant login and automatic grocery checkout are not implemented.

A local, read-only [caterer dashboard](#caterer-dashboard) is also available.

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

The caterer iMessage adapter follows this path:

```text
iMessage → Photon / Spectrum → Backend → Fetch.ai → Marketplace Tools → Neon PostgreSQL
```

Photon is messaging infrastructure; Fetch.ai is agent orchestration; Neon/PostgreSQL is persistent marketplace data. The customer agent's iMessage routing remains unconnected.

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

Both `agent:cli` and `agent:fetch` load the project's `.env` and pass the values
to Python. Activate `.venv` first so they use its Python interpreter. To keep a
separate verification conversation, run
`FETCH_AGENT_LOCAL_SESSION=customer-verification npm run agent:cli`.

Try this seeded-data flow:

```text
I need Chinese dumplings for 30 people on 2030-06-15.
$500, Ann Arbor, delivery.
Buffet style, and we need vegetarian options.
Show me the first one's menu.
Let's use that caterer.
30 Vegetable Dumplings.
Book it.
```

The agent carries known fields forward, calls `search_caterers`, resolves “first one” from persisted result IDs, retrieves the actual menu, and submits an order as `REQUESTED`. It never changes an order directly to `ACCEPTED`.

The rule-based extractor also understands “next Saturday”; it will only return a match when the database has availability for that resolved date. The fixed date above is the seeded, repeatable local demonstration date.

After selecting a caterer, give menu item names and explicit quantities, such as
`20 Vegetable Dumplings` or `Vegetable Dumplings x 20`. Multiple items can be
separated with `and`. The agent resolves names against that caterer's active menu
and saves a `DRAFT` through the backend, which validates ownership and calculates
the total. Quantities use the menu's listed units; headcount is not an item
quantity. Say `book it` to submit the saved draft as `REQUESTED`. Draft contents
survive an agent restart. Unknown or ambiguous names require clarification.

## Fetch, Agentverse, and ASI:One

To run the Fetch transport after starting `agent:backend`:

```bash
source .venv/bin/activate
npm run agent:fetch
```

`npm run agent:configure` enables mailbox mode in `.env` unless a value is already
set. For an existing environment, set `FETCH_AGENT_MAILBOX=true`. Keep the existing
`FETCH_AGENT_SEED`: it determines the agent's identity across restarts.

Follow the [official mailbox guide](https://uagents.fetch.ai/docs/agentverse/mailbox)
to connect this local agent to your Agentverse account:

1. Keep both `agent:backend` and `agent:fetch` running in separate terminals.
2. Open the Agent Inspector URL printed by `agent:fetch` and sign in to Agentverse.
   Allow local-network access if the browser asks; Inspector connects to port 8001
   on this computer.
3. In Inspector, choose **Connect**, then **Mailbox**. No additional agent or
   copied API token is needed for this browser flow.
4. Confirm the terminal reports `Successfully registered as mailbox agent in
   Agentverse` and the agent appears under **My Agents** with a **Mailbox** tag.
5. Use **Chat with Agent** to open ASI:One and try the customer conversation above.

The agent publishes the standard chat protocol manifest and handles chat messages
and acknowledgements. Mailbox mode routes messages through Agentverse and queues
messages while the local agent is offline; the local Python process and backend
must be running to generate replies. Registering a mailbox does not host this
application for you.

This adapter currently supports customer conversations and maps senders to the
configured demo customer. Use fictional demo requests until per-sender customer
authentication is implemented. Caterer management is not exposed by this adapter.

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
npm run test:agent   # conversation tests and offline Fetch startup verification
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

The page shows only what a caterer needs day to day. Every figure comes from Neon records.

The arrows beside the month at the top (and a **This month** shortcut) set the month for the four tiles and their detail views. Orders count toward the month of their event date and preorders toward their pickup or delivery date. The lists below the tiles always show what is happening now.

- **Revenue:** stored order totals of `ACCEPTED` and `COMPLETED` orders in the month, split into completed and still to fill, with booked preorders shown separately. Payments are not tracked, so this is booked order value. Its detail view charts booked value for the six months ending with the selected month and lists the month's booked orders.
- **Orders to fill:** `ACCEPTED` orders in the month, with guests and the next event. Its detail view charts guests by day, still to fill and already filled, and lists both groups of orders.
- **Awaiting your reply:** `REQUESTED` catering orders and preorders for the month's events. Its detail view shows how long each has waited and lists them.
- **Customers:** distinct customers with a booked order in the month, split into new (their first booked event is in that month) and returning. Its detail view charts new and returning customers for six months and lists the month's customers by booked value.
- **Upcoming:** `ACCEPTED` orders with an event date from today on.
- **Pending requests:** `REQUESTED` orders waiting for the caterer, with event style, fulfillment, dietary restrictions, items, and special requests.
- **Menu for the week:** the active menu, busiest first, with the servings in booked catering orders and the packages in booked preorders dated in the next seven days, starting today. An inactive item appears only if something is still booked for it.

Each tile links to its detail view (`#revenue`, `#orders`, `#awaiting`, `#customers`); the browser's Back button or Esc returns to the dashboard. Opening, closing, and changing months animate with the browser's View Transitions API, with a simpler entrance animation where it isn't available and no motion when the system asks for reduced motion.

The JSON endpoint returns the selected month's figures and details as `monthView`. It also returns availability, booked value by month, the order pipeline, order forms, a production plan, customer notifications, request mix, top customers, the full menu, and order history for other clients; the page doesn't display them.

Draft orders are hidden because the customer has not submitted them. Order lines use each order item's stored price snapshot, and money is added in integer cents.

The page refreshes every 30 seconds and when its tab regains focus, so orders created or changed through the agent's tools appear without agent-specific dashboard code. Add `&month=YYYY-MM` to open a specific month, or `&today=YYYY-MM-DD` to view the dashboard as of another date; order forms are then judged open or closed as of noon UTC that day. The JSON is at `GET /api/caterers/:catererId/dashboard?actorUserId=...`. Set `DASHBOARD_PORT` to use a port other than 3000.

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

The customer marketplace agent and caterer operations agent have separate conversation state and tools. The caterer has a Photon/iMessage adapter for one configured owner. Multi-tenant authentication, payments, customer iMessage routing, and multi-agent coordination remain future work.
