# Parent assessment

Read all three designs and all three rationales end to end. Checked actual queue, snapshot commit, native cycle, fixed writer and baseline tests.

| Candidate | Idle efficiency | Reliability | Local correctness | Simplicity | Verification | Total |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 | 4 | 4 | 5 | 4 | 21 |
| 2 | 4 | 4 | 4 | 3 | 5 | 20 |
| 3 | 4 | 5 | 4 | 3 | 5 | 21 |

Candidate 1 is the preferred base for minimal storage and straightforward boundaries. The three candidates converge on transport and bulk reader. Graft candidate 3's retained generations, explicit queue drain, exact pendingUpload recovery, and cutover gate. Graft candidate 2's complete per-page desired overlay and explicit latency stages. Keep overlay metadata separate from immutable native_operations because its existing final-receipt trigger forbids all updates after final state.

Reject a general authoritative task store and a second notification outbox if the DO durable intent plus committed revision can prove crash-safe publication. Require serialized enqueue acceptance: recovery of an older unresolved intent cannot make it newer than a later cloud edit. Preserve immutable old policy and uncertain receipts; do not automatically replay unverified Things mutation without an idempotence proof.

All candidates and judge use Sol medium by user instruction. Agreement does not establish independent model-family corroboration. Verification must come from implementation tests and live measurements.
