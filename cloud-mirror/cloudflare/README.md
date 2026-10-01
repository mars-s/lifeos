# Cloudflare read-only mirror handoff

User selected Workers + D1 on September 30, 2026, superseding Railway. Exact source directory:
`/Users/avi/Documents/Codex/2026-09-30/task-3/lifeos-cloud-cache-prototype/cloudflare`.
Original LifeOS and existing private Site remain unchanged. No Railway resource was created or deleted, and subscription cancellation is the user's action.

Current status: **read-only gateway deployed and 59 supported records synced on October 1**; [activation evidence](ACTIVATION.md) supersedes the empty-cache checkpoint. Wrangler 4.144.0 is installed locally. The user completed normal OAuth, confirmed Workers Free, and ran secure credential setup. One Worker, one D1 database and the five-minute helper exist; real task writes and dot OAuth MCP remain disabled/unconnected. Native credentials stay in the vault/runtime and managed CLI flow; no anonymous preview account is used.

Read-only dot MCP/OAuth is now staged and tested; [the connection handoff](DOT_CONNECTION.md) names the remaining GitHub OAuth app, KV browser permission and dot grant. No additional auth resource was provisioned, no app secret was entered by the agent, and the deployed main is unchanged.

Ready implementation:

- A small Worker, D1 binding, existing compatible mirror schema, fixed owner/adapter binding, and separate upload/read roles. Public `/health` contains no task information. All cloud data requires authentication. Caller-supplied Sites identity headers are ignored. Hashes, not credential values, belong in Worker secret bindings.
- Only `POST /api/sync/begin`, `page`, `commit` and authenticated `GET /state?cursor=...`. No real task writes, proposal/review endpoint, command execution or static-token MCP. Machine/read keys do not represent human identity and cannot approve/reject.
- Last confirmed snapshot, field revisions, absent/unknown/unsupported distinctions, unknown field preservation, public-list coverage guards, atomic tombstones, pending-overlay and immutable audit compatibility. Tombstones mean absence from a complete supported inventory, not deletion of a Things task.
- Transactional bulk SQL preserves sequence guards across isolates. A 500-record commit used 8 D1 queries in the counted integration test. It does not rely on global request queues or a single isolate. Unchanged field rows avoid redundant updates. Each invocation stays under 50 query operations at this tested size.
- Commit payload budget is 1 MiB; request budget 256 KiB. Larger data is rejected without truncating or changing confirmed state. Two most recent committed transport snapshots remain for retry; older transport payloads are discarded. Confirmed fields, tombstones, operation journal and audit remain. Old retired snapshot replays are rejected; the Mac helper retains its currently pending upload until confirmation.
- The lightweight helper now supports `backend: "cloudflare"` with a single previously provisioned sync credential from native Keychain or a scoped 1Password secret reference. It rejects write-enabled configuration and sends no Sites dispatcher token. Existing five-minute schedule, wake guards, backoff, journal, redirect refusal and deadlines are reused. The user installed it after secure setup; its next automatic run was independently verified.

Verification observed:

- Worker: 8 focused integration cases / 9 TAP tests pass on current local workerd + real D1, including 205 records, cursor paging, disk restart, unauthorized and forged identity calls, dedupe, stale replay, incomplete scans, retention, atomic rollback, concurrent sequence guards and pending journal continuity.
- `npm run typecheck` passes. `wrangler deploy --dry-run` passes: 28.38 KiB source / 7.81 KiB gzip.
- Companion Python tests: 66 pass. Things JXA fixture reader: 6 pass. Existing Site D1 fixtures: 27 cases / 29 TAP tests pass; its typecheck passes. Automated tests do not read or mutate real Things.
- Synthetic 59-record, 22-field, 143,496-byte local CPU proxy: median 1.764 ms, p95 3.433 ms for authentication hashing, canonical hashing, parsing and serialization. This measures Node on the Mac, **not deployed Worker CPU, network latency or D1 execution**. Production Free-tier 10 ms CPU compatibility remains a measurement gate after sign-in/deployment. Do not promise it solely from this benchmark.

Next supported sequence for the agent:

1. **Completed:** normal browser OAuth, user-confirmed Workers Free, exact account and existing-resource checks. Native grant includes required `workers_scripts:write`; no unrelated product permissions. Never ask for the account token in chat.
2. **Completed:** one D1 database, schema migrations, fixed nonsecret owner/adapter binding, types, dry-run, deploy and live health/access-denial checks. No Paid upgrade, R2, KV, Durable Objects, home-lab dependency or external Railway agent.
3. **Completed by user:** native 1Password credential generation/storage/configuration. Worker receives only independent role hashes; helper receives only the sync reference. No agent copied or inspected key values.
4. **Completed:** read-only helper installation, full supported inventory upload/field comparison, pagination/dedupe, and the next automatic background run. All actual task writes remain disabled.
5. Dot MCP integration is staged as a separate scoped OAuth2.1 connection using the supported Cloudflare provider and official MCP SDK. The app registration, KV browser permission, secure secret entry and dot grant remain pending. It is not provided by a public URL or Mac upload credential. Until verified, say cloud read cache is available to its authenticated reader only; do not claim live dot access.

Free-tier assessment: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) list 100,000 requests/day, 10 ms CPU/request, 128 MB memory. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) list 500 MB/database on Free, 5 GB total, 50 queries/Worker invocation and seven-day Time Travel. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) includes 5M reads/day and 100k writes/day; exhausted Free quotas reject requests until reset, with no automatic Paid upgrade here. Five-minute sync is 288 awake passes/day; actual row metrics and CPU must be verified after deployment, including indexes and other account usage. This is a current Free-plan fit assessment, not permanent hosting or an SLA guarantee.

Backup guidance: D1 Time Travel is short recovery, not a three-month backup. Use supported D1 export for periodic owner-private off-platform backups; protect task contents and test a restore to a separate database. Do not copy a live SQLite file or export private data into chat. Backups/retention must be checked before travel. The Mac journal stays durable locally for reconnect; the cloud cache cannot independently refresh while the Mac sleeps or is offline.

Local checks from this directory: `npm test`, `npm run typecheck`, `node benchmark.mjs`, `npm run dry-run` (Wrangler logs/metrics may be redirected/disabled for workspace sandbox restrictions). No `.dev.vars` production secrets are needed for synthetic tests.
