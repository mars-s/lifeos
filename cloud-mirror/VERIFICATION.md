# Verification evidence · September 30, 2026

Final source checked on this MacBook with Python 3.14.7.

| Check | Observed outcome |
|---|---|
| `python3 -W error::ResourceWarning -m unittest discover -s tests -v` | **28 tests passed**, final run 0.668 s |
| `mypy --check-untyped-defs lifeos_cache` | **Success: no issues found in 6 source files** |
| `ruff check lifeos_cache tests` | **All checks passed!** |
| `python3 -m compileall -q lifeos_cache tests` | Exit 0 |
| `node --check lifeos_cache/web/dot.js` | Exit 0 |

The suite verifies drafts never execute, exact immutable approval, rejection, offline persistence/reconnect, same-field iPhone-style conflicts, unrelated-field preservation, an atomic MOCK conflict boundary, idempotency keys, exclusive claims, immutable acknowledgement receipts and append-only audit, duplicate-free create acknowledgement replay, uncertain create/patch crashes before receipt, conservative pre-write crash recovery, lost Mac journal behavior, snapshot acknowledgement replay, stale/reused snapshots, tombstones, failed versus ambiguous commands, post-write mismatch, civil dates/timezones, invalid fields and missing revisions, backup restore/integrity, role separation, spoofed identity header denial, no command endpoint, complete inventory requirement, body size, HTTPS/redirect guards, and a real temporary loopback HTTP adapter round trip.

Initial default sandbox attempts blocked the loopback listener and the typechecker download. Approved execution permissions allowed the isolated checks; no approval rejection or unresolved test blocker remains. Test listener shutdown and joined thread are asserted in the suite. No production port was inspected or driven. Mypy was installed only into this project's temporary tool cache for verification, then that cache was removed. Runtime has no third-party dependencies. Mypy checks are not strict mode and JSON boundaries use `Any`; this is not a proof of full static typing.

No test reads/writes Things, ThingsCloud, Apple Calendar, Google Calendar, the original LifeOS database, or any credential. Fixture titles/notes are synthetic. SQLite test stores and adapter receipt stores live in temporary directories, closed and removed by test cleanup. HTTP auth strings are public fixture values, not generated real credentials. No daemon/listener was left running.

The additional Sites Worker/D1 port is implemented and tested separately; see [Site verification and deployment status](site/SITE_STATUS.md). Its local Miniflare tests cover owner isolation and denial of identity-less service requests, but deployed identity injection and access enforcement are not verified.

**Not verified:** live supported Mac automation, iPhone synchronization, real Google Calendar, deployed private Sites authentication, a Mac service credential, hosted backups, hosting uptime/cost under actual load, existing MCP UI integration, rendered browser UI. The static UI received JS syntax checking and manual source inspection; no browser rendering claim is made.

Supported Things APIs lack atomic cloud compare-and-swap; fresh reads cannot guarantee preventing every concurrent iPhone overwrite. The atomic patch test validates the mock contract only, and real write execution is disabled. See `DESIGN.md` and `ROLLOUT.md` before enabling anything live.

## First-phase mirror extension · final checks

**Live read checkpoint, 2026-09-30:** the initial 8-task JXA top-level result was incomplete. Corrected public union/classification reader successfully returned **45 tasks, 4 projects, 4 areas, 6 tags**, with 36 observed Logbook members and 5 Trash members, across 13 public lists. Two full field/membership/order scans and before/after AppleScript class probes agreed. Zero unknown cells; no personal output beyond aggregates, no upload or write. Required-list, unknown-class, budget, collision and drift failures abort before staging. Coverage means the supported public union, not internal/full fidelity or atomic snapshot. Site MCP read was verified by the parent; cloud remains empty. Credentials and LaunchAgent remain unconfigured. See `mac/READ_ONLY_HANDOFF.md`.

Reader-fix validation: **47 Python tests** and **6 Node reader tests** passed. The new reader tests execute the actual fixed JXA in a mocked application runtime (public-list union, stable-ID dedupe, project/child classification, Logbook/Trash distinctions, missing/unreadable list, unknown class/kind collision, field/membership drift, duplicate per-list ID and oversize abort). Python additions cover before/after class drift, unknown/conflicting class, no upload/staging from a failed scan and persisted coverage evidence. Native JXA/AppleScript compilation passed. No real writes, secrets or helper activation occurred.

Runtime credential-provider extension: **56 Python tests passed**, final run 0.718 s; Python compilation passed. The nine additional public-fixture checks cover direct 1Password references, no secret arguments/files/environment/force flag, Keychain compatibility, malformed/cross-item/plaintext config rejection, native denial/timeout/header safety, cached per-pass loads, deadlines and persisted failure backoff. No live secret read, vault save, credential provisioning, upload or helper activation occurred. This extension does not solve the rejected initial token handoff or claim unattended 1Password access.

- Python: **42 tests passed**, 0.696 s. Includes the earlier 28 and 14 helper tests: fixed structured-stdin boundary, live-access gates, fixture-ID write allowlist, 205-item upload pagination, exact upload retry, restart receipts, same-field drift, unrelated-field preservation, before-write/after-write/before-ack crashes, no claim stealing, read-only sync, wake/backoff/no catch-up, secure local journal permissions and HTTPS-origin checks.
- Local D1: **27 focused subtests passed** (29 TAP tests including enclosing tests), 2.208 s. Includes 15 generic mirror and 12 existing sample cases. New coverage includes staging completeness, 205-record owner pagination, field unknown/absent/unsupported preservation, ABA revisions, scoped tombstones, independent cloud priority, owner/service isolation, service disabled by default, no machine approval or arbitrary commands, immutable journal/audit, independent partial outcomes, concurrent snapshot commits and full Miniflare restart.
- TypeScript `tsc --noEmit`: passed, including the final supported publishing workflow.
- Native JXA syntax compilation with `osacompile`: passed, without executing the automation script or granting access. Node JS syntax check passed too. This is not runtime verification against Things.
- Python bytecode compile: passed. Prepared LaunchAgent `plutil -lint`: passed; it was not loaded.
- Bundled Sites build/source-push/package validation: passed. Terminal private deployment of **version 2** succeeded at 11:56:18 UTC; see `SITE_DEPLOYMENT.md`.

Ruff is not available in this refreshed shell; no new Ruff result is claimed for the helper extension. Earlier Ruff/mypy results apply to the initial Python prototype, not the added helper. No browser rendering or hosted API end-to-end claim is made. All synthetic Workers/test listeners were disposed. Original LifeOS, Things data and Calendar were untouched. No Mac service key/bypass token or persistent access was configured. CPU/RAM targets require measurement during the separately approved live read test.
