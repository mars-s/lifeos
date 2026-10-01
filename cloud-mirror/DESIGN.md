# Architecture and boundaries

```text
dot / existing LifeOS MCP
    ↓ authenticated read/propose
cloud cache + immutable journal ← owner review approves exact revision
    ↑ snapshot / claim / verified receipt
one Mac adapter + local durable intent/receipt journal
    ↓ supported Things automation while awake
Things (canonical confirmed tasks) → ThingsCloud → iPhone
```

Cloud cache availability does not require the home lab or the Mac. Things writes do require an awake, connected Mac. For the three-month trip the home lab is excluded from hosting, backup jobs and any critical relay. Cache is explicitly **last-synced Things**, not a ThingsCloud client. ThingsCloud identity is separate from Apple identity; neither Apple nor ThingsCloud credentials belong in this system. No private cloud client, direct Things database or database-reading package is used.

## State and correctness

`draft → queued (exact owner approval) → executing (single claim) → applied | conflict | failed | uncertain`.
`draft → rejected` is final. Confirmed snapshot and pending overlay are distinct; approval never changes canonical cached fields. An applied receipt confirms a Mac read, not successful ThingsCloud transport or iPhone visibility. Complete inventory refresh updates the cache afterwards. “Recent” means an observation less than 120 seconds old, not proof the Mac is online now. UI shows age and pending count; an offline/stale label never promises live data.

- Snapshots have a content revision; patches retain only the changed fields' reviewed base values. A changed title blocks title replacement; changed notes do not block an unrelated title patch. Missing/unobserved fields cannot be edited. Values cannot detect unobserved ABA changes (change then revert); these are not vendor revision tokens.
- Before a write, read the real item through supported automation and compare each edited field. Post-write read checks intended values before a receipt claims applied. Only fixed typed automation templates may handle allowlisted fields. Cloud request content is data, never executable instructions.
- **No true Things CAS:** AppleScript/Shortcuts/URL scheme cannot conditionally write against a cloud revision atomically with iPhone updates. Reads can be stale while ThingsCloud catches up, and an iPhone edit can arrive between local read and write. The atomic `MockThings.guarded_patch` is a test assumption only. No live patch is enabled here; the strict requirement to never overwrite a concurrent iPhone change cannot be guaranteed with these APIs. Initial supported deployment should support read snapshots + draft/approval queues while write execution stays disabled pending a reviewed concurrency policy. Notes replacement is especially sensitive and should remain disabled until that review.
- Intent is durable **before** an external write; success receipt is durable before cloud acknowledgement. On reconnect an existing receipt is resent, not the command. A crash after create but before receipt is `uncertain`; do not infer success from title matching, automatically create again or delete possible duplicates. Fixed operation marker in created notes could aid human reconciliation later, but is not implemented and is not an exactly-once guarantee.
- Claims have no timeout reissue. Unknown executing operations or lost local receipt journal stay blocked; another adapter must not steal a lease. A queued intent left before claim also stops conservatively after restart. Single Mac adapter instance is required; OS-level singleton enforcement is a rollout gate.
- A definite no-side-effect rejection is failed. Timeouts, unknown command errors and post-write mismatch are uncertain. Raw errors/URLs/secrets are not returned. Failures require user-visible repair and a new approval where a new command is needed.
- Complete authoritative inventory omissions produce tombstones retaining last known fields. Deleted targets block edits. Delete commands and bulk writes are disabled. Restored records may reappear with the same ID; tombstones should not be purged while relevant journal entries remain.
- Exact UTC-offset observation/receipt timestamps, positive monotonic upload sequences persisted on Mac. Persist upload payload before delivery; retry identical sequence after a lost acknowledgement. Reject backwards observations/reused sequences. A reset/replaced Mac journal requires an explicit epoch/re-registration migration; do not guess new sequence values. Only one adapter identity/stream is supported.
- Things deadlines are civil `YYYY-MM-DD`, associated with reviewed IANA timezone. Never send relative “tomorrow” through an overseas reconnect. Reminders, start times, DST-ambiguous times and repeating tasks are outside this prototype. Reject unsupported fields; future time operations must define instant versus local civil meaning and reject ambiguity.

## Google Calendar

Google Calendar remains canonical for calendar events, separate from Things. The original LifeOS Calendar gateway uses local EventKit; Google-specific cloud access is not established by that adapter. This prototype has **no real Calendar integration** and never tests against real events. Do not imply a Calendar write needs the Mac once a separately approved official Google API integration exists.

Small next slice: official Google Calendar API read/freebusy through an approved connector or scoped OAuth, then use the same immutable proposal/approval journal for optional work-block writes. Maintain a separate sync age and status per source. Persist `nextSyncToken` only after the final page; preserve deletion entries, and on HTTP 410 replace the Calendar cache with a full sync while retaining LifeOS audit history. [Official sync guide](https://developers.google.com/workspace/calendar/api/guides/sync).

For edits use ETags with conditional requests; 412 means conflict and new review. Use `get` plus update preserving unrelated fields. Calendar supports conditional modification unlike Things. For creates choose a stable provider-valid event ID derived from the operation ID, re-read that exact ID on retry and verify operation metadata; never create another event blindly. Google explicitly documents custom event IDs as protection against duplicate creations on retries. [Update guide](https://developers.google.com/workspace/calendar/api/v3/reference/events/update), [create guide](https://developers.google.com/workspace/calendar/api/guides/create-events).

Keep UTC instants + original IANA timezone for timed events, date-only for all-day events (exclusive end date), recurrence instance IDs and original start times. Invitee notification, existing-event deletion and multi-source atomic commits are disabled by default. A Things+Calendar proposal may partially apply; show per-operation receipts, never claim cross-provider transactional rollback.

## Persistence and recovery

One owner, one gateway writer, one Mac adapter, small personal inventory: SQLite WAL + `synchronous=FULL` on a durable local volume suffices. No Redis, CouchDB, queue broker or separate database service is warranted. Transactions atomically couple decisions/claims/receipts with audit. Audit triggers protect against accidental application edits, not a malicious database administrator.

Mount the entire data directory so SQLite main/WAL/SHM survive container restarts. Never place the journal on ephemeral root storage. Never run independent replicas with separate SQLite files. Small deployments accept restart/deploy downtime; there is no HA claim. Move to a managed relational database only if multi-writer/HA requirements actually arise. Sites instead requires Worker + D1 (persistent SQLite-compatible SQL service), not a filesystem SQLite WAL connection; port transactions to D1 atomic batches and conditional statements and re-run the state-machine suite.

Back up BOTH the cloud database (pending approval/audit cannot be rebuilt from Things) and Mac receipt journal (ambiguous outcomes otherwise cannot be resolved). Use SQLite online backup for app exports; raw main-file copies during WAL writes are unsafe. Store encrypted exports outside the host and outside the travel-offline home lab. Recommended initial target: hourly export, 7 daily + 12 weekly versions, restore drill before travel, explicit one-hour RPO target if exports are successfully scheduled. **No jobs are configured here.** Host snapshots are additional coverage, not the only copy.

Restoring a stale cloud backup may reintroduce old queued operations. Keep the Mac receipt journal and reconcile claimed/applied IDs before enabling writes. If that journal is lost, stop execution. A restore process must never automatically replay creates. For Sites, confirm D1 export/restore and retention using the actual managed hosting surface before reliance; do not assume direct access to a Cloudflare account or apply Cloudflare's public quotas to Sites.
