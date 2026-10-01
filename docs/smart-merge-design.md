# Smart merge design

October 1, 2026. Proposed design only. The deployed version still uses version 2 cloud_wins. This document changes no live sync behavior.

## Recommended behavior

Use a deterministic three-way merge per supported field, with Cloudflare preference as the conflict fallback. Cloudflare remains the durable coordinator of accepted commands and decisions. A completed cloud command does not permanently lock that field against later Things edits.

Compare the exact value the caller saw (base), the fresh public Things value (local), and the explicitly requested value (desired). Preserve unrelated fields. Keep ordinary resolution automatic and retain conflicting alternatives for recovery. No task-level AI call, periodic polling, word splicing, clock-based winner selection or new task database is required.

| Situation | Proposed behavior |
| --- | --- |
| Mac changes title, dot completes task | Keep the title and complete the task. |
| Only dot changes the title | Apply dot's title. |
| Things already contains the requested title | Verify satisfied, no setter. |
| Both change the title from the same base | Use the full cloud title, retain the local alternative and reason. |
| An explicit command repeats the stale base value | Honor the command if Things differs. Repetition does not imply lack of intent. |
| An actual derived diff has no changed field | No new desire or supersession. Preserve existing work. |
| Things changes after cloud application was confirmed | Accept the subsequent observation. Never revive the completed command. |
| A task is positively in Trash or missing | Do not rename, complete, recreate or restore it. |
| Explicit recoverable Trash competes with edits | Trash preference, retain observed alternatives, use the existing public move. |
| External invocation may have run, but outcome now differs | Preserve current state and report uncertainty. Never blindly replay. |

Titles stay whole strings. For example, base “Buy milk”, local “Buy oat milk”, and desired “Buy milk today” do not establish that “Buy oat milk today” is what the user intended. The recoverable alternative is safer than inventing a combined instruction.

## Fix the base contract first

The current native queue reads the newest mirror cell in prepareEnqueue while retaining the caller's possibly older base_revision. For cloud_wins, insertion permits a revision mismatch. That behavior supports unconditional cloud preference, but the stored base may not be what the caller read. A smart merger must not use it as an authentic common ancestor.

Return an owner-bound opaque basis token with every editable displayed value. Resolve it to a retained immutable record: owner, target, kind, field, exact typed cell, observed field revision, snapshot sequence, availability generation, and any pending desired head that contributed to the display. A submitted unsigned base value is insufficient. Embed the resolved base and provenance in every accepted operation before its first external D1 mutation. Freeze policy and request hash with it.

Use one sparse retained basis table and a small effective-head record, reusing existing desired metadata where practical. Do not add a second history engine merely to model every possible local action. Retain observed revision differences, including recorded A to X to A, while admitting that a change and reversal entirely between scans are invisible.

An initial 90-day unreferenced basis window is a proposed storage setting, not an existing offline guarantee. Pin accepted durable work until resolved. An expired unaccepted base returns a refresh requirement without silently substituting the current value or discarding the desired text. Reading a pending overlay must return a token for that displayed value, not the older confirmed cell.

## Intent is a separate fact

Version 3 operations include immutable intent_kind. Current MCP setter and completion tools are explicit_set. A future operation generated from a state diff may be derived_patch. Do not infer intent_kind from value equality.

For explicit_set, desired equal to base can be an intentional reaffirmation or undo. If the live value differs, apply the ordinary guarded policy. For derived_patch, desired equal to base is an empty diff and must not create an overlay or supersede a real pending command. In either case, live equal to desired is satisfied without another setter. This distinction corrects a defect found in both arena proposals.

## Ordering and conflict rules

First check target availability, immutable payload, claim and current desired identity/ordinal. A superseded operation cannot set or recover. A new accepted cloud command based on the displayed pending head has evidence of succession. Two commands sharing an older base compete; existing owner FIFO acceptance decides the cloud fallback. Neither timestamps nor upload arrival prove human edit order.

Read fresh public target evidence before applying. If local and desired both differ from the authentic base, resolve the supported field to desired and retain base/local/desired in an immutable decision record. Use the same fallback when recorded heads changed despite equal values. If required cells are unknown or unsupported, do not invent values or execute a setter.

Cloud title and completion have separate desired heads. Trash is a target-level availability barrier: suppress pending edits behind an accepted Trash head and reject edit requests against an effective trashed state. Preserve unrelated targets and historical receipts. No permanent deletion or automatic resurrection is introduced.

For delete/edit classification, capture a bounded fresh public semantic vector for relevant supported fields and positive complete Trash membership. Exclude derived list membership, collection ordering, modification timestamps and unsupported fields from the conflict fingerprint. Those can change automatically and must not masquerade as user edits. Cached metadata alone cannot establish what the live target contains.

## Execution and uncertainty

Keep the existing serial native executor, durable pre-invocation journal, receipt-before-acknowledgement rule, exact upload replay, owner coordinator and event-driven scheduler. Persist a versioned merge decision before invocation. Check claim and desired ownership immediately before first execution and recovery. Audit a successor arriving during a setter, then drain the successor. This cannot atomically fence Things.

Before invocation, recovery can reread and recompute under the same immutable operation. Once the durable phase says invocation may have begun, recovery is verification-only for all version 3 setters. Matching desired state can produce a truthful satisfied observation. Any differing state produces uncertain with no repeated setter. A successful setter followed by a local return to the old value is indistinguishable from a setter that never ran. Replaying merely because the old value reappeared can erase the later edit.

A saved receipt is replayed exactly after acknowledgement loss. That is distinct from repeating automation. An intentional retry after uncertainty is a new explicit operation against a fresh basis. Preserve the existing strict interrupted-Trash behavior and the fixed source AppleScript move that keeps the app signature intact.

## Confirmation and review

Pending desired values are not confirmed Things state. Matching confirmation continues to require the exact operation receipt, a snapshot captured after application, sufficient captured cloud basis, and matching actual field value. Old upload bytes and ordinal watermarks alone cannot prove per-operation confirmation.

If a demonstrably post-write observation differs before matching confirmation, preserve it and move that specific old desire to a visible review disposition. Do not automatically declare it newer human intent, repeatedly set the old value, or leave a misleading desired overlay indefinitely. A guarded append-only reconciliation event records the disposition. Its operation identity and ordinal must match before changing the rendering metadata. An applied receipt remains immutable, and a successor's overlay cannot be removed.

Define the bounded per-operation receipt association in snapshot manifests before coding this transition. It must prove capture began after that durable receipt, not merely that a socket notification was acknowledged. A pre-write saved snapshot cannot trigger it. After a matched confirmed application, later accepted observations update the mirror normally.

Normal conflicts resolve silently. Activity history can expose the reason and retained alternative. Uncertainty, unreadable required values and expired bases remain exceptional review items. Resolving or replacing a review display is a new decision; it does not rewrite the original receipt.

## Migration and implementation order

1. Add authentic basis tokens and retained records. Verify stale callers and pending-overlay reads. Do not enable new merge behavior yet.
2. Introduce version 3 smart_merge_v1 with frozen intent_kind, basis, algorithm, cloud fallback and typed decision audit. Build the pure reducer and integration fault fixtures.
3. Add guarded first-write ownership checks, conservative recovery and per-operation confirmation/review dispositions. Keep the current public write capabilities only.
4. Enable new commands only after the installed agent advertises version 3 and tests pass. Version 1 and 2 operations finish under their original immutable contracts. Rollback stops new version 3 acceptance, not already accepted work.

The runtime stays event-driven. New evidence is indexed metadata and bounded target reads associated with actual work. No background queue poll, task-level inference service or full inventory scan per command is added. Notes, tags, dates, new projects and relationships require separate write contracts and merge designs later.

## Verification specification

Verify exact decision, setter count, overlay ownership, receipt immutability and preserved unrelated values for: cloud-only changes; equal desired state; independent fields; same-field conflicts; explicit reaffirmation; empty derived diff beside real pending work; pending-overlay successor; two old-base cloud peers; retained and expired offline bases; observed and hidden ABA; cancellation versus completion; Trash versus edit in both orders; missing targets; permission denial; unknown cells; duplicate hints; stale uploads; matching old confirmation behind a new head; and a successor arriving during invocation.

Fault-inject before and after decision persistence, invocation, receipt persistence, acknowledgement and snapshot commit. Especially test successful A-to-C followed by C-to-A and crash before receipt: recovery must perform zero setters. Test both pre-write and post-write divergent snapshots before any matching confirmation. No design result substitutes for passing the actual queue/journal/adapter integration tests and authorized disposable live tests before deployment.

Things' public interface provides no atomic compare-and-set in this adapter. A user or ThingsCloud can edit between read and setter, and unseen alternatives cannot be archived. This design improves decisions from observed evidence; it cannot guarantee perfect preservation of every external edit or exactly-once side effects.

## Sources

- [Automerge conflict semantics](https://automerge.org/docs/reference/documents/conflicts/): deterministic convergence still retains competing same-property values. A general CRDT cannot infer the intended title.
- [Things public AppleScript commands](https://culturedcode.com/things/support/articles/4562654/): supported public reads, writes and moves. The lack of an atomic adapter operation is a boundary assessment of these documented commands and the inspected implementation.
