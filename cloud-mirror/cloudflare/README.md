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

## Offline Things operations (payload version 4, `things_ops_v1`)

Added October 31, 2026 (Worker side only). The Mac side is not implemented yet; this section is the contract it must follow. Nothing here was run against real Things.

### Gating old Macs

- A Mac that implements this section sends `X-LifeOS-Things-Ops: 1` on every `/api/native/*` request, alongside the existing `X-LifeOS-Protocol: 3`.
- `GET /api/native/pending` without that header never returns a version 4 operation. With it, the response also carries `things_ops_version: 1`.
- `POST /api/native/claim` without that header returns 409 for a version 4 operation, so an older build cannot claim one even by ID.
- Version 4 operations still produce ordinary `operation` feed events (`command_changed`), which only prompt a `pending` read. Mapping events use the new feed kind `temp_id`. Older Macs store unknown kinds as projections and ignore them.
- Existing ops (`title`, `status`, `in_trash_list`, versions 1 to 3) are unchanged.

### Payload

```json
{"version":4,"protocol":"things_ops_v1","op":"update","kind":"todo","target":"<Things ID or tmp-...>",
 "fields":{"title":"...","notes":"...","when":"today","deadline":null,"tags":["Errand"],"checklist":[{"title":"...","completed":false}]},
 "container":{"type":"project","id":"..."},"status":"completed","temp_id":"tmp-...",
 "base":{"<mirror field>":{"state":"value","value":"..."}},"base_revisions":{"<mirror field>":3},
 "conflict_policy":"smart_merge_v1","intent_kind":"explicit_set","depends_on":["<create operation id>"],"refs":["tmp-..."],"verify":["deadline","notes","tags","title","when"]}
```

Only the keys an op uses are present. Payloads are immutable. `verify` lists exactly the keys the receipt must read back.

| op | kinds | carries | base (mirror fields) | verify keys |
|---|---|---|---|---|
| `create` | todo, project | `temp_id`, `fields` (title required), optional `container` | none | every supplied field, plus `container` if given |
| `update` | todo, project | `fields` (at least one) | title, notes, activation_date (for `when`), deadline, tags, checklist | the supplied fields |
| `move` | todo, project | `container` | todo: area_id, project_id, heading_id; project: area_id | `container` |
| `set_status` | todo, project | `status`: open, completed or canceled | status | `status` |
| `trash` | todo | | in_trash_list | `in_trash_list` |
| `restore` | todo | | in_trash_list | `in_trash_list` |

Values: `when` is `today`, `evening`, `anytime`, `someday` or `YYYY-MM-DD`. `deadline` is `YYYY-MM-DD` or `null` (clear). `tags` is a set of up to 20 tag names (no commas) that replaces the item's tags; Things creates unknown tag names. `checklist` (to-dos only) replaces all items. Containers: to-dos take `{"type":"inbox"}`, `{"type":"area","id"}`, `{"type":"project","id"}` or `{"type":"heading","project","title"}`; projects take `{"type":"area","id"}` or `{"type":"none"}`. `inbox` means the Things Inbox list (no area or project). The Mac must not create a missing heading; it reports `container_unavailable`.

Enqueue rules enforced by the Worker:

- For a confirmed target, `base_revisions` must name exactly the dependent mirror fields present on the item, each at its current confirmed revision. A stale revision rejects the request under every policy (version 4 keeps no historical bases). Temporary targets take no `base_revisions` and have an empty `base`.
- Checklist edits on existing to-dos are rejected until the Mac reports `checklist` as a value. New to-dos may carry a checklist.
- No edit (other than `restore`) is accepted while the target is in Trash or has Trash in flight. `restore` needs the target in Trash. Projects cannot be trashed or restored here.
- `intent_kind` is always `explicit_set`; derived patches are not offered for version 4.
- A batch holds 1 to 25 operations, each with its own `operation_id`. It is validated as a whole and committed in one D1 transaction; any invalid operation rejects the whole batch with `Operation N: <reason>`. Same `operation_id` with the same request returns the existing operation; with a different request it is refused.

### Temporary IDs and dependencies

- `create` registers its `temp_id` (pattern `tmp-[A-Za-z0-9_-]{1,64}`) in `native_temp_ids`. A temp id belongs to one create, ever.
- Any later op may use the temp id as `target` or as a container `id`/`project`, in the same batch (after the create) or a later one. The Worker records the create's `operation_id` in `depends_on` and the temp id in `refs`.
- `pending` and `claim` hold an op until every `depends_on` create is `applied` or `satisfied` with a real ID. Each version 4 op in `pending`, `claim` and `operation` responses carries `resolved_refs: {"tmp-...": "<real id>"}`. The Mac substitutes those IDs when executing; it must not expect the payload to change.
- If a create finishes as skipped, failed or uncertain, its dependants (recursively) become `skipped` with reason `dependency_unresolved`, and new references to that temp id are rejected.

### Mac execution (to implement in run 2)

1. Read `pending` with the header; execute queued version 4 ops in the order returned, after claiming each (`{id, claim}`), as today. Skip any whose `resolved_refs` contains a null.
2. Read before write. Compare each `base` field with the current Things value. `things_wins`: if any differs, skip with `things_changed`. `cloud_wins` and `smart_merge_v1`: apply anyway; smart receipts classify each verify key.
3. Apply through fixed bundled automation only (no cloud-supplied script). Expected, unverified mapping: title/notes/deadline/tag names/status through AppleScript properties; `when` through the `schedule` command or Today/Someday list moves; containers through `move` and the area/project properties; Trash through `delete`; restore by moving the to-do out of the Trash list; checklist and heading placement through the Things URL scheme (needs the owner's auth token for updates).
4. Persist the created Things ID in the local journal before acknowledging, so a retried create is never repeated. An interrupted create with no recorded ID must be acknowledged `uncertain` with `interrupted_write`.
5. Read back and acknowledge.

Receipt (`POST /api/native/ack`):

```json
{"id":"...","claim":"...","result":{"state":"applied","created_id":"<real Things ID, create only>"},
 "applied_after_sequence":12,
 "observed_before":{"title":{"state":"value","value":"..."}},
 "verified_after":{"title":{"state":"value","value":"..."},"deadline":{"state":"absent"},"checklist":{"state":"unsupported"}},
 "merge_decision":{"algorithm":"things_fields_v1","fields":{"title":"cloud_only"}}}
```

- `applied_after_sequence` is required on every version 4 receipt (the journal sequence when the write began).
- `result.state`: applied, satisfied, skipped, failed or uncertain. `reason` is one of things_changed, target_unavailable, automation_denied, verification_failed, interrupted_write, interrupted_delete, newer_cloud_edit, container_unavailable, unsupported_by_things, dependency_unresolved.
- `created_id` is required exactly when a create is applied or satisfied. It must be a real ID (not `tmp-`) that no other temp id already maps to.
- Applied or satisfied receipts need `verified_after` with exactly the `verify` keys, each equal to the desired value: `deadline: null` reads back as `{"state":"absent"}`; tags compare as a case-insensitive set; `container` reads back as the container with resolved real IDs; `in_trash_list` is true for trash and false for restore. Only `checklist`, `when: evening` and heading containers may read back as `{"state":"unsupported"}`; they are recorded as `unverified_fields`.
- `observed_before` cells may name base or verify keys. `merge_decision` is required for applied or satisfied smart receipts, must classify every verify key (`cloud_only`, `same_value`, `cloud_fallback`, `created`, `unavailable`, `interrupted`), and is refused under other policies.
- Receipts are immutable; an identical retry returns the stored result.
- No `receipt_confirmation` is returned for version 4. Do not put version 4 IDs in `receipt_confirmations`; the upload would be rejected. A version 4 effect is confirmed by the first committed snapshot whose sequence is greater than `applied_after_sequence`. Until then `pending.overlaysNeedConfirmation` is true, so the Mac should upload after applying.

### Upload contract additions for the Mac

The current upload already carries notes, activation_date, deadline, tags (names), status (open, completed, canceled), area_id, project_id, in_trash_list, areas and tags. Still reported as unsupported, to add in run 2 where Things allows:

- `checklist`: `[{"title","completed"}]` per to-do (enables checklist edits on existing to-dos).
- `evening` (boolean) and `when` (`today`, `evening`, `anytime`, `someday` or a date) per to-do, so `when` can be compared directly.
- `heading_id` per to-do, plus heading items (`kind: "heading"`, fields `title`, `project_id`) with `heading` added to `manifest.scopes`. The Worker accepts the scope set with or without `heading`; the Mac's `LocalReplica` must accept the `heading` kind first.

### MCP tools

`queue_things_create`, `queue_things_update`, `queue_things_move`, `queue_things_status`, `queue_things_restore`, `queue_things_batch` (all ops including `trash`) and the read-only `read_things_operations` (state, receipt, `created_id`, `waiting_for`, `unverified_fields`). `queue_things_edit` and `queue_things_trash` are unchanged. `read_things_mirror` adds `catalog` (areas, projects, tags, headings, `field_support`), `temp_ids`, version 4 entries in `pending_overlay`, and pending creates on the first `effective` page under their temporary id.

### Known limitations

- Things automation cannot read checklists or headings, and has no put-back command for Trash. Restore is a move out of Trash; if Things refuses, the Mac reports `failed` with `unsupported_by_things`.
- Areas and headings are never created. Projects cannot be trashed through the queue.
- Operations queue while the Mac sleeps but only apply once a Mac with this support is awake. Until run 2 ships they stay queued.
