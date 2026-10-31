# LifeOS personal health wrapper

Independent read-only Oura API-to-MCP implementation in the full LifeOS Mac
repository. Not Oura's official MCP. No provider endorsement or compliance claim.
The deployment remains disabled until explicit configuration and owner consent.

Public pages: `/oura`, `/oura/privacy`, `/oura/terms`.
OAuth start: `/oura/connect`; exact callback: `/oura/callback`.
Protected stateless MCP: `/mcp`, owner bearer authentication, JSON Streamable HTTP
subset (2025-03-26 and 2025-06-18). Tools read daily sleep/activity/readiness.
Client OAuth is implemented using @cloudflare/workers-oauth-provider 1.2.1,
with an isolated OAUTH_KV binding required before activation.

`integration.mjs` implements PKCE S256, one-use browser-bound state, AES-GCM
credential storage, serialized token refresh, input bounds and rate controls.
`worker.mjs` gates integration routes before any state or upstream access.
No storage binding or credentials are in the deployment configuration.
No health records are cached. No connection to local Convex or the mirror.

Run `npm test` for synthetic security and protocol tests. See ACTIVATION.md for
exact storage targets, configuration boundaries and client compatibility limits.
Read the provider terms before activation. A wrapper does not remove restrictions
on providing Oura API data to AI systems.
