# LifeOS cloud cache companion prototype

Created separately at `/Users/avi/Documents/Codex/2026-09-30/task-3/lifeos-cloud-cache-prototype`.
Existing LifeOS: `/Users/avi/Documents/ChatGPT/lifeos`. Its Git checkout has **no configured remotes** (verified September 30, 2026); its GitHub location remains unverified. The original checkout, production service, Things data, calendars and Heimdall are untouched.

**Current status, 31 October 2026:** Cloudflare Workers + D1 hosts the authenticated mirror and durable queued Things writes. `LIFEOS_WRITES_ENABLED` gates writes; `cloud_wins` and smart sync policies are supported. OAuth hardening and consent are implemented, with browser MCP origins configured through `LIFEOS_MCP_ALLOWED_ORIGINS`. Version 4 Mac support is implemented in `mac-sync/`, pending an app rebuild and restart. Apply remote migration 0005 before deploying. GitHub OAuth client secret rotation remains pending. See the [current contract](cloudflare/README.md) and [deploy steps](cloudflare/DEPLOYMENT.md).

The [initial gateway deployment](cloudflare/DEPLOYMENT.md), [read-only activation](cloudflare/ACTIVATION.md) and [dot connection handoff](cloudflare/DOT_CONNECTION.md) preserve historical evidence, including 59 supported records cached on 1 October. They do not establish the deployment state of the latest local source.

This is a lean companion to LifeOS's existing proposal workflow, not a replacement app. It follows the original `proposal_store.py` / `service.py` concepts: immutable reviewed revision, explicit approval, durable operation receipt. No original implementation was copied or imported. Compatibility is semantic; original MCP tools are not wired to this API. The original reader uses `things-py`; that is deliberately not used here. This companion uses supported public Things automation.

Historical prototype implementation and verification (September to October 1, 2026):

- Python standard library only: durable SQLite snapshot cache, tombstones, immutable operations, append-only audit, scoped WSGI JSON API.
- Reviewer approval of exact revision before the adapter can claim an operation; dot/proposer and adapter credentials cannot approve.
- Field-level base values plus snapshot revision. Fresh mock Things read and conditional mock patch detect same-field conflicts and preserve unrelated fields.
- Persistent Mac intent/receipt journal, immutable acknowledgement retries, complete-inventory sequence replay; ambiguous outcomes stop as `uncertain`.
- Narrow HTTPS adapter transport, refusing redirects so credentials stay at the selected origin.
- Dot review UI with confirmed snapshot, last sync age, proposals, approve/reject and a synthetic reconnect button.
- `Store.backup()` uses SQLite's online backup API. Tests restore a pending journal and check SQLite integrity.

**Automated mutation tests use synthetic fixtures; approved live public reads were also verified.** The corrected fixed AppleScript/JXA union reader returned 45 tasks, 4 projects, 4 areas and 6 tags, including direct Logbook/Trash membership. Failed/inconsistent scans abort without snapshots. At that historical checkpoint, real writes remained disabled and untested. Google Calendar is disconnected. Sites has an owner-isolated generic mirror, paginated snapshots, field revisions, separate pending overlay, immutable review journal, independent cloud planning priority, and narrow service routes disabled until secure setup. Its [owner-private version 2 deployment](SITE_DEPLOYMENT.md) succeeded; parent verified the Site MCP read connection and empty cloud mirror. [Supported field matrix](FIELD_CAPABILITIES.md) and [exact setup gates](MIRROR_SETUP.md) distinguish this phase from full-fidelity task mirroring. The historical [Site credential handoff](mac/READ_ONLY_HANDOFF.md) remains blocked. The user subsequently completed the separate Cloudflare credential setup, supported real upload and background helper installation described above; no paid resource was provisioned.

## Verify

From this directory:

```sh
python3 -W error::ResourceWarning -m unittest discover -s tests -v
python3 -m compileall -q lifeos_cache tests
node --check lifeos_cache/web/dot.js
```

`ruff check lifeos_cache tests` is also supported. See `VERIFICATION.md` for the observed result.

## Local fixture preview

Supply three distinct **synthetic fixture strings** of at least 20 characters in `LIFEOS_DOT_TOKEN`, `LIFEOS_REVIEWER_TOKEN` and `LIFEOS_ADAPTER_TOKEN`, then run:

```sh
python3 -m lifeos_cache --port 8767
```

Open `http://127.0.0.1:8767`, click the dot, and enter the synthetic reviewer string. Propose a title, approve its displayed revision, then simulate reconnect. Tokens remain in process memory; the UI does not store them in browser storage. The preview binds only loopback, uses a temporary directory and deletes its synthetic databases when stopped normally. It never launches Things. The reconnect route exists only with an explicitly injected mock callback. No server was left running by this task.

The WSGI preview server is a development server. Do not expose it publicly. Real production serving, TLS, credential provisioning, owner authorization and adapter registration are rollout gates, not completed setup.

## API contract

| Role | Routes |
|---|---|
| dot | GET `/state`, POST `/proposals` |
| reviewer | those routes plus POST `/approve`, `/reject` |
| adapter | GET `/adapter/pending`; POST `/adapter/snapshot`, `/adapter/claim`, `/adapter/ack` |

All data routes require the supplied bearer credential. `/health` and static UI contain no private data. There is no arbitrary command/script/URL execution route. Snapshot uploads require `complete: true`; partial queries must never call this route. One full inventory includes all supported tasks including status/trash as appropriate; a limited Today list is insufficient.

A proposal takes `op_id` (also the idempotency key), `kind` (`patch` or `create`), allowlisted `fields`, IANA `zone`, and for a patch `target` + `base_revision`. Decisions take `op_id` + exact `revision`. Changing a proposal means a **new immutable operation ID and new approval**; this prototype does not mutate drafts or implement the original proposal revision-number API. A failed/conflicted/uncertain operation cannot be reset or silently retried. Reconcile, refresh the source, and create a new reviewed proposal.

See [DESIGN.md](DESIGN.md) for correctness limits and Calendar plan, [HOSTING.md](HOSTING.md) for Sites-first evaluation and current official pricing, and [ROLLOUT.md](ROLLOUT.md) for the approval bundle.
