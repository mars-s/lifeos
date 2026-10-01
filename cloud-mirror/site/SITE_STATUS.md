# Private synthetic Site · September 30, 2026

Source: `/Users/avi/Documents/Codex/2026-09-30/task-3/lifeos-cloud-cache-prototype/site`.
Companion to the unchanged original LifeOS at `/Users/avi/Documents/ChatGPT/lifeos`.

Site ID: `appgprj_6abce385ab0c8191b67a1d0808522bac`.
Registration is complete, and Sites reports the current account as owner with owner-only access policy. Final metadata check reports `latest_version_number: 0` and `current_live_url: null`. **There is no live deployment URL to hand off.** Reuse this Site ID when recovering; do not register a second Site.

## Completed implementation

- Cloudflare-compatible Sites starter with logical D1 binding `DB`, five owner-scoped tables, generated initial migration, immutable operation content, terminal receipts, and append-only before/after audit triggers.
- Dot review surface using shadcn primitives: explicit synthetic labels, confirmed snapshot, sync age, offline status, immutable title proposals, exact revision approval/rejection, pending overlay, simulated reconnect and simulated same-field iPhone conflict.
- API requires trusted Sites authenticated user ID and email headers. All storage queries are scoped to that identity. Identity-less service requests cannot seed, read, propose, or approve. Cross-origin mutations are denied. There is no command execution endpoint.
- Read-only `/mcp` synthetic cache tool; no human approval tool or connected live plugin.
- Two sample tasks only. No ThingsCloud credentials, direct Things database access, Google Calendar integration, or live Mac adapter.

## Observed verification

`node --test tests/runtime.test.mjs`: 12 focused subtests passed (13 TAP tests including the enclosing test), using real local Miniflare D1 with temporary synthetic storage. Cases cover no-identity denial, idempotent seeding, draft nonexecution, exact approval, pending/applied separation, duplicate retries, changed-payload rejection, same-field conflict, preservation of unrelated fields, terminal rejection, owner isolation, cross-origin denial, absent command endpoint, immutable audit/content, atomic rollback, and persistence across complete local runtime restart.

`node node_modules/typescript/bin/tsc --noEmit`: passed.
`npm run build`: passed; Worker output includes `/`, `/api/demo/:action`, and `/mcp`.
Impeccable mechanical detector on review UI and CSS: no findings.

No rendered browser QA, hosted end-to-end verification, production D1 migration, or deployed authentication check has occurred. Local tests inject synthetic identity headers; only the private Sites dispatcher may supply trusted identity in production.

## Publishing recovery history

The installed Sites plugin at `/Users/avi/.codex/plugins/cache/openai-curated-remote/sites/0.1.75` disappeared during initial work. A bounded scan found no publishing scripts then. Following the user's requested retry, the same package and all required workflow scripts became available again. No substitute workflow or archive was invented. The expired registration source-push credential was renewed through the native Sites tool after explicit clarification that standard short-lived publishing credentials are allowed; no Mac access token was created. Publishing is continuing through the restored workflow. The version and URL above record the last pre-publication metadata check, not a claim about the later deployment result.

Restore availability of the installed Sites publishing package through its supported environment setup. Then read its current hosting skill, reuse the Site ID and local source, and run its bundled workflow. Retrieve a fresh source-repository write credential only if the registration credential has expired; keep it in memory/stdin. Source-repository credentials needed for approved publishing are distinct from a Mac service credential. Use native private save/deploy and wait for terminal `succeeded` with a literal URL before claiming the Site is live. Keep access owner-private. Deployment approval was already given; no further conversational deployment confirmation is needed for this sample-only Site.

## Separate next approval

After private deployment succeeds, ask explicitly before generating a Sites Mac service-access token or configuring persistent Mac access. The documented `OAI-Sites-Authorization` bypass token supplies no user identity. A future adapter must therefore use a separate narrow authenticated service route bound server-side to the single owner, with permissions only to upload snapshots, fetch approved operations and report receipts. Human approval/rejection must remain owner-authenticated and unavailable to that service route. The current demo deliberately rejects identity-less access and does not implement this future route.

Live Things reads or mutations and Calendar access require separate scope approval. Supported Things automation has no atomic cloud compare-and-swap with iPhone changes. Mock D1 atomicity does not establish safe concurrent Things writes; real mutations remain disabled until the reviewed adapter policy handles that limitation.
