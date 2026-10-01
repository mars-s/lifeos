# Smart merge cross-judgment

Read-only design review, October 1, 2026. Both design and rationale pairs and the rubric were read completely. No source, live application, credentials, or deployment changes were made. Scores assess designs, not tested implementations. All participants used Sol medium; the unavailable third candidate and shared model reduce diversity.

Recommend candidate 2 as the base, with mandatory corrections below. Neither proposal is ready to implement unchanged.

| Criterion | Candidate 1 | Candidate 2 |
| --- | ---: | ---: |
| Compatible edits and explicit conflict resolution | 3 | 3 |
| Causal correctness, crashes, ABA, immutable history | 3 | 4 |
| Things APIs, boundaries, honest limits | 4 | 4 |
| Simplicity, migration, event-driven runtime | 3 | 4 |
| Predictable UX and adversarial verification | 3 | 3 |
| Total | 16/25 | 18/25 |

## Decisive findings

Both repair the important base-provenance defect: today's newest mirror value cannot stand in for what a stale caller read. Owner-bound retained tokens, immutable embedded bases, effective-head provenance, pinned accepted work, and versioned policy are sound. Both preserve independent fields, whole-string titles, recoverable Trash, legacy payload semantics, and the event-driven runtime. Neither promises an unavailable Things operation log or atomic compare-and-set.

Both incorrectly infer that C equals B means the user requested no change. Current MCP operations are explicit owner-requested commands. “Mark completed” can intentionally reaffirm completion when a stale mirror says completed but Things has since reopened. Silently preserving open would ignore the command. Add an immutable `intent_kind`: `explicit_set` versus `derived_patch`. C equals B is a no-op only for a derived patch or explicitly empty diff. An explicit setter remains a desired operation; L equals C still permits safe satisfied verification. Do not infer this distinction from content equality. This correction applies before overlay installation and supersession.

Candidate 2 has the safer crash rule. Once invocation may have begun, a differing current value produces uncertainty and no setter. Candidate 1 permits replay when current equals observed-before. Counterexample: before A, setter successfully writes C, Things changes C back to A, process crashes before durable receipt. Replay writes C and erases a post-application edit. Equality cannot distinguish that case from a setter that never ran. Candidate 1 acknowledges weak evidence, but admitting a risk does not preserve the edit. Its matrix also omits this exact observed-before return. Use candidate 2's verification-only ambiguous recovery for all supported fields. Replaying a persisted receipt remains safe and separate from repeating automation.

Both correctly distinguish recorded ABA from hidden ABA. Neither can recover A to X to A occurring entirely between observations. Field revisions, head tokens, snapshot sequences, and cloud ordinals describe retained observation/order evidence, not complete user action causality or proof that a human saw the displayed state. Candidate 1's per-transition ledger offers richer audit, but candidate 2's retained bases and field heads are the smaller foundation. Add a transition ledger only if concrete audit or token-resolution requirements cannot be met otherwise.

## Required grafts and contract decisions

1. Add explicit intent kind and tests for intentional reaffirmation, empty derived patches, stale no-op patches beside real desired edits, and an explicit set based on a pending overlay. Freeze intent kind in the request hash and operation payload.
2. Keep candidate 2's conservative interrupted-write recovery. Test successful setter followed by return to observed-before, a third value, hidden ABA, newer cloud head, and lost receipt acknowledgment. No ambiguous recovery may issue a new setter. A deliberate retry is a new authorized operation with a fresh basis.
3. Graft candidate 1's append-only post-write divergence disposition. Candidate 2 can otherwise leave a verified operation's mismatching overlay pending indefinitely when matching confirmation was missed. After a demonstrably post-write observation, preserve the observed divergence and move the old desire to review through an identity/ordinal-guarded disposition. Do not claim this proves newer human intent. Never rewrite an applied receipt or clear a successor's overlay.
4. Specify the post-write observation basis explicitly. Require snapshot sequence greater than the native application fence plus the exact operation/receipt association and captured cloud basis. A watermark alone is insufficient. Old durable upload bytes cannot confirm or cancel a later operation. Define the bounded association schema before coding.
5. Define Trash evidence as the canonical public fields actually covered, including unknown states and positive complete membership. Candidate 2's “complete public-item fingerprint” must not imply private-property coverage, and a cached pre-operation fingerprint cannot substitute for fresh target evidence. Bound the target read; record unsupported/unavailable coverage. Missing is never satisfied Trash. Interrupted Trash remains membership verification only. Preserve the proven fixed public AppleScript move path and resource/signing checks.
6. Enforce desired-head/claim checks before first execution and recovery, and audit a newer head arriving during the setter. This reduces obsolete writes but cannot atomically fence Things. Test both race windows without claiming linearizability or preservation of every unobserved edit.

Exceptional UX needs a definite pending/confirmed/review disposition and a successor that can clear review display without changing old receipts. Ordinary same-field conflicts remain automatic cloud fallback, with alternatives retained. Unknown bases, unreadable required cells, and ambiguous external execution require explicit uncertainty rather than fabricated causality.

Before rollout, verify the actual queue, immutable journal, receipt validator, overlay transaction, and public automation boundaries together. The designs' scenario matrices are useful specifications; they are not evidence of passing tests or live correctness.
