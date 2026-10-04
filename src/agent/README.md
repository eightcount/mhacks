# Fetch.ai integration boundary

`internal-api.ts` is a loopback-only, token-protected HTTP boundary between the
Python Fetch.ai adapter and the TypeScript marketplace tools. It exposes no raw
database access. Each route validates inputs and delegates to the existing
services, which retain ownership, pricing, availability, and order-transition
rules.

Each conversation can hold up to 20 independent catering plans. Its original
request stays in its existing `catering_request_states` row; additional events
use customer-owned conversations with an `agent-request:<root UUID>:` external
identifier. The context service loads only that root and its associated events,
keeps their numbering stable, and resumes the most recently activated request.
Recent messages belong to the root conversation. Structured state remains the
source of truth after process restarts; no schema migration is required.

The model receives all known event plans and the last 24 conversation messages.
It returns validated intents and request updates, not SQL or marketplace facts.
Array preference updates replace the old array so corrections and explicit
clearing work; an additive update includes the existing values.

`get_orders` requires a customer ID and returns that customer's stored order
items, quantities, price snapshots, totals, caterer names, dates, locations, and
statuses across conversations. `get_order` also requires a customer ID and
checks ownership before returning items. These are authenticated internal tools,
not public endpoints. The Fetch adapter still uses the configured fictional
demo customer until per-sender authentication is implemented.

General language interpretation requires a locally configured `ASI1_API_KEY`.
Without it, the offline parser supports common phrasing, multiple explicit event
clauses, event references, shared preferences, and order-history questions, but
it cannot interpret arbitrary language. Configure the key only in ignored local
environment storage and restart the Python process. Restart the backend too
after pulling changes to these routes.

The transport-facing Fetch uAgent lives in `fetch_agent/`. This separation lets
the same deterministic marketplace tools serve a local CLI now and a future
Photon/Spectrum adapter later without putting messaging code in services.
