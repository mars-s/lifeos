# Smart sync rollout

October 2, 2026. Implementation and synthetic verification are complete. Production rollout is blocked by Cloudflare database authorization. This document is not a deployment success claim.

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

Three Sol medium workers covered cloud implementation, native implementation and independent verification. Parent integrated the changes on main and reran the suites: 36 existing cloud tests, 15 new real workerd/D1/DO tests, 40 Swift tests and 12 JavaScript writer cases pass. Synthetic bulk reader checks pass. A Unicode command regression returns complete operations within the native response budget, and oversized bases reject before acceptance. The release app builds with the existing Apple Development identity, team BFKXU8H6X5, and passes strict signature verification. Keychain API deprecation warnings remain, with the existing quiet access policy preserved.

The replica contains confirmed inventory and projections received after its frozen bootstrap. The authoritative cloud pending queue supplies runnable commands. It does not claim to hydrate a complete offline pending-overlay database at bootstrap.

The attempted additive migration was denied by Cloudflare with code 7403. Read-only Wrangler identity inspection confirms the expected account and an existing d1 write grant, but does not explain the service denial. No alternate credential was extracted and no denied database operation was retried. The scoped Wrangler consent flow was opened in Helium, but ended without completion. It needs to be reopened when the owner is ready to finish secure consent. Authorization URLs and credential values were suppressed from tool output and the temporary consent process did not retain debug logs.

Smart acceptance remains false. The new server has not been deployed and the new app has not replaced the installed app. Current cloud reads still report cloud_wins. Signed installation, live disposable merging, receipt confirmation, reconnect catch-up and the new implementation's idle interval remain unverified until authorized Cloudflare access is restored. The current installed app and deployed server remain running.
