# Independent cross-judgment

Read-only judgment, October 1, 2026. All three candidates' design and rationale files were read end to end. NativeQueue, SyncEngine, the fixed native writer, MCP effective overlays, MirrorStore snapshot commit, and the native SQL migration were inspected. No repository edits, credentials, task mutation, or deployed work were performed. All candidates and this judge use Sol medium as requested. This reduces model diversity, so agreement is not an independent cross-model validation.

## Scores

Scores assess the submitted design, not an implemented result. Five means especially strong coverage. Four means sound direction with a material implementation detail or live gate remaining. Three means a correctness gap needs a specific repair.

| Criterion | Candidate 1 | Candidate 2 | Candidate 3 |
| --- | ---: | ---: | ---: |
| Idle efficiency | 5 | 5 | 5 |
| Reliability | 3 | 4 | 4 |
| Local correctness | 4 | 4 | 4 |
| Simplicity | 4 | 3 | 3 |
| Verification | 4 | 4 | 4 |
| Total | 20/25 | 20/25 | 20/25 |

Candidate 1 earns the simplicity tie-break and is the recommended architecture base, subject to the required grafts below. Candidate 2 supplies the clearest recovery and cutover details. Candidate 3 supplies the best dirty-generation and blocked-claim scheduling details. None is implementation-ready unchanged.

## Reasons for the scores

All candidates correctly move full inventory off the immediate cloud-write path, replace idle queue polling with a hibernating socket, retain reconnect catch-up, coalesce public automation, and avoid private database parsing. All acknowledge that the bulk probe has not proved canonical parity or finished latency. Local watcher correctness and permissions remain real-device gates, so local correctness does not receive five.

Candidate 1 gives the strongest explicit temporal fence and the smallest durable notification arrangement. It specifically handles finite automatic alarm retries. Its reliability score is lower because uncertain mismatches can remain permanently blocked under the no-blind-repeat rule. That preserves evidence but does not fully meet automatic reconnect convergence for idempotent title and completion edits. Its proposed mutable columns on terminal operation rows also collide with the actual immutable-final trigger.

Candidate 2 gives a useful separate desired-field fence, explicit interrupted-write convergence, exact pending-upload replay, a concrete healthy-idle measurement, and compatibility-gated cloud-wins acceptance. The additional D1 notification outbox does not earn its complexity if every enqueue passes through the DO intent journal. Its snapshot fence needs an explicit post-application sequence condition. Its instruction to preserve optimistic cloud-writer checks needs a defined cloud revision contract, because the existing base_revision is an observed Things field revision.

Candidate 3 provides retained dirty generations, paused-event handling, orphan-claim escape, explicit canonical conversion, and persistent watcher cursor advancement after snapshot success. It retains an unnecessary notification outbox. Its native scheduler replays a pending upload before fresh operations, which can place an old snapshot upload failure on the critical cloud-write path. Its reconciliation-operation proposal needs a deterministic revision-scoped claim contract so old uncertain intent cannot overwrite a newer accepted request.

All verification scores stop at four because these are test plans with explicit limitations. No candidate proved the live watcher, finished bulk reader, socket idle behavior, or installed signing continuity.

## Candidate 1 notification design is correct with explicit invariants

A D1 notification outbox is not intrinsically necessary. A durable DO intent persisted before the D1 request can bridge the two stores. If a crash occurs after D1 commit, the intent survives and an exact idempotent replay discovers the committed operation. After that replay, a transaction must durably raise the DO notification high watermark and delete the resolved intent together. Deleting the intent after merely broadcasting is incorrect. Retain the high watermark until the Mac's durable-fetch acknowledgment, even when sockets disappear.

This proof depends on every cloud enqueue using the coordinator. A bypass queue mutation would break the handoff. Rejected enqueue requests must not delete an intent while a previous D1 call still has an ambiguous outcome. A missing early readback does not prove non-commit. Reconnect must register the socket before taking the catch-up watermark, then drain to a defined queue snapshot while retaining any newer hint.

Use one alarm schedule for both pending enqueue resolution and delivery retry. Stopping delivery alarms when disconnected must not cancel unresolved enqueue recovery. Bound connected notification retries and close an unhealthy socket. Persist pending work and rearm enqueue recovery after failures. Cloudflare documents only six automatic alarm retries, so candidate 1's explicit rearming is a necessary graft into any selected implementation. [Cloudflare alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

Cloudflare's documented hibernation mechanism supports this transport choice. Constructor reentry means connection attachments and durable state must reconstruct the protocol. This is an architectural inference, not a measurement of this app's power use. [Cloudflare WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## Mandatory ordering repair across all three candidates

Stable operation IDs prevent duplicate insertion. They do not preserve acceptance order when an unresolved older DO intent is replayed after a newer request commits. The current queue assigns ordinal at D1 insertion. Consider A accepted into the DO journal, its D1 result ambiguous, B accepted and committed, then A inserted on retry. A receives the larger ordinal and incorrectly supersedes B. The latest accepted cloud edit would lose.

Choose and test one concrete rule before coding. The smallest rule is to process a durable FIFO of owner enqueue intents in acceptance order and not advance past an unresolved head. D1 ordinal then follows acceptance order. Record immutable request payload and hash before issuing the first D1 call. Keep new requests durably queued behind the head and expose pending acceptance rather than pretending they already committed. This trades temporary enqueue throughput for simpler ordering.

If head blocking is unacceptable, allocate an owner acceptance revision durably in the DO and store it in D1. Retried A keeps its original revision. Desired-field replacement and supersession must compare that revision, not insertion ordinal. A retry must never refresh its acceptance revision or overwrite newer desired state. This variant is more code but permits later requests to settle while an older result is unknown. Do not invent an untested hybrid.

Whichever rule is selected, use monotonic max for notification watermark. Test delayed old commit, early absent readback, D1 response loss, same ID with changed content, and B executing before A recovery. A D1 outbox does not solve this acceptance-order problem.

## Required grafts for the chosen base

1. Keep candidate 1's DO intent journal and durable notification watermark. Omit a D1 notification outbox while the all-enqueues-through-DO invariant holds.
2. Use candidate 2's small separate native_desired_fields table for mutable active intent and verification fences. Keep existing native_operations immutable once terminal. The actual native_immutable_final trigger blocks every UPDATE on terminal rows, not only receipt mutation. A trigger migration could whitelist overlay columns, but a separate bounded per-field table is easier to audit and preserves the current receipt boundary. This is a justified simplification correction to candidate 1.
3. Keep candidate 1's application sequence fence. Capture the latest allocated snapshot sequence before the setter or satisfied target check. A retiring snapshot must have sequence greater than that fence, a basis cloud revision at least the field's desired revision, a verified matching field, and an applied or satisfied result for that exact desired revision. Check and retire in the snapshot commit transaction. Never regenerate persisted pendingUpload bytes on retry.
4. Graft candidate 2's read-before-repeat recovery for versioned idempotent title and completion setters under the existing retained claim. Check that no newer desired revision invalidates recovery. A newer executing request must not have its claim stolen. Keep unavailable targets visibly unresolved. For Trash, inspect public Trash membership before resolving a non-Trash object or repeating app.delete. Do not assume the deletion command is an idempotent setter. An already-present Trash ID is satisfied; ambiguous unavailable membership needs explicit blocked recovery or a new revision-scoped reconciliation operation.
5. Graft candidate 3's dirty generation counters, paused-event retention, cursor advancement after successful associated snapshot, and orphan executing-claim escape. Queue paging needs a cursor or blocked-target exclusion. Repeatedly requesting the same first twenty executing rows must not starve later queued work or spin forever.
6. Use candidate 1's queue-first ordering for new cloud target writes. Exact pendingUpload replay remains required, but unrelated snapshot upload retries must not indefinitely block application of fetched cloud work. Receipt recovery and claims remain ordered. Sequence compatibility and causal fences make deferred old snapshot upload safe.
7. Graft candidate 2's installed-agent readiness gate, old-policy payload preservation, consent text changes, and measured healthy-idle test. Keep candidate 3's verification of signing and Keychain continuity. Do not enable v2 acceptance merely because additive deployment succeeded.

## Temporal fence adversarial cases

The existing MirrorStore uses immutable upload manifests, strictly advancing sequences, and transaction guards against racing older commits. Those mechanisms protect snapshot order. They do not establish whether a snapshot began before or after a setter. Cloud basis alone states what the reader knew, not when the writer ran.

The proposed contract at `/tmp/arena-lifeos/contract.md` fixes the main architecture gaps. Its separate overlay table, FIFO acceptance, sequence fence, captured manifest revision, and no-outbox choice are sufficient as a foundation. Ack audit and fence metadata must be immutable per operation after first persistence, even though kept outside the original result. A retry must check equality rather than raising an existing fence or changing its audit facts.

A cached upload can have a current cloud watermark and still have been read before application. It must not retire a fence just because its upload arrives after the receipt. Candidate 1's greater-than-application sequence condition closes that gap under one serialized native automation owner. Candidate 2 requires this graft. Candidate 3 states post-application confirmation but needs this encoded condition.

Also test a newer accepted cloud edit racing the snapshot transaction, a Things edit between two reader passes, a Things edit after setter verification but before upload, and two desired revisions for the same field. Effective overlays select the newest active desired revision independent of the twenty-operation execution batch and hundred-operation history view. Clearing an older fence must never clear a newer revision's fence. Snapshot hash deduplication must still permit a same-content confirmation upload when a desired fence needs a new sequence.

## Rejections and limits

Reject transport-only changes, routine idle inventories, best-effort post-commit broadcasts, a second full authoritative task database, and blind repeat of destructive automation. Reject weakening the v2 reader coverage gate to make the bulk probe appear complete. Reject changing terminal original receipts into new outcomes.

FSEvents remains a hint tied to an unsupported storage layout. Two public passes and canonical hashes establish observation correctness, not a supported Things change subscription. The final implementation must prove complete collection coverage and real local edit events, denied permissions, directory replacement, wake, timezone change, and midnight. Report sleeping/offline delay explicitly. The throughput checkpoint is not applicable to this read-only judgment. Implementation, deployment, and latency claims remain unverified.
