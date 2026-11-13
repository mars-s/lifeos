# Latest MCP client OAuth implementation

Version `b4571e7a-fa93-4d2b-8b0e-0b01f5f4b7b6`, October 22, 2026.
Credential-free deployment, no new bindings or grants activated.
18 tests pass, including isolated local-runtime OAuth registration, strict redirect
validation, owner consent, browser CSRF binding, PKCE exchange, replay rejection,
and authenticated MCP tool listing. npm audit reports zero vulnerabilities.
Local runtime uses compatibility date 2026-08-06; cloud config uses 2026-10-22.
Public pages return 200; client/Oura OAuth and MCP routes return intentional 503.
No real Oura exchange or dot/ChatGPT client connection has occurred.

# Current credential-free wrapper deployment

Version: `7fe9b0b0-f349-4b23-af15-ab1e68281682`, deployed October 22, 2026.
Upload 24.78 KiB, gzip 8.50 KiB, reported startup 2 ms.
17 synthetic tests pass, and Wrangler dry-run passes with no bindings.
HTTPS website/privacy/terms return 200; connect/callback/MCP return intentional
503 because credentials, Durable Object binding and activation flag are absent.
The pasted client secret was not retrieved, copied or configured by this worker.
See ACTIVATION.md for direct secure input and exact remaining configuration.
No end-to-end Oura authorization or MCP client connection has been verified.

## Earlier setup-only deployment and mirror restoration

# Verified deployment, October 22, 2026

Worker: `lifeos-app-setup`, deployed from this package on `avi/convex-backend`.
Version: `f962c45f-3041-4010-a676-5e81b0d223fc`, 100% traffic.
Published: `2026-10-22T12:57:19.745Z`. Upload 7.01 KiB; zero bindings verified.

- Website: https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura
- Privacy: https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/privacy
- Terms: https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/terms
- Reserved redirect: https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/callback

The public pages returned HTTP 200. Callback returned intentional HTTP 503,
including with dummy code/state parameters, and reflected no parameters.
The four Node tests passed. Browser inspection confirmed the live landing page.
This is setup-only; OAuth is not operational and no health access is enabled.
No new credentials, grants, storage, paid plan changes, or provider agreement
acceptance occurred. The Worker makes no outgoing requests.

An earlier same-task setup deployment to the mirror was restored after the user
clarified the destination. Guarded rollback checked the exact current deployment
and unchanged bindings before restoring original version
`e914ad59-c469-4d61-8a1a-4912221d1309` at 100%. Rollback deployment:
`51e8cb86-045a-4419-a188-f06519fc37d3`, `2026-10-22T12:56:07.521425Z`.
The old mirror /oura returned 404 afterwards; /health 200 and /state 401.
The mirror and local Convex remain separate from this host.

## Approved activation, 2026-10-22

Deployed version `5a9c09f5-7617-4bd6-94b1-b18c7619ea55` to the separate `lifeos-app-setup` Worker. Existing OURA_CLIENT_SECRET preserved. OWNER_KEY_HASH and TOKEN_ENCRYPTION_KEY configured securely. Isolated OAUTH_KV namespace `2e39e5b659224df78e83e1287d5df2ba` and OuraVault SQLite Durable Object binding provisioned. No mirror or Convex changes.

Live checks: website/privacy/terms/connect and both OAuth discovery endpoints 200; callback without transaction 400; unauthenticated MCP/status 401. Authenticated status connected=false. All 18 tests passed with local runtime listener permission. Python urllib received an edge 403; curl succeeded.

No real Oura grant or MCP client grant has been approved by this deployment. User must complete both consent screens. Seven upstream scopes: personal daily heartrate workout tag session spo2. Client access tokens expire after one hour, refresh access after up to 30 days.

Owner credential is stored outside this repository in a private local credential file with mode 0600. Its parent directory has mode 0700. Never copy its contents into source, logs, chat, or URLs.

## Browser origin fix, 2026-10-22

Version `6107d296-9561-4fad-9dc5-37df7e8a9f72`: reproduced POST /oura/connect Origin denied in browser using an invalid fixture key. Form document no-referrer policy caused opaque Origin; set same-origin referrer policy only on connect and client-consent form pages. Strict server origin checks unchanged. Connect form CSP permits the exact intended Oura authorize redirect. Callback/error responses retain no-referrer. Browser retest reaches Owner authorization required for invalid key. 19 tests passed. No credentials or grants created by this fix.

## Developer portal endpoint correction, 2026-10-23

Read-only authenticated portal inspection confirmed exact configured client ID, Development app, matching registered callback, and generated authorization endpoint https://developer.ouraring.com/authorize . Changed only upstream authorization endpoint from legacy cloud URL; token endpoint, PKCE, state, scopes, origin checks and credentials unchanged. Version 8f1dc966-24d2-4285-baa1-2ad1baf7ee0d. All 19 tests pass. Existing provider error session preserved. No new grant initiated in this diagnostic step. Live connect/discovery 200 and unauthenticated MCP 401.

## New issuer token endpoint, 2026-10-23

Callback structurally contained one code, one state, and issuer https://moi.ouraring.com/oauth/v2/ext/oauth-anonymous, with no provider error. No values retained or replayed. Public issuer discovery at that issuer plus /.well-known/openid-configuration identified https://moi.ouraring.com/oauth/v2/ext/oauth-token and client_secret_post support. Updated token and refresh exchanges to this fixed endpoint; added optional issuer validation and sanitized callback failure categories. No origins/scopes/credentials broadened. Version 2de31d8b-a38a-4b5e-b2f3-027c35576080; 20 tests pass. Historical generic response cannot establish which validation/exchange branch failed. Observability remains disabled; no secret-bearing logs enabled. Live connect/discovery 200; unauth MCP 401; connected=false. A fresh user consent attempt is necessary; never reload/replay failed callback.

## Documented API endpoint correction, 2026-10-23

The prior issuer-derived token endpoint change was unsupported by the application integration documentation. https://cloud.ouraring.com/docs/authentication explicitly retains https://api.ouraring.com/oauth/token alongside the new https://developer.ouraring.com/authorize URL. https://cloud.ouraring.com/v2/static/json/openapi-1.42.json independently specifies that API token URL. Restored the documented endpoint for code and refresh exchange; issuer validation remains separate and unchanged. Added fixed allowlisted OAuth error categories and response-format classification, with no raw body/description logging or retention. Removed the inaccurate all-available-scopes wording; requested scopes unchanged.

All 22 tests pass, including endpoint pair, UTF-8 form encoding, single client authentication method, exact redirect, original PKCE verifier, sanitized errors and non-replay. These use synthetic upstream responses and do not prove Oura interoperability. Deployed with --keep-vars; version bd852891-1e97-4ba2-91a4-c8a0c9dfec2a. No codes replayed, no OAuth grant initiated during deployment, no secrets changed. Original generic failure and later HTTP 403 cannot be definitively classified because earlier implementation discarded upstream error details. Support attribution is not justified.

## Exact published scope aliases, 2026-10-23

User reported scope validation failure after documented token exchange. Authenticated status verified disconnected. The prior response was not retained, so its exact scope representation cannot be recovered or asserted. Public issuer discovery lists extapi:personal, extapi:daily, extapi:heartrate, extapi:workout, extapi:tag, extapi:session, and extapi:spo2. Added explicit aliases for those seven names only, alongside original names. No generic prefix stripping, email, write, unknown scopes or new requested scopes accepted. Non-string scope formats still rejected with a distinct diagnostic. Normalized granted scope list retained in encrypted token record. Code and refresh exchange share validation.

24 tests pass including prefixed complete/subset grants, unknown privilege rejection, malformed formats and refresh validation. Deployed --keep-vars version c46626c5-b1ca-467c-a6a1-84ef19bc1162. No code replay, credential changes or new consent initiated. Exact historical cause remains uncertain; no claim of connected status or guaranteed fix.
