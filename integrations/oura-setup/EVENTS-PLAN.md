# Conversational access and event activation plan

Current production: c46626c5-b1ca-467c-a6a1-84ef19bc1162. Oura OAuth connected; no hosted MCP client grant verified. Current public MCP requires client OAuth; owner key alone is not a read access token.

Local prepared work (not deployed): webhooks.mjs, webhooks.test.mjs and integration routing/freshness tool. 27 tests pass with synthetic data. Inbound /oura/webhook is disabled unless OURA_WEBHOOK_ENABLED, OURA_WEBHOOK_VERIFY_TOKEN, OURA_WEBHOOK_OWNER_ID_HASH and existing OURA_CLIENT_SECRET are configured. Exact approved data-type list in WEBHOOK_TYPES. Signed requests are owner-bound, timestamp checked, size bounded and deduplicated; only encrypted notification metadata/hash retained, capped at 128 events and 24 hours. No automatic data fetch, outgoing notifications or monitoring task. HMAC follows Oura's documented timestamp + JSON.stringify(body) recipe. Provider retry/signing timestamp behavior needs live verification at activation.

## Hosted plugin installation

Official route supplied by parent and supported by docs: ChatGPT Plugins > plus > Add custom MCP server > https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/mcp > OAuth > Create as plugin > install. This must be a hosted plugin, not local Codex MCP configuration. Actual UI was not verified: cua.getApp(com.openai.codex) was rejected by computer-use safety restriction. Do not work around this restriction. Parent/user must inspect the hosted plugin flow and confirm actual callback destination before granting access. No installed LifeOS event source is currently verified.

## MCP Events bridge: current local implementation status

Source: https://developers.openai.com/plugins/build/mcp-events
Requires protocol 2026-07-28 with server/discover and MCP 2.0 response envelope support, authenticated events/list, events/subscribe, events/unsubscribe, encrypted durable subscription state and outbound HTTPS. Existing 2025 MCP tool handling is not sufficient. Do not simply advertise an events capability.

Expose one event, oura.data_changed, filtered by exact allowed data_type and create/update/delete. Payload should contain only data_type, event_type and event_time; omit object/user IDs, health scores and free text. Delivery is a wake-up; bounded read tools retrieve data only as requested by the user. No default automatic health alerts.

Bind subscriptions to authenticated client identity, owner, current Oura connection ID and grant validity. Current internal forwarding carries only connectionId, so add authenticated client identity before implementing subscriptions. Reject callbacks outside an explicitly approved exact HTTPS destination. Challenge verification must occur before storing an active subscription. Resolve and validate public addresses at connection time; do not follow redirects. A Worker runtime mechanism that satisfies this DNS/address requirement must be verified before any outbound bridge is enabled. Exact callback URL is currently unknown, so activation approval cannot yet name it honestly.

Store ChatGPT-provided whsec_ secret encrypted; require 24-64 decoded bytes. Standard Webhooks signs the serialized body once, with stable event ID, fresh Unix signing timestamp and subscription ID. Persist pending delivery separately from inbound dedup to avoid lost notifications after acknowledgment. Use bounded exponential retries; stop on 410/413, expiry, revocation or connection change. No health payload in queue/logs. Default subscription lifetime 24 hours, cap at 24 hours and underlying grant expiry; allow explicit refresh only under approved overall duration, never indefinite lifetime. Preserve cursor:null and make non-replay limitation explicit. Implement secret replacement and short dual-signature rotation as documented.

Required bridge regression tests before deployment: protocol discovery/envelopes; unauthenticated method rejection; exact filter schema; cross-client isolation; exact callback allowlist and redirect/private-address rejection; challenge mismatch/timeouts; whsec validation and signing vectors; idempotent subscription identity; expiry/revocation; crash-safe queue/dedup separation; retry stop conditions; out-of-order delivery; unsubscribe idempotency; no secret/health leakage. See implementation update below for completed tests and remaining runtime work.

## Bundled activation proposal, pending exact hosted callback

1. Install personal hosted LifeOS plugin in Avi's ChatGPT/dot account, approve only oura:read and offline_access; access token one hour, refresh at most 30 days. User approves OAuth consent with private owner key. This sends requested Oura health reads to ChatGPT under its retention policies.
2. Create one webhook verification secret in lifeos-app-setup encrypted secrets and bind webhook owner identity by hash of the connected Oura user's ID; obtain that ID through an approved minimal personal_info read without printing it. Reuse existing Oura client secret for documented subscription authentication and signature verification only.
3. Register create/update/delete notifications for daily_sleep, daily_readiness, daily_activity, daily_spo2, daily_stress, sleep, sleep_time, rest_mode_period, workout, session, tag and enhanced_tag at https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/webhook (36 subscriptions). Omit heart_health, ring configuration, email and writes. Initial subscriptions only; record actual provider expiration_time, no automatic renewal until duration is agreed. Local ingestion must enforce the approved activation deadline before activation. Notifications disclose record/user identifiers and event metadata to the existing Worker; discard raw IDs after owner validation/dedup hashing. Encrypt metadata for at most 24 hours.
4. After hosted plugin installation supplies the actual ChatGPT event callback, separately enumerate that exact destination in the final approval bundle. Store its supplied signing secret encrypted in the same Worker. Activate metadata-only forwarding for a finite agreed period, with no automatic monitoring instructions or alerts. Do not treat permission to read data as permission to create event-triggered tasks.

Do not request final activation approval until outgoing bridge implementation/testing, exact callback destination, grant binding and enforced duration are concrete. No new secrets, grants, subscriptions or deployment occurred in this preparation turn.

Sources: https://cloud.ouraring.com/v2/static/json/openapi-1.42.json ; https://cloud.ouraring.com/v2/docs ; https://developers.openai.com/plugins/build/mcp-events ; https://developers.openai.com/plugins/deploy/connect-chatgpt


## Implementation update

Implemented events-bridge.mjs and events-bridge.test.mjs. The local engine supports encrypted durable subscriptions bound to owner/client/connection, exact callback constraints, signed challenge and bounded response validation, canonical idempotent subscription IDs, TTL capped at 24 hours and authenticated token expiry, Standard Webhooks signing, five-minute dual-signature rotation, durable dedup/queue in one encrypted write, stable event IDs, bounded exponential retries, terminal 410/413 handling, expiry/revocation checks, unsubscribe and finite activation deadline. No live traffic was used. 37 full-suite tests pass, including independent Node HMAC signature comparison and disabled protocol routing.

Local integration forwards only authenticated client metadata through stripped/replaced internal headers. It routes MCP Events methods and MCP 2 server/discover, enqueues before inbound metadata acknowledgment, and drains via the serialized owner alarm. Event capability is absent while inactive. OuraVault.eventsBridge intentionally defaults to null: no configuration toggle alone can start network delivery.

Remaining code/runtime blocker before deployment or activation: supply and verify the production safeFetch adapter with connection-time public-address validation and original-host TLS, plus isAuthorized adapter that rechecks the actual OAuth grant/client and current Oura connection (test implementations are synthetic). Do not replace these with unrestricted fetch or an always-true predicate. Cloudflare global_fetch_strictly_public documentation describes public routing but by itself does not prove the required DNS pinning/address checks. Full MCP 2 interoperability against the installed hosted client also remains unverified. No claim that events are live or production-ready.

Cloudflare aggregate OAuth key-count reads returned success:false; no counts or client connection could be established. No key values were read. No denied UI operation was retried. Production stays at c46626c5-b1ca-467c-a6a1-84ef19bc1162; no deployment, new credential, grant, provider subscription or health-data read in this turn.

## Latest status: 38 tests pass

Parent verified installed hosted LifeOS tools and a successful one-record daily sleep read on 2026-10-22. Conversational reads work; do not restart OAuth or troubleshoot installation.

Added event-authorization.mjs and tests: derive only a SHA-256 bearer fingerprint plus grant ID after provider authentication; retain no raw bearer; recheck token, grant, client existence, audience, read scope, expiry and current Oura connection. Adapter is pinned to workers-oauth-provider 1.2.1 KV layout and must be revalidated on dependency upgrades. KV eventual consistency means revocation observation inherits the provider storage delay. 38 tests now pass.

Concrete remaining transport limitation: Cloudflare node:https wraps fetch, does not expose sockets, and does not support servername. It cannot be assumed to implement Node's validated-IP lookup/TLS-host pinning pattern. Source: https://developers.cloudflare.com/workers/runtime-apis/nodejs/https/ . Do not silently use unrestricted fetch or add a third-party relay. Exact callback URL and verified Cloudflare-native destination validation remain required before creating a production bridge instance.

Activation request remains pending, not ready for final approval: exact ChatGPT callback must be identified; ingress verification secret and owner binding, 36 create/update/delete subscriptions across the 12 listed categories, finite overall activation period and any renewal must be approved. Outbound subscriptions cap lifetime at the shorter of 24 hours, current one-hour MCP token lifetime, and overall activation deadline; refresh requires authenticated client. No proactive health-alert task is implied. No live configuration/deployment changed.
