# LifeOS sync through durable invalidation and causal overlays

Read-only design, October 1, 2026. No repository or service changes were made.

## Recommendation

Keep D1, the OAuth Worker, `NativeQueue`, native Keychain credentials, and the Mac journal. Add an owner-scoped hibernating Durable Object for durable enqueue coordination and WebSocket invalidation. Give cloud operations priority over inventory. Replace repeated per-property Apple Events with two canonical bulk public-automation passes. Use FSEvents only to invalidate that public snapshot.

Do not rebuild all task state into a new authoritative database. A retained per-field desired overlay, with a causal retirement rule, supplies the required conflict behavior.

## What the code currently does

`Agent` in `mac-sync/Sources/LifeOSSync/main.swift` schedules a 60-second timer but skips ordinary cycles until five minutes after `lastSync`. `SyncEngine.cycle` uploads a complete inventory before claiming new operations. `PublicThings.inventory` runs classification before and after the reader. `things_read.js` reads individual properties and repeats its entire scan. Therefore WebSocket delivery alone cannot provide prompt application.

`native-queue.ts` uses stable IDs, D1 transactional guards, per-target claims, immutable receipts, and a 20-operation pending batch. `mcp-entry.ts` incorrectly uses that same execution batch as the effective overlay. Its applied receipts disappear from the overlay before a subsequent snapshot confirms them. Current scripts and tests explicitly make Things win same-field conflicts.

## Data and authority

Keep `mirror_items` as confirmed observations. Add native operation revision, `overlay_active`, and receipt fence columns in `0003_event_sync.sql`. Use the operation ordinal as the owner queue revision. The latest active operation for each target and field supplies desired value. Query overlays for the complete requested page, independently of the execution LIMIT 20 and recent-history LIMIT 100.

Accept explicit cloud edits against a valid observed target and supported field, even if their observed `base_revision` became stale through local sync. Retain the supplied base for audit. Do not allow missing, unknown, unsupported, or trashed targets to become accidental resurrection requests. Keep the three existing supported mutations.

The fixed writer accepts versioned `cloud_wins` payloads. It reads the current value, records any displaced local value, sets the requested field, and verifies that target. It preserves unrelated fields. Newer queued edits supersede older unclaimed edits. An executing edit finishes under its claim, then the latest queued edit runs.

A receipt adds `observed_before`, `verified_after`, and `applied_after_sequence`, captured from the durable journal before calling Things. Snapshots add `seen_cloud_revision`, captured before their scan. Retain applied and satisfied overlays until a snapshot has a greater sequence than the application fence, has seen that desired revision, and observes its desired value. Earlier persisted `pendingUpload` bytes remain immutable and cannot retire the overlay when retried after acknowledgement. Newer cloud intent always keeps its own overlay. Once this barrier clears, later ordinary local edits can become new confirmed revisions. This defines competing edits without permanently locking a field to its last cloud value.

Failed or uncertain intent remains visible as desired but blocked. Do not silently convert uncertainty into success. A restart may read the target and report satisfied if it already matches. Otherwise retain the existing no-blind-repeat rule and expose recovery. Immutable original receipts remain immutable.

## Durable delivery

All OAuth cloud enqueues call `OwnerSync.enqueue`; authentication remains in `mcp-entry.ts`. Native upgrades use `X-LifeOS-Agent-Key`, never a query credential. `worker.ts` validates the upgrade and forwards the configured owner only.

Before D1 enqueue, the object persists a stable request ID, content hash, request payload, and a recovery alarm in one storage transaction. D1 remains the operation authority. It atomically enqueues and supersedes as today. The object then records the resulting committed revision, broadcasts `{revision}`, and retires only the completed enqueue intent. Replays call the same idempotent D1 enqueue. A transport timeout is an unknown result, so the intent stays until readback or replay proves its outcome. Deterministic rejection can retire only after no ambiguous D1 request remains. This avoids introducing a second D1 notification outbox.

Keep the latest unacknowledged notification revision in object storage. A connected Mac acknowledges a revision only after it fetches and durably records the associated work. Delivery acknowledgement is not an application receipt. Retry outstanding delivery with one-shot alarms. After bounded failed attempts, close the unhealthy socket; keep the revision for the next handshake. When disconnected and D1 enqueue is settled, stop alarms entirely. Explicitly rearm failed enqueue recovery beyond Cloudflare's finite automatic retries.

On connect, register the socket first, send the current revision, then reconcile queue and sequence once. The native engine buffers higher revisions during work and drains all 20-operation pages. Persist the fetched watermark. Duplicate hints are harmless. Wake, resume, network restoration, manual sync, and reconnect request reconciliation. Cancel reconnect while the network is unavailable. A sparse protocol ping may detect a half-open socket; it is connection maintenance, never an idle `/pending` poll. Measure its power cost before choosing an interval.

## Native event loop and reader

One scheduler owns all automation. It retains `cloudDirty` and `localDirty` flags while busy, rather than dropping events under the current `busy` guard. Drain recovered receipts and cloud operations first. Target verification precedes any full inventory. Then flush the immutable pending snapshot and take one coalesced new inventory when local dirtiness requires it. A failure schedules one journal-backed retry with jitter, not a repeating sync timer.

A new bulk AppleScript resource collects properties by public collection. Cover top-level collections, all required built-in lists, project children, area children, tags, and parent relationships. Convert dates, enums, missing values, references, and unsupported fields into the existing cell format. Reconcile duplicate IDs and kinds. Read two complete canonical passes and compare. Preserve the existing v2 coverage gate until parity proves a replacement. The 0.443-second probe proves enumeration opportunity, not finished-reader speed.

`ThingsChangeWatcher.swift` watches the configured active data directory and its parent for replacement. File and WAL events mark local dirtiness without reading database contents. Debounce around 500 ms, keep events that arrive during scans, persist the FSEvents cursor, and rescan on dropped events or root replacement. Hash canonical content without timestamps to suppress self-write loops and unchanged uploads. Refresh at startup, wake, timezone changes, and local midnight for calendar-derived lists. Permission denial or unknown layout produces a visible degraded state and manual sync. FSEvents is an unsupported integration with Things storage layout, so local near-instant detection needs a real-device gate.

## Three implementation owners

| Owner | Exclusive files | Contract |
| --- | --- | --- |
| Cloud | `native-queue.ts`, new `owner-sync.ts`, `worker.ts`, `mcp-entry.ts`, `wrangler.jsonc`, `0003_event_sync.sql`, `native-test.mjs` | Versioned revisions, fences, complete overlay query, enqueue journal, upgrade authentication |
| Native | `SyncCore.swift`, `main.swift`, `Runtime.swift`, new `ThingsChangeWatcher.swift`, SyncCore tests | One scheduler, durable flags and watermark, causal receipt and snapshot fields, reconnect and recovery |
| Automation | New bulk script and converter, `native-write.js`, `build-app.sh`, reader and writer tests | Existing canonical inventory schema and fixed versioned write payloads |

Freeze JSON contracts before parallel implementation. The native owner integrates the automation reader through `PublicThings`. Owners do not edit each other's files.

## Verification and rollout

Test D1 commit followed by object crash, response loss, duplicate ID with changed content, late D1 completion, reconnect between registration and fetch, notification loss, multiple queued batches, and hibernation. Test applied overlay followed by stale snapshot, newer intent during execution, same-field local conflict, unrelated local edit, uncertain recovery, and Trash disappearance.

Prove bulk parity on titles, notes, dates, statuses, classification, nesting, tags, list order, completed items, and Trash. Inject mid-scan changes, unknown properties, duplicate IDs, omitted lists, and budget overflow. Extend `native-write.test.mjs`, `things_reader.test.mjs`, `native-test.mjs`, and `SyncCoreTests`. Measure awake cloud-edit-to-verified-Things latency, local-edit-to-cloud latency, idle CPU, wakeups, and zero idle HTTP queue reads separately.

Deploy additive cloud support first. Pause and drain old executing operations before changing their policy. Existing immutable payloads keep their old interpretation. Install native v2, verify journal migration and wake/offline behavior, then activate cloud-wins and remove timers. Require v2 for newly issued cloud-wins operations. Preserve D1 and journal backups. Developer ID signing is not established; rebuilding with ad-hoc or changing identity may re-trigger macOS permissions. Verify the installed signing and approved Keychain/automation path after replacement.

## Sources and tradeoffs

| Method | Decision |
| --- | --- |
| Hibernating WebSocket | Selected. Cloudflare retains connections without duration charges while hibernating. Persist state because constructors rerun. [Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| SSE | Rejected. One-way delivery adds HTTP acknowledgement machinery and lacks the selected hibernation mechanism. |
| APNs | Deferred. Adds provisioning and another server credential. Apple's background strategies let the OS schedule delivery and impose rate limits, so they do not promise immediate application. [Apple background strategies](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app) |
| Public Things change feed | Unavailable in documented integrations. Automation remains local. [Things integrations](https://culturedcode.com/things/support/articles/2967034/) |
| FSEvents | Selected with explicit unsupported-layout risk. Dropped events require rescanning. [Apple FSEvents](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/UsingtheFSEventsFramework/UsingtheFSEventsFramework.html) |
| DO alarms | Outstanding-work recovery only. Automatic retries are finite. [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/) |
