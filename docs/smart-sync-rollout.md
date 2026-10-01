# Smart sync rollout

October 2, 2026. Smart sync is deployed and enabled, and the compatible signed app is installed. Live disposable-task tests pass through the existing MCP connection. Instant local event detection still needs the owner's macOS app-data permission. Cloud execution and reconciliation continue while that permission is pending.

The change keeps the existing menu bar controls and supported write actions. Normal merging runs in the background. Cloudflare coordinates accepted commands, while Things remains an external application whose public automation does not provide atomic compare-and-set.

## Release order

1. Integrate the cloud, native and independent verification slices. Preserve immutable version 1 and 2 payloads and receipts.
2. Pass legacy and new protocol, merge, crash recovery and replica tests. Build with the existing stable Apple Development identity.
3. Apply additive D1 schema changes and deploy the new server with smart acceptance disabled. Existing clients keep their old behavior.
4. Preserve a local app and journal checkpoint, then install the signed compatible native app. Verify its bootstrap, separate feed cursor and quiet Keychain access.
5. Enable smart acceptance after the compatible native path is verified. Test only disposable Things records, including conflicting titles, independent fields, confirmation and reconnect catch-up.
6. Verify settled sync produces no queue, inventory or upload polling. Record the actual observation interval and any unverified device paths.

## Rollback boundaries

Disabling new smart acceptance does not reinterpret already accepted commands. Their frozen version 3 payloads need the compatible native executor. Keep additive tables and immutable receipts. Do not roll back the native binary while unresolved version 3 work exists.

The local checkpoint must exclude credentials. A successful schema migration is not a remote database backup. Do not report an export unless one actually completed with the available authorized credentials.

## Evidence

Three Sol medium workers covered cloud implementation, native implementation and independent verification. Parent integrated the changes on main and reran the suites: 36 existing cloud tests, 16 new real workerd/D1/DO tests, 40 Swift tests and 12 JavaScript writer cases pass. Synthetic bulk reader checks pass. A Unicode command regression returns complete operations within the native response budget, and oversized bases reject before acceptance. The release app builds with the existing Apple Development identity, team BFKXU8H6X5, and passes strict signature verification. Keychain API deprecation warnings remain, with the existing quiet access policy preserved.

The replica contains confirmed inventory and projections received after its frozen bootstrap. The authoritative cloud pending queue supplies runnable commands. It does not claim to hydrate a complete offline pending-overlay database at bootstrap.

The earlier Cloudflare authorization failure was resolved before this rollout. Migration 0004_smart_sync.sql applied remotely, then server version 761008ca-1b1d-43a2-9c4f-1627890b7477 deployed with smart acceptance disabled. After compatible native bootstrap succeeded, version 15e573bd-05c8-423a-8261-e962e6ff30b2 enabled LIFEOS_SMART_SYNC_ENABLED. No alternate credential or new OAuth app was created. Existing things:read and things:write consent remained in use.

A credential-free local journal and old app checkpoint exists under ~/Library/Application Support/LifeOS/NativeSync/checkpoints/smart-sync-2026-10-02. There is no claimed remote database export. The installed /Applications/LifeOS Sync.app retains the existing signing identity and passed strict verification after the live Trash write.

Live checks used one disposable task, with the sync app stopped between changes to simulate an offline agent. A queued title met a competing local title: cloud_fallback applied, retained the local alternative, preserved an unrelated local note and received fresh-snapshot confirmation at sequence 79. A subsequent local title was accepted at sequence 80, proving the completed old command did not lock the field. Completion preserved another independent local title. A stale exact-basis Trash command classified delete_edit_cloud_fallback and received confirmation at sequence 81. The final snapshot contained both the completed status and recoverable Trash membership, and zero pending overlays. The disposable task remains in Trash. Physical sleep and phone-origin commands were not tested.

Final audit review found that a subsequent Trash command could remove an applied completion's active desired head before snapshot reconciliation. Immutable receipts remained intact, but the completion's confirmation proof was consumed without a reconciliation row. The focused fix reconciles validated proofs against immutable operations instead of active desired heads, while overlay retirement still matches the exact operation and ordinal. The regression failed before the fix and passed afterward, including successor preservation and proof replay. Server version df2f2fa8-136f-47f1-af7c-ab36d2f2c1c3 deployed this fix without another migration.

A second disposable live task reproduced completion immediately followed by Trash before snapshot publication. Sequence 83 recorded both receipts: completion received post_write_review because the target was subsequently trashed, and Trash received confirmed. The actual task was completed and in recoverable Trash, with zero pending overlays, receipt proofs or native intents. The app's feed cursor and hint both reached 69. Both disposable tasks remain in Trash. These tests prove live queued edits and snapshot reconciliation, not only server health.

The public bulk inventory took 1,984 ms. The final cloud mirror has 75 records including retained records, which differs from the public inventory count. Settled status at 00:49:38 Melbourne remained unchanged through more than five minutes of observation before the final regression: feed cursor and hint 42, two inventory reads, four pending requests and one snapshot upload since that app launch. CPU sampled at 0.0%. Sparse WebSocket protocol keepalive is retained; no periodic HTTP queue or inventory polling was observed.

An actual macOS app-data gate initially blocked FSEventStream registration on the main actor. Registration now runs on an isolated utility queue, without directory enumeration or private database reads. Cloud sync, public Things automation and menu processing no longer wait for that registration. Status remains Local watcher pending permission or registration. The owner must approve the legitimate macOS request before instant local metadata invalidation can be verified. Until then, local edits are caught during startup, reconnect reconciliation, manual sync or cloud-triggered reconciliation. The app does not bypass the denial or substitute polling. No consent was clicked while the owner was asleep. The Mac was locked during the final UI inspection, so the permission UI itself could not be verified.
