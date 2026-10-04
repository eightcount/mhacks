# Caterer operations

The separate caterer agent collects package orders through a shareable web form,
reviews requests, calculates production, produces distribution labels, and drafts
customer updates. It runs independently of the customer agent on backend port
4002 and Fetch port 8002.

The CLI, Fetch Chat Protocol, and Photon/iMessage use the same persisted conversation
engine. Order lookups and single-product form drafting accept natural language.
ASI:One/Fetch and Photon/iMessage replies use text and ordinary web links. Answer
the questions by typing and use numbered
commands such as `accept 1` or `1:50, 2:30` for guided form product quantities.
Common sale phrases work without an API key; when `ASI1_API_KEY` is configured,
the existing ASI connection also interprets paraphrases and corrections. The model
extracts draft fields only. Authenticated TypeScript tools and services still
validate ownership, dates, fulfillment support, package limits, and prices.

## What is implemented

| Step | Capability |
| --- | --- |
| Product setup | Associate an existing menu item with a named container, measured fill, batch yield, ingredients, allergens, and storage instructions. |
| Order collection | Create a dated form with package limits, closing time, pickup/delivery instructions, food minimum, and delivery fee; retrieve and share its link. |
| Order review | Requests start as `REQUESTED`. Only the owning caterer can accept, decline, cancel via the tool, or complete them. |
| Receipts | Request an itemized text and printable receipt for each listed order using its saved prices. Payment is not tracked. |
| Weekly production | Aggregate `ACCEPTED` form orders into packages, whole recipe batches, surplus, and ingredients. Pending requests are reported separately. |
| Shopping | Generate the actual ingredient list; optionally create an Instacart shopping link and look up current Kroger promotions at a configured store. |
| Distribution | Print one HTML label per package using saved product/customer information. |
| Notifications | Draft fulfillment updates, review the actual recipients and text, then explicitly send individual drafts through a connected messaging webhook. |

This workflow covers **orders collected by these forms**. Existing marketplace
quote orders remain in their existing workflow: their quantities do not yet have
an explicit mapping to these container/recipe definitions. They are not silently
treated as packages. Form package limits and minimums are owner-configured rules
for a batch sale, separate from marketplace event headcount/availability rules.

## Database and local setup

Read [the database handoff](neon-database-handoff.md). Migration
`drizzle/0002_caterer_operations.sql` adds five tables for product definitions,
forms, preorders, notification drafts, and persisted caterer sessions. The migration
and workflow have been verified on an isolated Neon branch. The migration has
also been applied to shared development after explicit user approval; its five
tables, eight foreign keys, and migration-history hash were verified. Future
shared-branch migrations still require approval as described in that handoff.

After the migration is applied to the database you intend to use:

```bash
npm run caterer:configure
npm run caterer:backend
```

In another terminal:

```bash
npm run caterer:cli
```

The configuration script adds a separate agent seed and internal token to the
ignored local `.env`. It preserves existing values and defaults to the repository's
fictional demo caterer/owner. Set `CATERER_ID` and `CATERER_OWNER_USER_ID` locally to
use a different provisioned business. Services verify that this user owns it.

The form URL defaults to localhost, so it works only on this computer. Hosting the
form service with HTTPS and setting `CATERER_PUBLIC_BASE_URL` is necessary before
customers can open links from their devices. `CATERER_BACKEND_HOST` controls the
listen address. Protect owner `/tools/*` routes with the internal token; do not
expose that token to browsers. The current API binds one owner to one process,
rather than providing a multi-tenant login system.

## Walkthrough

For a product with a saved menu price and recipe/container, you can send:

```text
What orders do I have for Saturday?
Create an order form for dumplings this Saturday.
50 boxes, delivery only, orders close Friday at 6
Delivery within the fictional demo area
6pm Eastern
free delivery
publish
```

The agent matches the product against the business's prepared menu, shows its
saved price, remembers the sale date, and asks only for missing details. If more
than one product matches "dumplings", it asks you to choose. An ambiguous time
such as "6" prompts for AM/PM; an omitted time zone uses `CATERER_TIMEZONE` if
configured, otherwise it asks. A bare weekday deadline is resolved on or before
the sale date. The final review displays absolute dates, the deadline's UTC offset,
prices, package limits, location, minimum, and delivery fee. A form starts with no
minimum; say `minimum order is $20` to change it. Delivery forms ask for a fee.
The agent reads the business's supported fulfillment methods before asking for
a location. A delivery-only business cannot create a pickup form. An incompatible
saved draft retains its products, quantities, and dates, but asks for a supported
method and fresh fulfillment instructions; it never silently switches methods.

Send a correction such as `Actually, 40 boxes`, `orders close Thursday at 5pm Eastern`,
`title: Weekend dumplings`, or `pickup at Fictional Community Hall`. Details and
the review survive process restarts. `publish`
creates the link only after review; `cancel` discards the draft. Prices are read
again before publication. A changed price requires a new review.

Natural drafting currently selects one prepared product. Use `new form` and enter
quantities such as `1:50, 2:30` for multiple products. Menu products and selling prices must
already exist: a quoted new price does not overwrite them. The agent shows the
saved price and asks you to update the menu first or say `use menu price`.
For a new sale, "this Saturday" means the upcoming Saturday, including on Sunday.
Reports keep calendar-week semantics for "this Saturday"; bare "Saturday" means
the upcoming day. The resolved date is always shown.

The following guided commands remain available:

Start with `menu`, then `new recipe`. The following is a **fictional calculation
fixture**, not a real recipe or a food-safety/storage recommendation:

```text
new recipe
1
dumpling box
12 each
12 each
60 each
flour: 500 g; water: 300 ml; wrappers: 60 each
wheat
[your actual storage instructions]
```

The product price comes from the existing menu item. One menu selling unit is one
configured package; verify the menu price is appropriate for that package before
offering it. Each saved recipe is an immutable revision. A form pins its chosen
revision and menu price so later revisions do not rewrite earlier orders.

Then create a form:

```text
new form
1:50
Weekly dumpling orders
June 15, 2030
2030-06-10T18:00:00-04:00
delivery
[your actual delivery area and instructions]
20
3.25
publish
```

Use future dates appropriate to the actual sale. `1:50` means up to 50 packages
of the first listed product. Multiple products use `1:50, 2:30`. The minimum is the
food subtotal; the delivery fee is additional. Pickup forms have no delivery fee.
`forms` retrieves links; `close form 1` stops new requests for a listed form.

Share the returned link. A customer chooses package quantities and submits their
name/contact and, for delivery, address. The backend calculates prices and locks
the form while reserving capacity; repeat submissions with the same submission ID
return the same order. Declined/cancelled requests release reserved capacity.

```text
orders June 10–16, 2030
accept 1
receipt 1
plan
order ingredients
deals
labels
notify
June 15, between 2 and 3 pm Eastern
```

Type `June 10th` or `orders June 10th` to see just that day's orders. `today`,
`tomorrow`, `Friday`, and `next week` also work. Newly supplied dates without a year
use the current year in the caterer's local time zone; replies always
show the resolved year. Use `June 15, 2030` for an order in 2030. ISO dates and the
older two-date syntax still work. Ranges must be ordered and span at most 32 days.

`orders` alone selects Monday–Sunday of the current week. Other reports (`plan`,
`labels`, `order ingredients`/`groceries`, `deals`, and `notify`) keep the last
selected day or range unless you supply another one. For example, `plan this week`
resets the selection to this week. The selected dates persist across restarts.
Relative dates use `CATERER_TIMEZONE` if configured (an IANA zone such as
`America/Detroit`), otherwise the agent machine's timezone.

To prepare only one accepted order, use its number from the latest `orders` list:

```text
plan order 8
order ingredients for order 8
```

After `plan order 8`, plain `order ingredients` keeps that order selected, including
after a restart. `order ingredients for the order I accepted` selects the last
order accepted in this chat. Both paths use the saved order ID; the backend checks
ownership and requires `ACCEPTED` before calculating whole batches and ingredients.
Other accepted orders on the same day are excluded. A selected pending, completed,
missing, or foreign order is rejected rather than replaced with a combined list.
An explicit date command, such as `plan October 10, 2026`, or a fresh `orders` list
returns ingredient planning to the combined accepted orders for those dates.
Labels and notifications retain their existing date-based selection.

`cancel` exits an unfinished setup. Recipe, form, and notification setup state
persists across process restarts in Neon. The form's fulfillment date accepts
named dates and relative days; its closing deadline still requires a timestamp
with a timezone.

After listing orders, `receipt 1` requests the first order's itemized receipt;
use `receipt 2`, etc. for the other orders. `receipt for order 1` also works.
If only one order was listed, `receipt` is enough. The selected order list
persists across restarts. Receipts include the business, customer, order reference,
fulfillment date, current order status, saved item prices and quantities,
subtotal, delivery fee, and total. They are available for any listed order status
and do not change the order or send a customer notification.

Receipt text appears directly in chat. iMessage also provides a private printable
link when public hosting is configured; it expires after one hour. The CLI saves
each receipt as `artifacts/caterer-receipt-<order-id>.html`, printable to paper or
PDF. Prices come from the order snapshot, so later menu changes do not alter them.
The app does not record payments; these are order receipts and do not confirm payment.

Six boxes of 12 require 72 dumplings. At a measured yield of 60 per batch, the plan
uses **two whole batches**, lists the ingredients for two batches, and reports a
surplus of 48. Fill must fit the container. Grams/kilograms and milliliters/liters
convert exactly; mass-to-volume conversions are rejected because density has not
been supplied. Counted products use whole numbers. No recipe yield is guessed.

`labels` in the CLI writes `artifacts/caterer-labels.html`. Open it and print to
paper or PDF. Labels include business, product/container, customer, order reference,
package count, fulfillment date, supplied ingredients/allergens, and storage text.
Optional `preparedOn`/`useBy` dates can be supplied to the labels tool; they are
never inferred. These are distribution labels, not a regulatory label generator.

## Fetch access

Set `FETCH_CATERER_ALLOWED_SENDERS` to comma-separated **trusted owner-controlled
Fetch agent addresses**, then run:

```bash
npm run caterer:fetch
```

The seed is separate from the customer agent's seed. Connect this new local agent
to its own [Agentverse mailbox](https://uagents.fetch.ai/docs/agentverse/mailbox).
An empty allowlist permits startup and registration but denies all management
requests. Open the printed Agentverse inspector URL in your signed-in browser and
choose **Connect → Mailbox** to attach the caterer agent to your account. The
profile publishes `fetch_agent/caterer-profile.md`, its description, and its Chat
Protocol. The inspector and status endpoint bind to loopback.

Authorize only trusted owner-controlled Fetch senders in
`FETCH_CATERER_ALLOWED_SENDERS`, then restart `caterer:fetch`. Do not allowlist a
shared relay/router that represents unrelated users. Such a relay requires a
verified end-user identity integration first. Local CLI verification does not
complete mailbox registration or owner access.

When the existing Photon backend is running on 4005, set
`FETCH_CATERER_BACKEND_PORT=4005` locally to reuse it. Otherwise the Fetch launcher
uses `CATERER_BACKEND_PORT`, normally 4002. This override applies only to the Fetch
launcher. Its status is at `/caterer/fetch-health` on `FETCH_CATERER_PORT`, normally
8002. A running status does not by itself confirm Agentverse account registration.
The CLI works without Fetch authentication or a paid LLM key.

## Grocery provider connections

For an API-free presentation, set `INSTACART_DEMO_MODE=true` in the local `.env`
and restart the caterer backend/Photon worker. `order ingredients` then produces
a **DEMO ONLY** basket with fictional products, pack sizes, prices, a service fee,
and a sample pickup window. Ingredient requirements still come from accepted
orders and saved recipes; the service rounds sample packages up to cover them.
An empty production plan stays empty. No retailer is contacted, no checkout is
performed, and no grocery order is created. This mode takes precedence even if
an API key is present. Clear the setting to return to the live adapter.

iMessage includes a private document link, using the same one-hour access as
labels. The CLI saves `artifacts/caterer-groceries.html`. The document clearly
marks its sample data, distinguishes required from purchased quantities, and
shows a disabled checkout button. Demo data never changes caterer menu prices
or customer orders.

`INSTACART_API_KEY` enables the
[Instacart shopping-list API](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page/).
Store this developer key only in the local ignored `.env`. Set
`INSTACART_ENVIRONMENT=production` for a production key; the default is the
development endpoint, whose replies are marked as test links.

Send `plan June 10, 2030`, then `order ingredients` (also `instacart` or
`order all ingredients from instacart`). The service calculates whole recipe
batches from accepted orders for that selected period, combines shared ingredients
across products, and submits every ingredient and its measured quantity in one
shopping-list request. It returns the provider's link alongside the complete list.
Review product matches, package sizes, ingredients already on hand, substitutions,
prices, and pickup slots on Instacart. **This API creates a shopping list; it does
not place a paid order.** Complete checkout in Instacart. If the connection is
missing or unavailable, the agent still returns the calculated ingredient list
and explains that no order was placed.

`KROGER_ACCESS_TOKEN` and `KROGER_LOCATION_ID` enable current store-specific
promotion lookup through [Kroger's products API](https://www.postman.com/kroger/the-kroger-co-s-public-workspace/documentation/ki6utqb/kroger-public-apis).
Provision a product-read API token through the provider's developer account and
keep it in the local secret store. Refresh it when it expires; OAuth enrollment
and automatic token refresh are not implemented here. Set the actual nearby store
ID; the service does not guess a location. It searches the first five product
matches for each ingredient (up to 30 ingredients), reports only valid returned
promotions, and includes pack size and check time. It does not claim to search all
supermarkets, guarantee future prices, infer offer expiry, or automatically choose
ingredient substitutions. Verify pack sizes and suitability before buying.

These adapters have mocked contract tests. No live retailer account was connected
and no purchase was made during verification. Outside demo mode, without credentials the agent gives
the ingredient list and reports the missing connection explicitly.

## Messaging provider connection

`notify` creates drafts only. To use a manually entered number, send
`notification 1 to +12025550143`, replacing the example with the intended
recipient's international phone number. This changes only that numbered draft
and displays the updated recipient and message for review. The order's saved
customer contact remains unchanged. Only your `DRAFT` notifications can be
edited; sending, sent, or failed notifications cannot be redirected or retried
by changing the number. This command and notification sends do not need the
public form tunnel, but an existing accepted or completed order is required
to create a notification draft.

After reviewing a draft, `send notification` sends it using its saved recipient;
there is no need to retype the phone number or add `confirm`. This uses the only
draft, or the draft whose phone number you most recently set. If several drafts
are waiting and none is selected, choose one with `send notification 2`, using
its listed number. The numbered command also remembers that selection.
`send notification 1 confirm` remains supported.

The send command calls the transport adapter if `CATERER_NOTIFICATION_WEBHOOK_URL` is configured.
`CATERER_NOTIFICATION_WEBHOOK_TOKEN` optionally authenticates it. The
[Photon/iMessage adapter](photon-imessage.md) provides this transport and connects
owner commands to the Fetch caterer agent. `npm run photon:start` configures the
authenticated local notification endpoint for its own backend process.

The webhook receives a POST body `{ "id": "...", "recipient": "...", "text": "..." }`
and an `Idempotency-Key` header equal to the draft ID. The transport must deduplicate
that key and route the contact to the correct messaging provider. A successful
JSON receipt `{ "delivered": true, "messageId": "..." }` or
`{ "accepted": true, "messageId": "..." }` marks the draft `SENT`. The latter means
provider submission only; the agent explicitly reports that delivery/read status
is unconfirmed. Use `delivered` only for confirmed delivery. Timeouts/unconfirmed receipts mark
it `FAILED`; a process crash may leave it `SENDING`. Reconcile those with the
provider before attempting recovery; the agent deliberately does not blindly
retry a potentially delivered message. Existing `SENT` drafts cannot be resent.

## Verification

```bash
npm run typecheck
npm test
npm run test:agent
npm run build
```

For real database checks, create and migrate an isolated Neon branch, save its
connections in ignored `.env.caterer-test`, then run:

```bash
node --import tsx scripts/verify-caterer.ts
node scripts/verify-caterer-http.mjs
```

These scripts reject the shared `.env` database hostname, use fictional records,
and never send messages or purchase groceries. They exercise actual database
transactions, concurrent capacity reservations, totals, authorization, production,
labels, drafts, sessions, and public form submission. Test records remain on the
disposable branch; use a branch expiration. Printed test artifacts are Git-ignored.

The HTTP verification also drives the authenticated Photon message handler through
natural form setup, a fresh conversation engine each turn, deadline clarification,
review and publication, public form submission, and a natural Saturday order lookup.
It uses the provisioned isolated database and a fixed future test calendar. It
does not send a real iMessage or invoke a paid language model.

If TCP migrations are unavailable, the official Drizzle `neon-serverless/migrator`
can run the same committed migrations with a session-capable WebSocket pool using
the **direct** branch URL. This was the verified path in this environment. The
existing shared migration runner was left unchanged.
