# AGENTS.md

## Project Overview

This repository contains an agentic catering platform that connects customers with local, small, and home-owned caterers.

The long-term user experience is conversational. Customers should be able to describe their catering needs naturally, discover matching caterers, view menus, and request orders. Caterers should be able to manage requests, orders, menus, and availability conversationally.

Do not introduce a product name, branding, or visual identity unless explicitly requested.

## Architecture

The intended architecture is:

Customer / Caterer  
→ iMessage  
→ Photon / Spectrum  
→ Backend  
→ Fetch.ai Agent  
→ Tools / Services  
→ Neon PostgreSQL

Responsibilities:

- **Photon / Spectrum:** messaging transport
- **Fetch.ai:** agent orchestration, intent understanding, and tool selection
- **Backend services:** deterministic business logic and validation
- **Neon PostgreSQL:** persistent application state
- **LLM:** natural-language understanding/reasoning where appropriate

Keep these responsibilities separated.

## Technology

Primary stack:

- Node.js
- TypeScript
- PostgreSQL
- Neon
- Drizzle ORM
- Zod
- Vitest
- Fetch.ai / uAgents
- Photon / Spectrum

Use strict TypeScript.

Prefer simple, readable implementations over unnecessary abstractions.

Avoid adding dependencies unless they provide clear value.

## Core Architecture Principle

AI agents must NOT directly implement or bypass marketplace business rules.

Use this pattern:

Agent
→ Tool
→ Service
→ Database

Agents decide **what action to take**.

Services determine **whether and how that action is allowed**.

The database stores the resulting state.

Do not allow an LLM to generate or execute arbitrary SQL.

## Customer Catering Request

The canonical catering request contains these eight dimensions:

1. Date needed
2. Budget
3. Dishes and/or cuisine
4. Headcount
5. Event style
6. Dietary restrictions
7. Location
8. Pickup or delivery preference

The system should support partial requests because customers may provide information over multiple conversational turns.

Do not assume all eight values are present in the first message.

The conversational agent should preserve known information and ask for missing information when necessary.

## Search and Matching

Caterer matching must be grounded in database data.

Relevant factors include:

- date availability
- budget compatibility
- cuisine
- requested dishes
- capacity/headcount
- supported event style
- dietary options
- service location
- pickup/delivery support

Never invent:

- caterers
- menu items
- prices
- availability
- dietary support
- order status

LLM-generated statements about marketplace facts must be grounded in tool/service results.

## Orders

Order statuses are:

- DRAFT
- REQUESTED
- ACCEPTED
- DECLINED
- CANCELLED
- COMPLETED

A customer's request to "book it" must NOT automatically mean the order is accepted.

Typical flow:

DRAFT
→ REQUESTED
→ ACCEPTED or DECLINED

Only the appropriate caterer can accept or decline their order.

Enforce order transitions in deterministic backend code, not in prompts.

## Authorization and Ownership

Design service functions with ownership boundaries even before full authentication exists.

For example, prefer:

acceptOrder(orderId, catererId)

over:

acceptOrder(orderId)

A caterer must not be able to:

- modify another caterer's menu
- modify another caterer's availability
- accept another caterer's order
- decline another caterer's order

Do not rely on the AI agent to enforce authorization.

## Menu Data

Menu items belong to specific caterers.

Orders must only contain menu items belonging to the selected caterer.

Order items should preserve a snapshot of the menu item's price at the time the order is created.

Avoid hard-deleting menu items referenced by historical orders.

Prefer deactivation.

## Money

Do not use floating-point values for money.

Use the monetary representation already established by the project.

Never trust totals supplied by the client or AI agent.

Calculate totals from database-backed prices.

## Database

Use Neon PostgreSQL as the source of truth.

Use Drizzle for schema and database access.

Use migrations for schema changes.

Use transactions for operations requiring multiple related writes.

Maintain appropriate:

- primary keys
- foreign keys
- unique constraints
- indexes
- nullability
- delete behavior

Avoid destructive cascades that could remove historical order data.

## Shared Neon Database Handoff

Before any database, migration, reporting, or deployment work, read
[`docs/neon-database-handoff.md`](docs/neon-database-handoff.md). It explains
the remote Neon architecture, current schema, migration source of truth, and
the state of the shared development database.

If database access is required, request it from **NLI** using the secure access
procedure in that handoff. Do not ask for, accept, print, log, commit, or paste
database credentials into an agent prompt, issue, pull request, chat, source
file, or test output.

## Environment Variables and Secrets

Secrets belong in local environment variables.

DATABASE_URL and API keys must never be:

- hardcoded
- printed
- logged
- committed
- included in README examples
- exposed in test output

Use:

process.env.DATABASE_URL

or the project's established environment configuration.

Keep `.env` files ignored by Git.

Use `.env.example` with empty placeholder values.

If a secret is accidentally exposed, do not reuse it elsewhere in the codebase.

## Fetch.ai

Fetch.ai is the intelligence/orchestration layer.

Its responsibilities may include:

- understanding user intent
- extracting structured catering requirements
- maintaining conversational request state
- determining missing information
- asking follow-up questions
- selecting tools
- coordinating agent interactions

Fetch.ai should call existing backend capabilities rather than duplicate their business logic.

Example:

Natural language
→ Fetch agent
→ search_caterers tool
→ searchCaterers service
→ Neon

Prefer structured tool inputs and outputs.

## Agent Conversation State

The customer may provide information across multiple messages.

For example:

Message 1:
"I need Chinese food for 30 people next Saturday."

Known:
- date
- cuisine
- headcount

Message 2:
"Budget is $500 and it's in Ann Arbor."

Now also known:
- budget
- location

The system should merge new information into the existing request rather than starting over.

Do not rely exclusively on raw LLM conversation history for important application state.

Persist important state where appropriate.

## Photon / Spectrum

Photon / Spectrum is the messaging layer.

It should:

- receive incoming messages
- identify conversations/senders
- pass normalized messages to the backend/agent
- send generated responses back to the user

Photon should not contain marketplace business logic.

Do not mix Photon-specific code into core services.

Messaging integrations should remain replaceable.

## Testing

Business logic should be testable without:

- an LLM
- Fetch.ai
- Photon
- iMessage

Maintain tests for important rules, including:

- input validation
- caterer matching
- availability
- capacity
- dietary requirements
- event styles
- pickup/delivery
- menu ownership
- order creation
- total calculations
- order transitions
- caterer authorization

Agent and messaging integrations should be tested separately from deterministic marketplace logic.

## Seed Data

All seed businesses, customers, names, messaging identifiers, menus, and orders must be fictional.

Seed data should provide enough variation to test matching behavior.

Do not use real personal information.

## Code Organization

Keep major concerns separated.

Prefer a structure similar to:

src/
  db/
  services/
  tools/
  agent/
  messaging/
  validation/
  types/

Do not put database queries, agent prompts, messaging code, and business rules into one large module.

Reuse existing project conventions before introducing new ones.

## Working in This Repository

Before making changes:

1. Inspect the existing implementation.
2. Understand current conventions and architecture.
3. Preserve working code unless there is a clear reason to change it.
4. Check existing types and utilities before creating duplicates.
5. Keep changes scoped to the requested task.

After making changes:

1. Run type checking.
2. Run relevant tests.
3. Run the build.
4. Run migrations when schema changes require them.
5. Fix failures caused by the changes.
6. Summarize important architectural decisions.

Do not silently make large architectural changes.

## Current Development Sequence

The project is being built incrementally.

### Phase 1 — Data foundation
Backend, Neon, database schema, validation, seed data.

### Phase 2 — Marketplace business logic
Search, menus, availability, orders, state transitions, caterer management.

### Phase 3 — Agent layer
Fetch.ai integration, conversational request collection, tool selection, and agent behavior.

### Phase 4 — Messaging workflow
Local/two-sided customer and caterer messaging flows.

### Phase 5 — Photon / iMessage
Connect messaging infrastructure to the working agent/backend.

### Phase 6 — End-to-end demo
Customer request → caterer discovery → order request → caterer acceptance → customer confirmation.

Do not skip ahead to later phases unless explicitly instructed.

## Current Priority

Preserve the separation:

**conversation → agent → tools → services → database**

The agent should make the existing marketplace capabilities easier to use conversationally, not replace the underlying business logic.
