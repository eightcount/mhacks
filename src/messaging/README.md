# Future messaging integration

The caterer Photon/Spectrum transport is implemented here. See [setup and verification](../../docs/photon-imessage.md).

`photon.ts` connects the pinned official iMessage SDK. `photon-router.ts` normalizes
owner messages, deduplicates events through backend tools, invokes the local Fetch
bridge, and sends replies. `photon-notifications.ts` sends only owner-approved,
persisted notification drafts. `photon-public.ts` exposes only form and signed
label routes through a temporary HTTPS tunnel.

Marketplace decisions stay in services. The transport never queries Neon directly.
The customer agent is not connected by this adapter.
