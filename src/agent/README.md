# Fetch.ai integration boundary

`internal-api.ts` is a loopback-only, token-protected HTTP boundary between the
Python Fetch.ai adapter and the TypeScript marketplace tools. It exposes no raw
database access. Each route validates inputs and delegates to the existing
services, which retain ownership, pricing, availability, and order-transition
rules.

The transport-facing Fetch uAgent lives in `fetch_agent/`. This separation lets
the same deterministic marketplace tools serve a local CLI now and a future
Photon/Spectrum adapter later without putting messaging code in services.
