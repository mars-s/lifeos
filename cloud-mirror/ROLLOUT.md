# Next approval bundle

No approval is pending inside this prototype. All implementation and verification so far are local and synthetic; no real Things/calendar tasks were changed and no cloud/credential resources were created.

**Recommended next request:** approve a bounded private Sites validation slice, including these specific actions:

- Create a new owner-private Site for this companion; port this tested state machine to Worker/D1 with append-only migrations and atomic batch/conditional claim operations, expose read/propose MCP tools through its managed private plugin.
- Confirm actual Sites cost/entitlement, quotas, backup/export path and retention before relying on it. If terms cannot be verified or are unsuitable, return a concrete Railway Hobby alternative for separate paid deployment approval.
- Explicitly authorize creation of the Site platform service credential and a narrow adapter credential as needed, provision them only through approved secret storage. The Site platform token itself may be broad; app route checks must constrain it to sync/pending/claim/ack. Never store it in files/source/browser or chat. No Apple login, ThingsCloud password, or direct Things database access is needed.
- Keep human approvals owner-authenticated. Service-only Mac access cannot approve or act as a signed-in user; verify denial cases and revocation using synthetic data, and verify that Mac HTTP access preserves the owner-private gate.
- Implement one supported AppleScript/Shortcuts read-only inventory adapter, then request explicit live **read-only** test authorization if not already included in the approved slice. No production Things/Calendar writes until a reviewed concurrency policy addresses the no-CAS limitation. The strict no-concurrent-overwrite guarantee is unavailable through supported Things automation.
- Configure cloud/Mac journal exports, retention, restore drill and one-adapter process protection, then approve persistent launch/sync settings. Confirm sleep/reconnect behavior and timestamp handling with travel timezone fixtures before the trip.

Do not bundle live task edits, Calendar invitee notifications, public sharing, GitHub publication or unrestricted remote execution into that approval. Google Calendar is a separate scoped read/API authorization and integration step. Reuse the existing LifeOS tool names/proposal cards where feasible; adapt calls to the companion, do not replace unrelated LifeOS functionality.

Acceptable first trip version: cloud status/read snapshots + owner-reviewed queued proposals, with automatic real Things writes disabled. This provides access through dot while the Mac is closed and clearly shows that tasks wait for a safe reconnect/application flow.
