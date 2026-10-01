# LifeOS sync with durable desired fields

Use the existing D1 queue, OAuth app, Worker, and native menu bar agent. Add a hibernating owner Durable Object for outbound WebSocket notifications. Make cloud desired fields persistent. Accelerate public automation before claiming instantaneous sync.

## What the current code actually does

`mac-sync/Sources/LifeOSSync/main.swift` installs a 60-second timer and normally runs inventories every five minutes. `SyncCore.swift` fetches pending, uploads a complete inventory, fetches pending again, applies operations, uploads again, and fetches pending again. Cloud writes therefore wait behind expensive inventory work.

`PublicThings.inventory()` wraps two JXA scans with two classification scripts. `things_read.js` reads properties per object and checks identical scans. The 18.7-second measurement and 0.443-second bulk probe identify an opportunity, not finished-reader performance.

`native-queue.ts` preserves IDs, claims, and final receipts. It rejects stale enqueue bases and skips competing local field changes. Both decisions enforce Things priority. `mcp-entry.ts` builds effective fields from `pending()`, limited to 20 operations, and removes their overlay on acknowledgement before the next inventory arrives. These behaviors must change with the conflict policy.

## Data contract and authority

Keep `mirror_items` as confirmed public observations. Add `native_desired_fields(owner,target,field,revision,operation_id,value,verification)` only for the existing title, completion, and recoverable Trash overrides, plus `native_sync_meta(owner,cloud_revision)`. This table is a temporary cloud override fence, not a new task store. Accept requests with existing validation and stable IDs. In one D1 batch, enqueue the immutable operation, supersede older unclaimed same-field requests, increment the owner revision, and replace that field's desired value. Preserve optimistic revision checks between cloud writers. A local snapshot arriving between a cloud read and enqueue must not turn a valid explicit cloud edit into a Things-priority skip. Separate cloud edit revision from observed Things revision in the API.

`effective` overlays every desired row for the returned targets, independent of the execution batch limit. Receipts update verification, never erase desired state. Uncertain or unavailable results remain visible and do not claim success. Keep the displaced observed local value in an audit record.

Snapshots carry `basis_cloud_revision`, captured before reading. A snapshot with basis below a field's desired revision cannot replace that field's effective value, even after its operation is applied. Retire its fence only in the transaction accepting a snapshot with sufficient basis, matching desired value, and an applied or satisfied receipt. Existing monotonic snapshot sequences prevent older retries from overwriting that confirmation. Subsequent uncontested local edits use the ordinary confirmed snapshot path. If a new cloud edit races that upload, its higher revision wins. Preserve unsupported, absent, and unknown field states. No new write fields or task creation API are introduced.

## Durable notification, without idle polling

Expose authenticated `/api/native/events` using `URLSessionWebSocketTask`. Reuse `X-LifeOS-Agent-Key`; reject Origin, redirects, and mismatched owner. The Worker validates current credentials before forwarding. The owner DO uses `acceptWebSocket`, serialized socket attachments, and bounded messages containing only `{revision}`. Credential revocation closes active sockets through the same coordinator.

Route both MCP enqueue handlers through the coordinator. Before calling D1, persist the validated enqueue intent and arm a recovery alarm in DO storage. D1 commits operation, desired fields, owner revision, and a notification outbox row atomically. Operation ID and request hash make replay safe. If a coordinator dies during the D1 request, recovery checks or replays that exact ID until its outcome is known. It must not delete the intent merely because an early lookup found nothing. Broadcast committed revisions, then retire the intent only after durable delivery state exists.

Track the connected agent's acknowledged revision. Outstanding notifications schedule retries; acknowledgement means the agent durably saved work, not that Things applied it. On a disconnected socket, stop delivery alarms and retain the D1 outbox for reconnect catch-up. No cron, idle pending calls, or infinite offline notification retries. Establish the socket first, then read the owner revision and pending queue. Messages racing catch-up only increase the local target revision. Agent and server connection liveness may require low-frequency transport ping traffic; measure that separately from application polling. Do not promise zero network packets.

## Native scheduling and recovery

Replace `cycle()` with one serialized scheduler owning automation and the journal. Inputs are cloud invalidation, local dirty event, startup, wake, network restoration, manual sync, and one-shot retry. While busy, record flags and the largest revision instead of dropping events. Persist cloud work before acknowledging notification. Drain all pending pages in ordinal order, retaining single-target claims. Fetch operations before inventory, apply supported setters, verify their target fields, and then coalesce a full observation upload. Never run automation writes concurrently with inventory.

For new cloud-priority operations, remove the old base-value skip in `native-write.js`; read the displaced value, set the field, then verify. For a crashed `writing` intent, inspect the target first. If it equals desired, acknowledge satisfied. Otherwise repeat only the approved idempotent setter under the retained claim. Missing targets remain unavailable. Old Things-priority intents retain their existing uncertain recovery semantics. A newer cloud title queued during an older execution applies afterward; do not steal the existing claim.

Retry the exact durable `pendingUpload` sequence first, with its captured basis, before making a new upload. Hash canonical semantic content before allocating a new sequence. Exclude `observed_at` from that hash. Persist hash only after confirmed upload. Maintain local dirty state until upload succeeds. Backoff timers exist only while work or connection recovery exists.

## Local detection and bulk automation

Use narrowly scoped FSEvents on the active Things storage directory as an invalidation hint. Read no private database content. Debounce 0.5 seconds and schedule one additional pass for changes during reading. Handle dropped events, root replacement, wake, Things launch, day boundary, timezone change, and denied access. Validate the real path and permission on this Mac before enabling the watcher. Filesystem events do not prove a semantic task change, so compare canonical hashes. If detection stops working, show degraded local detection and retain manual sync; never silently restore cloud polling.

Build `mac-sync/Resources/things-inventory.applescript` from the probe. Retrieve properties in collection batches for all top-level groups, built-in lists, project children, and area children. Resolve public object references to IDs through cached collections, preserving kind, tags, civil dates, timestamps, memberships, and ordering. Emit the existing v2 manifest after two matching complete canonical passes. Keep targeted reference calls only where batching cannot express the field. Do not weaken coverage guards or convert missing data to empty strings. Bundle through `build-app.sh`; leave the legacy reader available only for parity tests and rollback.

## Three implementation owners

1. Cloud owner: `cloudflare/native-queue.ts`, new `native-events.ts`, `worker.ts`, `mcp-entry.ts`, `wrangler.jsonc`, schema migration, `native-test.mjs`, new notifier tests. Own desired fields, revision, outbox, authorization text, and overlay paging. Publish request/response fixtures first.
2. Engine owner: `Sources/SyncCore/SyncCore.swift`, `Sources/LifeOSSync/Runtime.swift`, `Resources/native-write.js`, `Tests/SyncCoreTests`, `Tests/native-write.test.mjs`. Own journal migration, scheduler, transport, recovery, and cloud-priority setters. Consume the fixtures without editing cloud files.
3. Reader and events owner: new inventory resource, new `ThingsEventSource.swift`, `main.swift`, `build-app.sh`, reader parity tests. Own bulk conversion, watcher, lifecycle inputs, and timer removal. Consume the engine's `signal(reason)` interface. Integration owner resolves protocol changes; workers do not independently edit shared files.

## Acceptance and rollout

Prove complete reader parity across open, completed, canceled, Trash, project, area, nested tags, Unicode, absent dates, and edits during scan. Measure finished two-pass inventory, cloud-to-notification, cloud-to-verified-Things, and local-edit-to-cloud separately. Record median and p95, CPU, idle wakeups, automation launches, and HTTP requests. Target awake cloud application below two seconds and local reconciliation below two seconds for the current fixture, subject to actual public automation latency.

Inject crashes before/after coordinator intent, D1 commit, broadcast, notification acknowledgement, Things write, receipt, and snapshot. Test duplicate messages, dropped messages, 45 queued edits, concurrent title changes, old snapshots after successful receipts, sleep/offline edits, wake catch-up, revoked credentials, watcher replacement, and denied automation. A 30-minute healthy idle test must produce no pending or snapshot requests and no automation scans.

Deploy additive schema and notifier first. Keep existing policy payloads immutable. Advertise native protocol v2 and gate new cloud-priority queue acceptance on a compatible installed agent. Freeze enqueue during native cutover, settle or audit legacy claims, and migrate journal defaults without losing uploads. The old writer accepts only `things_wins`. Verify the installed signing requirement before replacing it. The parent audit found Apple Development but no Developer ID; an existing ad hoc app may need renewed Keychain or Automation trust. Test continuity locally. Change OAuth descriptions and tests that currently promise Things priority. Disable timers only after notifier recovery and local detection pass. Rollback pauses writes and preserves journals, desired state, and outbox; an old agent must never execute v2 operations.
