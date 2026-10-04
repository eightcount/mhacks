# Caterer iMessage setup

The caterer workflow can run through Photon/Spectrum. Live operation requires a
Photon project with iMessage enabled and three local settings. The account itself
does not automatically connect this repository.

## Finish the Photon account setup

1. In [Photon](https://app.photon.codes), create a project if you do not already
   have one for this integration. Enable/provision its iMessage connection and
   finish any activation steps shown by Photon. Note the agent's messaging address.
2. Save the project's credentials and **your personal sending address** locally:

   ```dotenv
   IMESSAGE_PROJECT_ID=
   IMESSAGE_PROJECT_SECRET=
   CATERER_OWNER_IMESSAGE=
   ```

   Keep values in the ignored `.env`; do not paste secrets into chat or commit
   them. The owner address is the international phone number (leading `+` and
   country code) or Apple ID email you will send from. It is not the agent's
   Photon address. Only messages from that owner can execute caterer commands.
3. If the project has multiple iMessage lines, set `IMESSAGE_LINE` to the intended
   Photon line. Otherwise use a project with one line for this demo. Replies use
   the incoming conversation's line; notifications use the configured line, or
   the SDK's default line selection when this setting is absent.
4. Run `npm run photon:check`. It reports configuration presence, never values.

If Photon gives you an `npm create spectrum-project ... --projectId ...` command,
this repository already has the application scaffold. Set its project ID as
`IMESSAGE_PROJECT_ID` locally, then run `npm run photon:connect`. This signs in
through the official Photon CLI and reads the existing project secret directly
into `.env`. Approve the displayed device login in your browser. The helper does
not create another project or rotate a secret. Login credentials stay in ignored
`artifacts/photon-auth`; the CLI is installed under `artifacts/photon-cli`.
You still need to set your own `CATERER_OWNER_IMESSAGE` address locally.

The existing `CATERER_ID`, `CATERER_OWNER_USER_ID`, `CATERER_INTERNAL_TOKEN`,
`FETCH_CATERER_SEED`, and Neon connection must already be configured. For a fresh
fictional demo environment, run `npm run caterer:configure` and follow
[the database handoff](neon-database-handoff.md). Do not reseed a shared database.

## Start locally

For phone-accessible order forms and printable labels, start the public gateway
first:

```bash
npm run photon:tunnel
```

This uses `cloudflared` from `artifacts/bin/cloudflared` if installed there, or from
your PATH. On this workspace, the official macOS ARM64 release was installed and
checked against its published SHA-256 digest. On another machine, install it
using the [official instructions](https://developers.cloudflare.com/tunnel/downloads/).

If Cloudflare's edge connection times out, set `PHOTON_TUNNEL_PROVIDER=localhost-run`
in local `.env` and restart `photon:tunnel`. This uses the free SSH tunnel described
in [localhost.run's documentation](https://localhost.run/docs/). It uses no private
SSH keys or account, verifies new host keys with a dedicated local known-hosts
file, and forwards only the restricted public gateway. This workspace uses that
provider because Cloudflare's outbound connection timed out. Both providers expose
temporary HTTPS links and require the tunnel process to keep running.

The helper waits for the provider to confirm a connection before saving a new
public URL. Cloudflare diagnostics are kept in ignored `artifacts/photon-tunnel.log`;
the helper suppresses SSH banners and request logs.

The command writes the temporary HTTPS origin to `CATERER_PUBLIC_BASE_URL` in local
`.env`. Keep it running. Every tunnel restart creates a new hostname: restart the
agent and ask for `forms` to obtain new links. Old links stop working. This is a
development tunnel, not permanent hosting. Existing database credentials remain
unchanged. Only `/forms/:id` and signed `/documents/:key` reads are exposed; owner
tools, the Fetch bridge, and notification sends stay on loopback.

In a second terminal:

```bash
npm run photon:check
npm run photon:start
```

`photon:start` runs three processes and stops its own children on Ctrl-C:

| Process | Default port | Purpose |
| --- | --- | --- |
| Caterer backend | 4005 | Validated tools and Neon-backed business operations |
| Fetch uAgent bridge | 8003 | Authenticated REST entry into the caterer conversation |
| Photon worker | 4003 | Persistent message stream, replies, approved notification transport |
| Optional public gateway | 4004 | Forms and signed labels only |

Override with `PHOTON_BACKEND_PORT`, `CATERER_BRIDGE_PORT`, `PHOTON_LOCAL_PORT`, and
`PHOTON_PUBLIC_PORT`. These defaults leave the CLI backend on 4002 undisturbed.
The start command configures the local notification adapter in child-process
environment variables; there is no webhook URL to enter in Photon for this
persistent-stream implementation. Agentverse mailbox setup is not required for
this local Fetch REST path. The CLI and mailbox adapters remain available.

For messaging commands alone, the tunnel is optional. Without a public HTTPS
origin, generated form links are local and printable labels remain accessible
through the CLI. Keep your computer awake and the processes running for the demo.

## Verify from iMessage

Send a **new direct message** from `CATERER_OWNER_IMESSAGE` to the agent's Photon
address after startup:

1. Send `menu`. Expect the actual caterer's products and database prices.
2. Send `new recipe` if the products have no container/recipe definitions. Complete
   the wizard; `cancel` exits it. Ingredients require amounts, such as
   `flour: 500 g; water: 300 ml`.
3. Send `new form`. Enter `1:50` to sell up to 50 packages of product 1, then answer
   the title/date/deadline/fulfillment/minimum/fee questions. A title or bare `1`
   at the product-selection step now explains the expected format.
4. Open the resulting form on your phone and submit a fictional test order. It
   starts as `REQUESTED`.
5. Send the order's date, for example `June 15, 2030`, or a range such as
   `orders June 10–16, 2030`. Then send `accept 1` or `decline 1`.
   A bare `1` explains the available actions; it does not accept an order.
6. Send `plan`, then `order ingredients` to prepare all ingredients together for
   the selected day or range. For a fictional basket and private demo document,
   set `INSTACART_DEMO_MODE=true` locally and restart `photon:start`; no API key
   is needed and no grocery order is placed. A live shopping link requires `INSTACART_API_KEY`;
   set `INSTACART_ENVIRONMENT=production` when using a production key. You review
   the list and complete checkout in Instacart. Send `labels` for printable labels.
   Accepted orders contribute to production. The label link expires in one hour;
   request labels again if needed.
7. `notify` keeps that selected period and drafts customer updates. Review the recipient and
   body. Only `send notification 1 confirm` submits a draft to iMessage. The form
   contact must be an international phone number or an Apple ID email reachable
   through iMessage. Test with a contact you control.

`June 10th`, `orders tomorrow`, and `plan next week` also work. Dates without a
year use the last selected year, or the current year for a new conversation.
Replies show the resolved date and year. `orders` alone returns to this week;
follow-up reports keep the selected dates across restarts.

The current caterer agent uses guided commands and structured forms. Arbitrary
natural-language requests are not yet supported for every operation. Groceries
produce a list or reviewable shopping link; automatic checkout is not implemented.

## Boundaries and recovery

The flow is iMessage → Spectrum transport/backend → Fetch uAgent → TypeScript
tools → services → Neon. Services check ownership and enforce order transitions.
Photon does not implement marketplace rules, and the Python agent has no database
credentials in its code or database queries.

Only the configured owner's direct messages are processed. Group chats, other
senders, outbound echoes, non-text content, and events dated before worker startup
are ignored. Send a fresh command after a restart; offline backlog is not replayed.
Customer replies do not enter the caterer agent. Customer-side iMessage routing
and multi-owner onboarding are outside this adapter's scope.

Conversation IDs include project, line, chat, and owner; their hashes are stored
in the existing `caterer_agent_sessions` table. Transport receipts use a separate
prefix in the same table, so no new migration is needed. Database claims prevent
duplicate events from repeating an operation or send, including across process
restarts. A crash during `PROCESSING` or `SENDING`, or an uncertain provider send,
requires reconciliation. Check `orders`/`forms` and the provider's receipt before
retrying the command. This favors avoiding duplicate side effects over automatic
retries; it does not promise exactly-once delivery.

Notification `SENT` means a provider submission receipt was returned. The reply
explicitly distinguishes submission from confirmed delivery/read status. An
unconfirmed attempt is `FAILED` or remains `SENDING` after a crash; neither is
automatically retried. Do not reset receipts to force a resend without checking
the actual provider state.

The official SDK is pinned to 12.10.1. Its published declaration has an
`exactOptionalPropertyTypes` incompatibility. `photon-sdk.ts` contains the minimal
typed boundary for the methods used here, and runtime-validates provider-specific
space fields. Project-wide strict TypeScript settings remain enabled. Telemetry
and SDK logging are disabled; application logs omit sender IDs, message bodies,
and credentials.

## Developer verification

```bash
npm run typecheck
npm test
npm run test:agent
npm run build
node --import tsx scripts/verify-photon.ts
```

The last command requires an already migrated isolated branch in the ignored
`.env.caterer-test`. It refuses the shared database hostname. It starts real local
backend/Fetch processes, exercises the real Neon services, natural dates and
persisted report periods, concurrent claims, ownership, signed labels and the
restricted public gateway, and substitutes an
in-memory outbound sender. It does not connect Photon or send real messages.
The grocery demo check creates a fictional accepted catering order on that branch,
verifies its signed basket document, then closes the form and completes the order.
It makes no retailer calls and saves a sample to `artifacts/caterer-groceries-demo.html`.
Fictional test records remain on the disposable branch.

Official references: [Spectrum setup and persistent streams](https://github.com/photon-hq/spectrum-ts),
[Cloudflare development tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
