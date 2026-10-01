# Smart merge for LifeOS

## Decision

Use a deterministic, field-level three-way merge. Preserve changes that affect different fields. Preserve a Things change observed after a cloud change was verified and confirmed. Use Cloudflare's desired value only as the automatic fallback when both sides changed the same supported field from a known common base. Cloudflare remains the authority for ordering operations, recording decisions and publishing the effective view. It does not continuously enforce an old value over future Things edits.

Titles remain whole strings. Completion remains the existing command to set a to-do to completed. Trash remains the existing recoverable public move. This design adds no notes, tags, dates, relationships, reopening, restoration or deletion capabilities. It uses no LLM to interpret a task or infer intent.

The main prerequisite is fixing the base. Today `NativeQueue.prepareEnqueue` copies the freshest mirror value while preserving the caller's potentially older `base_revision`. Those two facts may refer to different observations. A valid merge cannot use that manufactured base.

## Evidence and scope

The inspected `cloud-mirror/cloudflare/native-queue.ts` stores immutable payloads, supersedes queued same-field edits, claims per target and holds cloud desired fields separately. Its cloud policy bypasses the base revision guard. `owner-sync.ts` journals FIFO accepted requests and freezes prepared payloads before committing D1. `site/lib/mirror-store.ts` advances cell revisions for observed changes, rejects older complete snapshots and retires overlays only after receipt and snapshot fences match. `mac-sync/Resources/native-write.js` currently compares the base only for Things policy. `native-trash.applescript` uses a public move and treats interrupted cloud Trash as verification-only. `SyncCore.swift` owns the durable serial native journal and interrupted write checks.

The proposal keeps those boundaries. The repository was read only. No live task reads, automation writes, tests, deployments or restarts were performed.

## Values and causal evidence

For a field, B is the exact value the caller saw. C is the requested cloud value. L is the fresh public Things value immediately before execution. An observation is not an explicit Things user operation. A ThingsCloud update from another device is also L.

Separate content equality from version identity. A field version identifies an observation lineage, not just a value hash. Persist each observed transition with an owner, target, field, monotonically increasing version, canonical cell, source and predecessor. Receipt-backed setter transitions also receive versions, including a return to an earlier value. Identical repeated snapshots do not create versions. A recorded A to X to A transition differs from unchanged A. A hidden A to X to A transition between scans remains undetectable.

The cloud editor reads an owner-bound observation frame. Each displayed editable field carries a token identifying its value and field version. If the displayed value is a pending desired overlay, its token also names that operation and ordinal. The client submits that token unchanged with C. It never supplies an arbitrary base value trusted by the server. The server resolves the token to retained immutable evidence and stores B in the operation. A token must cover the target identity and kind, field, native snapshot sequence, exact state/value, observed field version and any desired predecessor that contributed to the display.

For Trash, the frame also records the supported target versions for title and status, plus availability and Trash membership. This detects a delete racing an edit. It does not imply every private Things property is observed.

A cloud ordinal proves accepted cloud order. A snapshot sequence proves native observation order. `seen_cloud_revision` proves a capture fence, not that the human saw that revision. Wall-clock timestamps do not prove causality. A caller's frame explicitly referencing an earlier cloud desired operation proves the caller edited that displayed desired state. A fresh matched snapshot after an applied receipt proves the cloud value was subsequently observed. It does not prove which device or human caused a later differing value.

Classify same-field changes as follows.

* C is causally newer than a cloud predecessor when its display token references that predecessor, or a confirmed field version descended from it.
* L is observably subsequent to a cloud result when a receipt verified C, a later fenced snapshot confirmed C, and a still later accepted native observation differs. Accept that subsequent observation as the new field state. Do not revive the finalized old intent.
* If B predates changes on both branches and neither branch has evidence of seeing the other, classify the divergence as concurrent or causally unknown. The fallback is cloud. Do not label it proven simultaneous user editing.

## Merge rules

Apply availability and supersession guards first. A missing or trashed target cannot receive a title or completion setter. A cloud Trash desired state dominates pending edits to that target. Newer accepted supported desires supersede older same-field runnable work. Every supersession retains the displaced operation and its reason. Already executing work must check the current desired ordinal before setting or recovering.

For a known base and an available target, the pure field reducer uses the following table.

| Condition | Decision | Native action |
| --- | --- | --- |
| L equals C | Converged | No setter, satisfied receipt |
| C equals B and caller created no change | Cloud no-op | Preserve L, never supersede a real pending edit |
| L equals B, with no recorded intervening version | Cloud-only change | Set C |
| L differs from B, C differs from B, L differs from C | Concurrent or unknown divergence | Set C, archive L and B |
| L equals B but its recorded lineage changed and returned | ABA divergence | Treat as conflict, set C under cloud fallback |
| L is unknown, unsupported or cannot be read | Insufficient evidence | No setter, failed or uncertain result |
| Base token cannot be resolved or authenticated | Unknown base | Retain request draft, require refresh before acceptance |

For a field whose applied desire was confirmed and retired, subsequent snapshots simply update the confirmed field. There is no old C to reapply. If a mismatch appears after verification but before a matching confirmation snapshot, preserve the mismatch as an observation, close the intent as `observed_diverged_after_write`, remove its effective overlay with an explicit decision, and do not issue another setter. The mismatch may be a new edit or delayed propagation. That uncertainty belongs in the audit. It must not create an endless overwrite loop. This retirement requires a capture that began after the receipt's native fence and includes that specific operation's verified outcome, not merely an ordinal watermark.

An unchanged mirror B is insufficient evidence of no native change. The executor always reads L, even when cloud enqueue revision checks pass. If version evidence is incomplete, record that limitation rather than inventing a local edit timestamp.

For two cloud edits from a shared old base, the owner FIFO acceptance ordinal is the deterministic conflict fallback. The last accepted supported desired edit wins that field. For two edits where the second saw the first overlay, the second is causally newer. Both cases converge to the second value, but their recorded reasons differ. New same-value desires may resolve as satisfied without a setter, but cannot erase a newer different desire. A cloud no-op relative to its displayed base is not an instruction to revert someone else's work. An explicit undo is a new edit against the current displayed token.

## Supported examples

* Base title is “Buy milk”. Things changes title to “Buy oat milk”. Cloud completes the task. Apply completion and preserve the title. Title and status have separate versions and desires.
* Base title is “Buy milk”. Things changes it to “Buy oat milk”. Cloud changes it to “Buy milk today”. Choose the full cloud title and retain both alternatives. Do not synthesize “Buy oat milk today”. Word-level edits can change meaning even when their character ranges do not overlap.
* Base status is open. Cloud requests completed and L is already completed. Record satisfied. If L is canceled, treat that as same-field divergence and use completed as the fallback. The current capability does not issue reopen or cancel writes.
* Cloud completion is verified, then a fenced snapshot confirms completed. A later Things snapshot shows open. Accept open as the subsequent observed state. Do not send completion again from the retired operation.
* Cloud Trash races a Things title or completion change. Move to Trash using the existing public script and record the displaced supported field values. This follows the known explicit cloud command and cloud fallback. It is recoverable and does not empty Trash.
* Things already moved the task to Trash while cloud edited its title. Skip the title. Do not restore or recreate the task. If the native target is missing rather than positively in Trash, record unavailable, not successful deletion.
* Cloud edit is queued, then a newer cloud Trash is accepted. Suppress the edit. When Trash is accepted first, later cloud field edits are rejected against the effective unavailable state even if the confirmed mirror still looks available.

## Schema and API

Add version 3 immutable operations with `conflict_policy = smart_merge`, `merge_algorithm = supported_fields_v1`, and `fallback = cloud`. Keep version 1 Things policy and version 2 cloud policy unchanged. The owner intent freezes policy and algorithm at acceptance so a flag flip or retry cannot change it.

A version 3 operation contains its original canonical request hash, resolved base token and exact base cell, requested value, target kind, target availability frame, accepted ordinal, causal predecessor references and applicable supported version vector. The operation may remain single-field. Maintain append-only `native_field_versions` and owner-bound `native_observation_frames`. Add `native_merge_decisions` keyed by operation and attempt identity. A decision contains algorithm version, expected desired ordinal, B/L/C, local observation version or unknown provenance, classification, chosen value, discarded value and the native capture fence. Store any successful setter outcome in the existing immutable receipt audit, with the decision identity and attempt outcome. Keep chosen desired values separate from confirmed observations.

Decision records do not authorize arbitrary scripts. The public adapter accepts only typed title, completion or Trash actions derived from the frozen operation. Consent remains the existing application automation and per-operation write authority. A smart merge is not permission to write additional fields.

Add terminal dispositions `no_change`, `superseded` and `observed_diverged_after_write` to the new policy's result contract. A successful `applied` receipt never changes into one of these. A later reconciliation disposition is a separate append-only event. A failed or unavailable operation removes its overlay only through an explicit guarded disposition. Do not leave failed cloud desires displayed forever.

The effective view includes pending desires across the full table, independent of recent receipt pages or native execution batches. Trash overlays suppress supported edit affordances. Each overlay removal compares operation identity and ordinal so it cannot remove a newer desire. Older saved snapshots cannot remove overlays or introduce a new field version over a newer committed sequence.

## Offline bases and retention

Before enabling the new API, start retaining observation frames and per-field transition history. Existing latest cells are a first retained root, not reconstructed history. Pin every frame referenced by an accepted operation or durable offline editor request. Never prune pinned bases, audit values, unresolved decisions or predecessor references needed by an outstanding operation. Retain unreferenced frames for a defined product window, initially 90 days, with cleanup performed in bounded batches on events or maintenance jobs. This is storage maintenance, not native sync polling.

Offline edits carry the original display token. A stale but retained base is valid. Compare it against current cloud lineage and fresh L. Several unobserved changes do not invalidate it, but may place it in cloud fallback conflict. If an offline token predates the retained root or has expired, do not silently substitute today's mirror cell. Keep the desired text locally as a draft, refresh the view and ask for a new explicit edit only for that unrecoverable base. Ordinary conflicts resolve automatically.

For an offline edit created over a pending overlay, the referenced operation must remain resolvable even if it was later superseded or failed. The token describes what the caller actually saw. Its later disposition can affect classification, but cannot rewrite B.

## Execution and crash recovery

Keep the native serial queue-first writer. Claim remote ownership, verify the immutable payload and current desired ordinal, and durably journal the pre-write phase. Read supported public fields and availability. Compute the merge. Persist the exact decision locally before invoking the fixed public setter. Check current desired ordinal immediately before invocation. A newly superseded operation does not set. Persist the receipt before acknowledgment and replay the exact acknowledgment after an ambiguous network failure.

The native decision can be uploaded after the outcome rather than adding a round trip between every read and setter. It remains durable locally; the remote receipt binds the decision hash. A current-desire query is necessary before writing and recovery. Owner acceptance ordering is preserved, but it cannot atomically fence an already invoked Things setter. A later cloud desire will ultimately converge through the serial queue.

If the process crashes before invocation, recovery may reread L and write a new append-only attempt decision under the same operation, provided claim and desired ownership still hold. If the journal says invocation began, recovery is not an ordinary remerge.

* If current equals chosen value, record satisfied verification with an explicit uncertain execution origin. This is state convergence, not proof that this setter performed the edit.
* If superseded, do not replay. Record a new disposition and let the newer operation run.
* If title or completion still equals the durable attempt's observed-before value, permit idempotent replay only after claim and desired checks. The unchanged value is weak evidence because hidden ABA is possible; record that recovery basis.
* If title or completion differs from both chosen and observed-before, stop automatic replay and record uncertain. An interrupted old setter must not overwrite a possible later edit by applying cloud fallback again. Review is limited to uncertain outcomes.
* Interrupted Trash remains verification-only. Already in Trash is satisfied. Still outside Trash is uncertain, even if the before value matches. Never repeat deletion from an ambiguous phase.

After a verified write, generate a causally fenced fresh snapshot on the existing one-shot dirty-generation path. Do not add a periodic scan. Matching confirmation retires the desire. Subsequent divergence retires it through the separate audited disposition above. Automation denial follows existing retry or visible failure handling, without turning an unreadable cell into a conflict decision.

## Limits

Things offers no atomic compare-and-set here. A human or ThingsCloud can change L between read and setter. Rechecking reduces the window but does not eliminate it. Post-read verification proves the observed after value at that instant. It cannot prove that an intervening edit was never lost. Neither two matching full snapshots nor FSEvents is an operation feed. A delayed phone update can look like a subsequent local change. Preserve it when observed after confirmation, but report observation order rather than proven user-intent causality.

The system guarantees deterministic decisions from retained evidence, immutable explanations, preserved unrelated supported fields, no automatic resurrection, no blind deletion replay and eventual convergence when writes and observations become stable. It does not promise linearizability, exactly-once Things side effects, recovery of unobserved alternatives or perfect multi-device causality.

## Rollout, performance and UX

Ship base tokens and retention first behind a capability flag. Then ship the version 3 native parser, pure reducer, journal decisions, receipt contract and causal confirmation dispositions. Enable smart merge only when the registered native client advertises version 3 and the required public adapter capabilities. Old queued operations keep their original policy. Do not backfill an invented base for existing version 2 operations or reinterpret historical Things receipts. Deploy enablement and external actions still require the session's existing authorization.

Keep one bounded public read per affected target and reuse it for the supported fields needed by Trash decisions. Use indexes on owner/target/field/version and operation/ordinal. Complete snapshots remain the existing bulk reader and event-coalesced two-pass path. Only changed supported cells add transition rows. No per-task polling, no task-level LLM calls and no WebSocket data payloads are added. Network access unavailable at the pre-write ownership check means no new setter.

Normal UX remains automatic. Show the effective desired value as pending until verified and reconciled. A compact activity entry says that a concurrent title was resolved to the cloud edit and exposes the retained alternative. Restoring an alternative is a fresh supported edit against the current token, never history mutation. Uncertain execution and expired bases receive exceptional review. Do not ask the user to choose every same-field conflict.

Future notes could use a separately reviewed deterministic text-merge algorithm only after supported public writing, accurate bases and capability consent exist. Tags could eventually use identity-based set operations with remove evidence. Dates require explicit time-zone semantics. Projects and relationships need graph constraints. None belong in the current reducer or rollout.

## Deterministic verification matrix

The pure reducer and integration fixtures must verify both chosen values and absence of forbidden setters. All cases use retained exact tokens unless stated otherwise.

| Case | Inputs or ordering | Expected result |
| --- | --- | --- |
| Cloud-only title | B=A, L=A, C=B2 | Write B2, retain base |
| Native-only title | B=A, C=A no-op, L=X | Preserve X, no setter |
| Same value | B=A, L=X, C=X | Satisfied, no setter |
| Same-field conflict | B=A, L=X, C=Y | Write Y, archive X |
| Unrelated fields | Native title X, cloud completion | X plus completed |
| Recorded ABA | B=A v1, native A v3, C=Y | Conflict fallback Y, ABA reason |
| Hidden ABA | B=A, native unobserved A-X-A | Same output as unchanged, limitation explicit |
| Cloud successor | Second token references pending first | Second desire, causal-successor reason |
| Stale cloud peer | Two accepted old-base titles | Higher ordinal, conflict reason |
| Cloud no-op peer | Real title desired X, stale caller submits B | No-op cannot supersede X |
| Offline retained base | B old, native X, cloud Y | Y, retained-base conflict |
| Missing old base | Unresolvable token, cloud Y | Draft retained, no accepted setter |
| Native Trash plus title | In Trash, cloud title Y | Unavailable, no setter or restore |
| Cloud Trash plus edit | Native title/status changed | Public move, archive observed edits |
| New cloud Trash | Older queued title remains | Title suppressed, move only |
| Failed Trash | Missing native target | Unavailable, never claim satisfied deletion |
| Confirmed then native edit | Applied C, confirm C, observe X | X, retired C never replayed |
| Post-write mismatch | Applied C, later fenced snapshot X | Separate divergence disposition, preserve X |
| Stale snapshot | Sequence below committed sequence | Reject, no overlay retirement |
| Duplicate hint | Already acknowledged ordinal | No new scan or decision |
| Crash after setter | Readback equals chosen C | Satisfied verification, exact receipt replay |
| Crash with later edit | Readback differs from before and chosen | Uncertain, no setter |
| Crash before setter | Ownership unchanged, durable phase pre-invocation | Fresh attempt decision then write |
| Interrupted Trash | Outside Trash after ambiguous invocation | Uncertain, no repeated move |
| Superseded recovery | Desired ordinal changed | No old setter, preserve newer overlay |
| Read/set race | Inject native change after read | Record possible lost-edit boundary, no false CAS guarantee |
| Consent/unsupported | Denied read or unsupported cell | No write, explicit outcome |

Fixtures should inject crashes before and after journal persistence, setter invocation, receipt persistence, acknowledgment and confirmation commit. They should exercise D1 retry/id reuse, owner FIFO retries, claimed-operation supersession and removal guards. Use fake public adapters for deterministic tests. Live Things verification remains separately authorized and must include the supported user paths before rollout is declared complete.
