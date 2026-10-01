# Queue-first native sync with durable cloud intent

The Mac receives cloud changes through one authenticated hibernating WebSocket. It applies queued title, completion, and recoverable Trash edits before reading the whole Things inventory. Local edits trigger a debounced public automation snapshot. D1, the existing OAuth app, native journal, and native Keychain remain in place.

## What the code actually does

`SyncEngine.cycle()` uploads inventory before fetching new operations, then uploads again after writes. `Agent` wakes every minute and normally scans after five minutes. `PublicThings.inventory()` brackets two JXA scans with per-record AppleScript classification. `things_read.js` fetches each field through Apple Events. The provided 18.7-second measurement fits that implementation. The 0.443-second bulk probe proves enumeration feasibility, not canonical field parity.

Two correctness changes matter as much as speed. `cycle()` drops triggers while `busy`. `NativeQueue.pending()` returns only twenty operations, so a notification must initiate a drain loop. Both `NativeQueue.enqueue()` and `native-write.js` currently enforce Things precedence. Merely changing the WebSocket cannot meet the requested conflict rule.

## Transport and durable publication

Add owner-scoped `OwnerSyncCoordinator` using SQLite-backed Durable Object storage and `acceptWebSocket()`. Keep the Mac connection outbound through `URLSessionWebSocketTask`. Authenticate upgrades with the existing agent header, reject browser Origin, forbid redirects, and never put credentials in URLs. Send `{version:1, revision:N}` invalidations only. Queue payloads still travel through authenticated native HTTP routes. Cloudflare supports connected clients during hibernation and handles protocol ping without waking the object. [WebSocket documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

Every OAuth enqueue routes through the coordinator. Before D1 mutation, persist the complete validated enqueue intent, stable operation ID, and recovery alarm in one DO storage transaction. The D1 batch inserts the operation, supersedes older unclaimed same-field operations, increments the owner revision, and writes an outbox row atomically. Retry by immutable request hash. On success broadcast the committed revision. A coordinator restart resolves the persisted intent through idempotent enqueue, including a D1 commit that completed after the old instance disappeared. Retire intent only after durable D1 outcome and publication bookkeeping. A pre-armed alarm without the stored request is insufficient.

Retain notification outbox revisions until the Mac acknowledges queue reconciliation. Delivery acknowledgement is separate from application receipts. While connected and awaiting acknowledgement, retry outstanding notification with bounded backoff. With no connected client, retain the high watermark and stop notification alarms once enqueue intents are resolved. Connection startup reads the durable high watermark and pending queue. This avoids endless server wakeups while the Mac is offline. Failed publication cannot strand a committed change forever.

Subscribe before catch-up. Buffer higher revisions during reconciliation. Persist the reconciled revision only after draining work and durable receipts. If paused, acknowledge receipt of a hint separately and retain the need to reconcile. Reconnect on wake, network restoration, receive failure, or ping timeout. Maintenance ping packets are allowed, idle HTTP queue polling is removed. Reset retry backoff only after a healthy connection. DO memory disappears during hibernation, so attachments hold connection identity and durable storage holds recovery state. Deployments can terminate connections. [Lifecycle documentation](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/).

## Cloud precedence without a general authority rewrite

Add a minimal `native_desired_fields` fence limited to the three supported fields. Each row holds owner, target, field, latest operation ID, desired value, cloud revision, and unresolved status. The queue remains the operation journal. This fence stops old local snapshots and terminal uncertain receipts from erasing accepted intent. It introduces no desired state for unsupported Things fields.

Accept a new cloud edit despite a newer local field value, after normal type, target, and permission checks. Keep `base_revision` as observed context, not a Things-wins rejection. Assign ordering at cloud acceptance. Latest accepted same-field cloud intent wins. Preserve unrelated local fields and record the displaced value in bounded audit metadata.

Include `cloud_revision_at_read` in each snapshot and persist it inside `pendingUpload`. A snapshot started before a field's newest cloud revision cannot retire that field's desired fence, even if its operation receipt arrived first. Confirmed remains observed Things state. Effective overlays all unresolved desired fields for the returned page, not the first twenty queue entries. A post-application snapshot with a current watermark and matching value retires the fence. A later genuine local edit becomes the new cloud observation once no cloud intent competes.

Keep immutable old receipts. On interrupted `writing`, read that target and compare with latest desired value. A match produces `satisfied`. A mismatch needs a new deterministic reconciliation operation for the same desired revision, subject to target validity. An existing immutable `uncertain` receipt never changes. Missing targets or denied automation remain visibly unresolved and do not fabricate successful application. No automatic permanent deletion is added.

## Native scheduler and fast reader

One scheduler owns journal mutation and automation serialization. Persist dirty flags and the highest requested cloud revision before launching work. A trigger while busy merges into retained work. After each awaited action, check cloud work before starting another inventory. Clear only the generation actually processed. Keep one one-shot retry for failed work.

First replay stored receipts and resolve durable `pendingUpload` using its exact bytes and sequence. Do not discard or regenerate that payload. Then fetch and drain pending operations in ordinal order, claim and persist each phase before writing, and verify its target. Fetch again until the queue has no actionable entries. An orphan executing claim must report blocked recovery without an infinite loop. Batch a full snapshot after writes and local dirtiness. A stalled inventory does not prevent future cloud target writes once its process timeout expires.

Replace classification plus per-record JXA reads with a compiled fixed AppleScript bulk reader. Read properties in batches for top-level groups, every public list, project children, and area children. Convert enum classes, civil dates, reference IDs, memberships, ordering, tags, and absent values into the current canonical cell schema. Cache reference conversion and fetch any missing related IDs in batches. Keep unsupported and unknown distinct. Use two canonical bulk passes initially and compare complete output, not only IDs. Keep the current coverage token only after proving equivalent coverage. No private database bytes are read.

Watch the active Things data directory with FSEvents, including sidecars and directory replacement. Use events only as dirty hints. Debounce about 500 ms and rerun once if events arrive during a scan. Persist the cursor after the associated public snapshot succeeds. Dropped-event flags require rescan. Startup, wake, Things relaunch, timezone change, and local midnight also invalidate. Do not suppress all events during own writes, because a user edit can occur then. Hash canonical content to suppress duplicate upload loops. [Apple FSEvents guidance](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html).

Directory access and layout need live verification. Things release notes document historical storage moves. Detect missing or denied watcher access visibly and offer manual Sync now. Do not promise an official change feed or secretly add polling. [Things release notes](https://culturedcode.com/things/support/articles/1100684/).

## Three-worker ownership

| Worker | Exclusive files and responsibility |
| --- | --- |
| Cloud | `cloud-mirror/cloudflare/{owner-sync.ts,native-queue.ts,worker.ts,mcp-entry.ts,wrangler.jsonc,worker-configuration.d.ts,native-test.mjs}`, new D1 migration, and `site/lib/mirror-store.ts`. Owns revision, intent/outbox recovery, desired fence, overlay, native routes, and consent text. |
| Native core | `mac-sync/Sources/SyncCore/SyncCore.swift`, core tests, `Sources/LifeOSSync/{main.swift,Runtime.swift}`, new scheduler and connection files. Owns durable dirty generations, journal schema migration, reconnect, queue drain, and transport adapters. |
| Automation | `cloud-mirror/lifeos_cache/things_bulk.applescript`, reader tests, `mac-sync/Resources/native-write.js`, native write tests, new `Sources/LifeOSSync/ThingsEvents.swift`, and `build-app.sh`. Owns canonical conversion, public target recovery, event watcher, resources, and signing verification. |

Freeze contracts first. Core exposes `requestSync(reason, revision)` and a watcher protocol. Automation adds `readTarget` and verified apply results through `ThingsAutomation`. Cloud supplies versioned reconcile response, watermark semantics, and idempotent receipts. Core alone edits `Runtime.swift`; automation provides adapter changes as a patch. The integration owner reviews all three before deployment.

## Proof and migration

Test crashes before intent persistence, during D1 commit, after commit before send, after send before acknowledgement, and after Things setter before journal receipt. Test lost snapshot responses, old persisted uploads, duplicates, same-field edits, unrelated-field preservation, twenty-five queued edits, stale executing claims, paused events, busy events, sleep, offline reconnect, and credential rejection. Compare old and bulk canonical inventories for nested projects, areas, Trash, Logbook, Unicode, dates, tags, ordering, and every cell state. Measure completed conversion and validation.

Keep existing legacy operations immutable with their original policy. Drain or explicitly reconcile them before enabling new cloud-wins operations. Deploy additive D1 and DO migrations and versioned routes first. Install the compatible signed native app next. Enable cloud-wins enqueue after its readiness check, then remove periodic scheduling. Preserve journal and pending upload. Mixed-version clients must reject unknown policy rather than apply incorrect semantics. Verify installed Keychain access and automation permissions after signing. Only Apple Development identity is currently reported available, so do not assume Developer ID signing or notarization.

Acceptance requires zero idle queue/snapshot HTTP requests, no recurring inventories while unchanged, measured native idle CPU and wakeups, and observed end-to-end title, completion, and Trash paths. Report notification, setter verification, and mirror confirmation latency separately. An asleep Mac applies changes only after waking.
