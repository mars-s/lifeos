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

MCP clients may register one to five HTTPS or HTTP loopback redirects. HTTP is
limited to `127.0.0.1`, `[::1]` and `localhost`, on any port; fragments and userinfo
are rejected. All Oura API requests send
`User-Agent: LifeOS-Oura/1.0 (+https://github.com/mars-s/lifeos)`.

Client discovery uses `/.well-known/oauth-protected-resource/mcp` for resource
`https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/mcp`. The root
`/.well-known/oauth-protected-resource` now redirects GET/HEAD with HTTP 307 to
that canonical document. It previously returned 404 in provider 1.2.1. This is
a compatibility redirect for clients that probe the root, not a second resource
identifier. Clients must follow it or use the challenge's canonical URL.
[RFC 9728](https://www.rfc-editor.org/rfc/rfc9728.html#section-3.3) requires the
metadata resource identifier to match; serving an alias document at the root
would be misleading. Root discovery is not mandatory for a resource at `/mcp`.

The resource metadata and MCP `WWW-Authenticate` challenge require `oura:read`.
The authorisation server issuer is the service origin, with discovery at
`/.well-known/oauth-authorization-server`; its scopes also include
`offline_access`, an OAuth capability rather than a resource requirement.
These values were already consistent and remain unchanged.

Browser CORS permits any origin without credential support on these exact
protocol routes only: discovery GET/HEAD, `/oauth/register` and `/oauth/token`
POST, and `/mcp` GET/POST. OPTIONS validates the requested method and an explicit
OAuth/MCP header list. `WWW-Authenticate`, `Retry-After` and MCP response headers
are exposed. The provider already supplied CORS and challenge exposure; the old
worker Origin allowlist blocked browsers outside the service and ChatGPT before
they reached it. The fixed service host check, bearer validation, owner check,
consent cookie binding, S256 PKCE and request size limit remain enforced.
Owner pages and `/authorize` have no permissive CORS. Consent POST requires the
exact service Origin and a supported form content type.

Opening bare `/authorize` is not a sign-in entry point. It returns HTTP 400 with
fixed `invalid_request` guidance to start from the MCP client, without a consent
cookie, redirect, grant or inferred parameters. A client must supply its
registered client ID, registered redirect URI, `response_type=code` and S256
PKCE challenge. Partial or invalid requests also fail closed. A successful
standard OAuth flow does not establish how Grok constructs its in-chat request;
without request telemetry, neither the reason for a bare URL nor Grok
interoperability is proven by this fix.

Refresh failures retain stored tokens unless the token endpoint returns HTTP
400 or 401 with JSON `invalid_grant`. A data-read 401 triggers one refresh and
one retry; a second 401 suggests reconnecting without deleting tokens. Ambiguous
refresh outcomes retain the old token: if it has rotated, a later definitive
`invalid_grant` clears it. Temporary provider failures report that tokens are kept.
