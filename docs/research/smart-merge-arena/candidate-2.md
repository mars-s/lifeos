# Merge observed changes and keep Cloudflare as the conflict fallback

LifeOS should preserve changes to different fields, accept changes that are demonstrably newer, and use the existing cloud preference only when two changes compete. The rule must use recorded evidence. It must not guess what a task title means or ask an LLM to infer intent.

For example, a cloud title edit and a Things completion can both survive. Two competing title edits produce the cloud title, with the displaced Things title available in the operation history. A Things title change observed after confirmed application becomes the new observed title. LifeOS must not keep forcing an old cloud value forever.

This design adds a versioned merge contract to the current queue. It keeps the owner Durable Object FIFO, immutable D1 operations and receipts, separate desired overlay, serial native executor, public Things automation, and event-driven scheduler. It adds no supported task fields.

## Evidence and the missing base

`native-queue.ts` currently prepares a base from the freshest mirror cell. For `cloud_wins`, the commit guard ignores the caller's revision. A caller who saw title A can submit C after the mirror reached B. The operation records B as its base even though the caller never saw B. That prevents a correct three-way merge.

`native-write.js` reads the current title or status, then sets the desired value unconditionally for version 2. The source still contains a delete branch, but the deployed Trash path uses the fixed `native-trash.applescript`. `SyncCore.swift` journals writing before automation, verifies claim ownership on recovery, and checks current desired revision. `mirror-store.ts` retires overlays only after a matching receipt and a sufficiently new matching snapshot. Those safeguards remain mandatory.

A snapshot is an observation of Things. It is not a log of user actions. ThingsCloud can change that observation from another device. Neither upload arrival order nor `seen_cloud_revision` proves that a person saw a cloud edit before editing on an iPhone.

## Record the value each caller actually read

Every editable read returns a `basis_token` for the rendered field value. The token resolves to an immutable retained record containing owner, target, kind, field, typed cell, observed field revision, observed snapshot sequence, desired operation head, policy epoch, and target availability generation. Record whether the rendered value came from the confirmed mirror or a pending desired overlay. The base value must be exactly the rendered value.

Use an opaque random identifier referencing D1, not an unsigned client assertion. Return the same token while the read basis is unchanged. A caller submits the token with an operation ID and desired value. The server validates owner, target, field, and typed value against the retained record. It never replaces the submitted base with a fresher mirror value.

Retain basis records for 90 days. Pin records referenced by durable accepted intents, active operations, and unresolved receipts until they settle. Accepted operations embed the complete base, so subsequent basis expiry cannot change replay. This defines supported offline editing for 90 days. A caller returning after expiry gets `base_expired` and a refresh response. LifeOS must not automatically rebase the submitted edit on the refresh, since that invents an observed base. Repeating the edit after seeing the refreshed value is a new operation.

Use a distinct effective field head rather than overloading the mirror field revision. It records the current desired operation, confirmed observation revision, and policy epoch. This separates queue order from confirmed Things state. Include a target generation so an edit cannot attach to a missing, trashed, or replaced target.

## Causal evidence takes precedence over value comparison

There are three evidence classes.

1. A cloud operation that names the current effective field head is a successor to that head. It is authorized to replace the value its caller saw, even if the prior operation has not reached the Mac yet.
2. A new accepted Things observation after a confirmed native write is an observed successor. Require a receipt, a post-write matching observation, and then a later observation with a different value. This proves local state evolution after confirmation. It does not prove which device or person produced it, or that its author knew the cloud value.
3. A cloud operation on an old head and a differing current observation or desired head is concurrent or of unknown causal order. Preserve that distinction in audit metadata. Arrival time is insufficient to label it causally newer.

The system can automatically accept class 2 because the old operation is complete and retired. It must not describe that as proof of newer user intent. A differing snapshot before any matching confirmation cannot retire the overlay. A fresh direct public read is merge evidence, but not evidence that the reader's value was authored after the operation.

For cloud versus cloud, a base that references the current pending operation establishes succession. Two edits based on the same older head compete. FIFO acceptance order chooses the later accepted cloud edit, as today. Preserve both operations and record whether selection was succession or a cloud conflict fallback.

## Deterministic merge function

For one supported field, let B be the actual caller base, L be the freshest valid public Things value read before execution, and C be the submitted desired value. Also supply recorded heads, base provenance, target availability, and current desired revision. Compare complete typed values without whitespace normalization or title interpretation.

Apply these rules in order.

1. Unknown, absent, or unsupported required cells block automatic mutation. Missing or trashed targets skip title and completion. No rule recreates a task or restores it from Trash.
2. An operation that no longer owns the desired field head is superseded. A claim mismatch blocks execution. These checks outrank every value comparison.
3. If C equals B, the request makes no change relative to the caller's view. Record `satisfied` with reason `no_change_requested`, preserve L, and do not install a desired overlay. This also applies when an old cloud head has advanced. It prevents an old no-op request from resetting a newer title.
4. If L equals C, record `satisfied` and verify confirmation through the existing causal fence. No setter runs. Different histories may still be recorded as same-value convergence.
5. If evidence proves C succeeds the current head, use C. If an old operation has already been confirmed and retired, later Things observations simply update the mirror. The old operation is never revived.
6. If L equals B and no recorded intervening same-field head exists, use C. Only the cloud side visibly changed.
7. If L differs from B and C differs from B, or recorded same-field heads changed despite equal values, record competing or unknown-order changes. For title and supported completion, choose C under `cloud_fallback_v1`. Store B, L, C, and the exact reason before automation.

Rule 6 does not claim that equality proves an untouched history. An observed A to B to A sequence increments the observed revision twice and enters rule 7. An A to B to A cycle that happens between scans is invisible. The result may be the same value, but the audit must not claim no competing edit was possible.

An operation competes only with changes to its field. Target disappearance and Trash affect availability across fields. Title and completion otherwise have independent heads. A concurrent new cloud title must not suppress a completion operation, and neither operation writes notes or other unrelated cells.

## Titles, completion, and Trash

Treat title as a whole string in the first release. B="Buy milk", L="Buy oat milk", and C="Buy milk today" produce C under cloud fallback. A word-level merge could produce an unintended instruction. Store L in the receipt audit so the user can copy it or submit a new title operation if desired. No automatic text merge ships.

Completion remains the existing command to set a to-do to `completed`. Do not add reopening, cancellation, or project completion. B=open, L=open, C=completed applies. B=open, L=completed, C=completed is satisfied. B=completed, C=completed is a no-op even if a later local observation is open. The system must not treat completion as an irreversible monotone CRDT, since users can reopen in Things. If a competing local supported status differs from B, the existing cloud preference resolves to completed. Unsupported or unknown status states do not permit a setter.

Trash is an explicit authorized recoverable move, not inference from absence. A valid pending Trash request dominates concurrent title and completion edits because those cannot operate on a trashed target. Record the displaced supported field values in the deletion audit. Cloud title requests queued behind a Trash head are skipped. Title requests on another task continue normally.

For Trash, the read basis includes the target generation and a complete public-item fingerprint. A fingerprint change detects delete/edit competition, even when `in_trash_list` stayed false. Do not claim it detects changes to unavailable properties or missed ABA cycles. A current true Trash membership is satisfied. A missing target is unavailable. An explicit Trash operation with a changed live target may still move it to recoverable Trash under the cloud fallback, with `delete_edit_cloud_fallback` in its audit. This keeps the previously authorized automatic resolution preference. It must never invoke permanent deletion, restoration, or creation.

A title observed before cloud Trash acceptance and another title observed before execution are concurrent or unknown-order competitors. A title operation submitted with an already trashed basis is rejected. If Things later restores the item through its own UI, LifeOS observes that restoration after the Trash overlay has retired. It does not rerun the completed Trash operation.

## Preparation, execution, and recovery

The Durable Object persists the exact request, basis, policy version, and FIFO position before attempting D1. Preparation freezes the immutable operation payload. Replay cannot use current policy or a new base. D1 enqueue atomically installs a desired head, supersedes older unclaimed same-field operations, and records its acceptance result. Do not supersede an existing head for `no_change_requested`.

The native executor follows this sequence.

1. Fetch the typed operation and current desired revision. Persist the claim and immutable payload before automation. Recheck claim ownership and desired revision immediately before every first execution or recovery execution, not just interrupted executions.
2. Read the current public supported cell and availability. Run the pure merge function. Persist the decision, observed-before value, base provenance, and pre-write snapshot sequence in the native journal before invoking a setter.
3. Run the fixed title setter, completion setter, or Trash source script. Read the resulting public value. Persist the full receipt locally before sending it to D1.
4. Replay the identical persisted receipt on network failure. A later matching complete snapshot retires only the overlay owned by that operation. A receipt or snapshot from an older operation cannot retire a newer head.

Check the desired head again after automation. If a newer head arrived during the setter, the old receipt truthfully records its side effect and `superseded_during_apply`. It must not install or restore its overlay. Drain the newer operation immediately. FIFO ordering and the native serial executor limit the correction to a finite queue catch-up. A fetch before a setter cannot guarantee that no new head will arrive during it.

If a crash occurs before automation starts, rerun the guarded merge. If a crash occurs in `writing`, first verify ownership and the current head. If L equals the persisted chosen result, acknowledge satisfied without a setter. If L differs, do not blindly replay a title or completion chosen before the crash. The agent cannot tell whether the setter never ran or ran and a later Things edit followed. Finish with an immutable `uncertain/interrupted_write` receipt, preserve the observed value, and expose one review item. This deliberately narrows today's version 2 replay behavior for smart operations. An explicit retry creates a new operation with a fresh observed basis.

Trash recovery remains verification-only. True membership is satisfied. False membership after interrupted execution produces `uncertain/interrupted_delete`. Do not run the move again. Uncertain operations release the execution slot after durable acknowledgement but retain a visible diagnostic record. Their overlays must become review state rather than indefinitely displaying the desired value as confirmed. A successor operation can clear the review display without modifying the old receipt.

## Snapshot and notification handling

Keep existing complete-coverage validation, monotonic snapshot sequences, durable exact upload replay, native identity checks, and receipt fences. Two-pass inventory comparison detects many races but is not atomic with a setter. A WebSocket message wakes reconciliation. Its revision is a hint, never the data source or a causal proof. Use max-revision acknowledgement and catch-up on connection, startup, wake, and filesystem invalidation. Add no idle timer or periodic task reads.

A snapshot captured before a write cannot confirm or cancel it, even if uploaded later. A snapshot whose cloud watermark covers an operation cannot confirm it unless the per-operation receipt, sequence fence, and actual field value match. A later divergent snapshot before matching confirmation keeps the overlay pending and reports a verification conflict. Do not automatically create another setter from snapshot mismatch. This avoids a feedback loop between ThingsCloud and the desired overlay.

If native confirmation observes C and the next accepted observation is L, retire the completed operation and display L. Do not silently resurrect the desired value from historical queue data. If matching confirmation was missed, report uncertainty instead of pretending to know the local action's order.

## Additive schema and migration

Introduce policy `smart_merge_v1` with payload version 3. The request contains operation ID, target, field, desired value, and basis token. The immutable payload embeds the basis record, accepted effective head, supported target fingerprint for Trash, policy version, and cloud fallback. Include these in the canonical request fingerprint. Receipt audit adds decision reason, chosen value, observed-before, verified-after, merge evidence class, execution phase, and superseded-during-apply metadata. Extend validation with a bounded typed schema rather than accepting arbitrary audit JSON.

Add `native_read_bases` and a small `native_field_heads` table. Add an immutable merge-audit record if current receipt triggers prevent extending an existing terminal row. Keep `native_desired_fields` as the rendering overlay. Its entries gain policy and display state without changing historical operation rows. Index basis expiry, owner/target/field heads, and operation-to-basis references.

Version 1 `things_wins` operations and version 2 `cloud_wins` operations finish under their original semantics. Do not reinterpret their bases as actual caller observations. Do not alter immutable legacy receipts. Old clients continue version 2 only while explicitly supported by the compatibility gate. Smart merge is enabled only after the installed native agent advertises version 3 and all writable callers can supply read bases. A client without a valid base gets a clear refresh error, not a fabricated base.

Stage schema and token reads first. Run the pure merge reducer and recovery fixtures next. Enable the new native writer in shadow-decision mode with no extra mutations. Compare reason counts against existing operation inputs. After authorized deployment and installed-agent verification, enable version 3 for new operations. The design itself authorizes no deployment or live task tests. A rollback disables new version 3 enqueue while installed capable agents finish already accepted immutable version 3 work. It must not reinterpret or discard queued operations.

## Verification matrix

Use a fake public Things adapter and the real queue, journal, overlay, and snapshot boundaries. Each row asserts the final observed value, overlay ownership, receipt reason, setter count, and immutable history. Fault injection runs at every persistence and acknowledgement boundary.

| Scenario | Expected result |
| --- | --- |
| B=A, L=A, C=C, current head unchanged | One title setter to C, then fenced confirmation. |
| B=A, L=B, C=C, no causal proof | C wins, audit preserves B, competing or unknown-order reason. |
| B=A, L=B, C=A | No setter and no overlay replacement, preserve B as no change requested. |
| B=A, L=C, C=C | Zero setters, satisfied, confirmation still fenced. |
| Cloud title C, local status completed | Both survive, no unrelated field setter. |
| Cloud edit D explicitly bases on pending C | D succeeds C, older unclaimed C superseded. |
| Two cloud edits C and D base on A | Later FIFO accepted D wins, record cloud competition. |
| Confirm C, then accepted local title D | D displayed, historical C never reapplied. |
| Local D seen before confirmation of C | No causal-newer claim, overlay remains pending or review. |
| Observed A to B to A, cloud C bases on first A | Recorded revision detects competition despite equal L and B. |
| Hidden A to B to A between reads | No detection guarantee, never claim full edit-history coverage. |
| Old offline base retained, L=B, C=C | Resolve with frozen A base, cloud fallback and audit. |
| Offline token expired before acceptance | Reject with base_expired, zero setters, refresh required. |
| Completion base completed, local reopened, C=completed | No-op preserves reopened status. |
| Completion base open, local completed, C=completed | Satisfied without status setter. |
| Explicit cloud Trash competes with title edit | Recoverable Trash wins, title audit retained, no resurrection. |
| Title operation targets trashed or missing item | Skipped, no setter or task creation. |
| Trash membership already true | Satisfied, zero move calls. |
| Crash during Trash, membership false on restart | Uncertain, zero repeat move calls. |
| Crash during title, current differs from chosen result | Uncertain, zero blind replay setters. |
| Crash after local receipt persistence before D1 ack | Identical receipt replay, no setter. |
| New desired head arrives before first execution | Old op skipped, newer overlay survives. |
| New head arrives inside old setter | Old side effect audited, newer op drained, old overlay cannot return. |
| Stale snapshot uploaded after receipt | Cannot retire desired overlay. |
| Matching snapshot for old C arrives after new D | D overlay retained. |
| Repeated or out-of-order WebSocket hints | One catch-up to max revision, no idle polling. |
| Automation denied or cell unknown | No setter, durable visible failure or blocked state. |

## Cost and limits

Cloud reads add a small indexed basis lookup or insertion only for supported editable fields. Native application reads one supported cell and availability, plus Trash fingerprint evidence already in the event-driven snapshot. Keep bulk public inventory reads. Avoid rescanning all tasks for each operation. A dirty snapshot can be coalesced after the serial queue drains. Same-value and no-op requests avoid Apple Events setters.

The UI keeps automatic resolution and avoids routine prompts. Show pending, confirmed, automatically resolved, and needs review as separate states. A compact history entry shows the two titles and the chosen result. Recovering a displaced title means submitting another authorized edit with a fresh basis. No notification is needed for every ordinary merge. Permission denial, expired bases, and interrupted writes remain actionable.

Notes, tags, dates, and project assignment stay read-only. Future notes could use explicit three-way text merge only after defining overlap behavior. Tags would need stable element identities and observed-remove semantics. Dates need timezone and unset rules. Project moves need target identity and hierarchy validation. None are inferred from current title/status/Trash operations.

Without Things compare-and-set, the read and setter have a race window. A local edit can occur between them and be overwritten without appearing in the audit. Without a change feed, unseen ABA cycles and remote author intent remain unknowable. This design guarantees deterministic decisions from retained evidence, safe immutable replay, and no automatic resurrection. It cannot guarantee preservation of every unobserved Things edit or exactly-once external setters. Verification failures become uncertainty rather than an invented causal history.
