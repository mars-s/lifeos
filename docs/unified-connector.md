# One LifeOS connection

## Rollout status, 3 October 2026 Melbourne

The unified Worker was published as version
`a95b81d8-7012-4a16-8c28-e5ad461f4cf0`. The previous version is
`df2f2fa8-136f-47f1-af7c-ab36d2f2c1c3` for rollback.
Public health returned 200 and unauthenticated MCP returned 401.
These checks do not prove authenticated host behaviour or production CPU usage.

The signed Mac app was installed using the existing signing team. Its previous
build is preserved at `/Users/avi/.Trash/lifeos-sync-pre-unified.TY11dX/LifeOS Sync.app`.
Its metadata status reported Connected, with local tools disabled. No local-tool
consent or ChatGPT grant was changed. Live host verification and retiring the old
Secure connector remain outstanding.

Python verification, schema drift check, all five Worker test suites, TypeScript
checking, deployment dry-run and 40 Swift tests passed. No test applied a real
proposal. The installed native app resumed its existing sync behaviour.

Use the existing Cloudflare MCP endpoint:

`https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/mcp`

This migration adds the existing GenUI cards and an optional awake-Mac tool bridge.
It does not replace the native smart-sync journal or change existing OAuth grants.
Keep LifeOS Secure until the replacement has passed a live ChatGPT check.

## Privacy

Raw brain dumps and meeting transcripts are stored by the existing LifeOS SQLite
and journal stores on the Mac. Bridge requests and responses pass through the
cloud in memory, but are not written into D1, the durable queue or diagnostic logs.
The cloud renderers do not save supplied preview content.

ChatGPT still receives the text it sends or requests. This is local canonical
storage, not a promise that text never leaves the machine. Explicit memory indexing
still uses the previously configured remote extraction model. Do not index a
capture if it must not be sent to that provider.

## Availability

- Cloud mirror reading and queued title/completion/Trash operations retain their
  existing offline behaviour.
- Day, week and brain-dump preview cards can render supplied data without a Mac.
- Capture, source retrieval, Calendar, planning, local memory and proposals need
  an awake Mac, an enabled bridge and the relevant OAuth grant.
- Local calls are bounded, transient and never queued or automatically replayed.
  A timeout or lost connection means the outcome may be unknown. Inspect saved
  capture/proposal state before retrying a write.
- `apply_approved_proposal` retains the existing exact-revision, snapshot and
  read-back checks. It also requires `things:write` on the cloud connection.

## Activation

1. Build and install the updated, consistently signed LifeOS Sync app. Preserve
   its Application Support state, Keychain identity and existing login setting.
2. Select **Enable local LifeOS tools** in its menu. The bridge is off by default.
3. Reconnect the existing cloud connection in ChatGPT. Explicitly approve
   **Include local LifeOS tools**. Approve queued writes too if proposal apply is
   wanted. Existing grants and refreshed old tokens do not gain these scopes.
   For Bana notes, also tick **notes** (search and read) and **notes:write** (add and
   edit). A grant without them never lists the note tools. See the
   [rollout checklist](bana-rollout.md).
4. Refresh its tools. `get_lifeos_capabilities` separates bridge connectivity from
   permission. Neither is proof that ChatGPT mounted a card or applied a write.
5. Verify a supplied preview and a disposable capture in the actual host. Check
   review/apply with an explicitly approved disposable task before retiring Secure.

The bridge starts a fixed, allowlisted Python subprocess only for a tool call.
It has no extra listening port, idle model or periodic polling. The executable
is `.venv/bin/python` in `/Users/avi/Developer/projects/lifeos`. Native Things sync
continues independently of this optional Python bridge.

## Verification

Run `sh scripts/verify.sh`, the Cloudflare MCP/native/smart/events suites and
`swift test` in `mac-sync`. These use synthetic inputs and isolated stores.
Regenerate schema-only contracts using `uv run python scripts/export-ui-contracts.py`.
The verification script rejects contract drift using `--check`.

Protocol tests check exact planner results, resource bindings, old-scope denial,
write-scope denial, transient dispatch, busy/disconnect handling and absence of
synthetic raw text from cloud storage. They do not establish a live ChatGPT flow.
