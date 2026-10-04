# Shared Neon data for dashboard integration

The shared development Neon database was seeded and verified on **2026-10-04
(UTC)**. Every seeded name, business, messaging identifier, menu, and order is
fictional. Data lives in Neon and is shared by backends connected to the same
development branch.

## Verified initial inventory

| Data | Records |
| --- | ---: |
| Customers | 9 |
| Caterer owners | 5 |
| Caterers | 5, including 4 active |
| Menu items | 15, including 12 belonging to active caterers |
| Availability entries | 164 |
| Orders | 25 |
| Order items with price snapshots | 49 |
| Conversations | 9 |
| Messages | 19 |
| Structured request states | 9 |

Orders cover `DRAFT`, `REQUESTED`, `ACCEPTED`, `DECLINED`, `CANCELLED`, and
`COMPLETED`. The initial counts are 4 per status, plus one additional
`REQUESTED` order. Completed events are in the past; other events are upcoming.
There are 30 days of availability from the seed date, historical availability
for completed fixtures, and the existing repeatable June 2030 demo dates.

Amounts use decimal dollar strings and integer-cent calculations. Order prices
come from the stored menu and are copied into order items as historical snapshots.

## Teammate setup

1. Pull `main` and use Node.js 22+.
2. Run `npm ci`.
3. Copy `.env.example` to an ignored `.env` if needed. Preserve an existing `.env`.
4. Ask NLI for a least-privilege connection to the **same shared development
   branch** through the approved private secret channel. Dashboard readers should
   receive read-only access. Keep the connection URL only in local secrets.
5. Set the server's `DATABASE_URL` locally, then run:

   ```bash
   npm run db:verify
   npm run db:summary
   ```

The shared data is already loaded. Teammates can read it immediately after
their backend connection is provisioned. A new Neon branch has its own evolving
data; use the shared development branch to see the team's latest changes.

## Connect the dashboard

The dashboard server can import the existing TypeScript services:

```ts
import {
  getMarketplaceSummary,
  getOrders,
  getMenu
} from "../src/services/index.js";

const summary = await getMarketplaceSummary();
const catererOrders = await getOrders({ catererId });
const menu = await getMenu(catererId);
```

Expose these calls through your dashboard's authenticated server routes. Enforce
the signed-in user's access to order details in those routes. Keep `DATABASE_URL`
on the server; the browser calls your backend.

The summary returns customer/caterer/menu counts, counts for all six order
statuses, a decimal-string `completedOrderValue`, and `generatedAt`. Completed
order value is an estimated order total; this application does not track payments.

Each service call reads the current Neon records. Configure the dashboard to
refetch after changes and periodically, for example every 30 seconds, using
uncached responses. This makes teammate dashboards show the same shared data on
their next fetch. Git pulls distribute code and setup instructions; they do not
transfer database rows, credentials, or push live updates into an open browser.

## Maintain the fictional fixtures

An authorized development maintainer can run `npm run db:seed`. The entire load
runs in one transaction. Fixed IDs and conflict handling preserve existing
customers, catalog edits, orders and their statuses, conversation state, and price
snapshots. A later run adds missing fixtures and extends date availability.

Seeding does not alter the schema. Follow
[neon-database-handoff.md](neon-database-handoff.md) for migration approval and
secure access. The runtime uses [Drizzle's supported Neon WebSocket driver](https://orm.drizzle.team/docs/connect-neon)
automatically for Neon URLs; `DATABASE_DRIVER=postgres` selects Postgres.js when
TCP access is available.
