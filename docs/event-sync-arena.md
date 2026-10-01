# Event-driven sync arena and swarm

October 1, 2026. User requested all candidates, judge and implementation workers on Sol medium. Three independent candidates and one read-only cross-judge inspected the same existing implementation. Model diversity was intentionally reduced. Agreement is a design signal; behavioral tests and live measurements must establish the result.

## Arena decision

The parent read all designs and rationales end to end. Both parent and judge selected candidate 1 as the simpler base. The judge scored each candidate 20/25 overall, with different strengths. The rubric covered idle efficiency, reliability, local correctness, maintainability and verification.

All candidates converged on bulk public Things reads, queue-first application, a hibernating WebSocket and debounced filesystem invalidation. None proposed multithreading per-property Apple Events as the main fix. The previous bulk enumeration measurement did not establish complete reader parity.

The Laziness Protocol shaped retention of the existing D1 operation queue and omission of a second notification outbox. Model the Domain shaped separation of desired cloud fields from confirmed Things observations.

## Synthesis

| Source | Accepted contribution |
| --- | --- |
| Candidate 1 | Existing queue as authority, durable coordinator intent journal, causal snapshot sequence fence, complete overlays independent of execution batch limits. |
| Candidate 2 | Separate small overlay metadata table, idempotent interrupted-setter recovery, installed-agent cutover gate, distinct latency measurements. |
| Candidate 3 | Retained dirty generations, explicit queue drain with blocked-claim escape, exact persisted upload replay, permission and signing checks. |
| Cross-judge | FIFO enqueue acceptance, atomic committed watermark retention, immutable receipt fences, Trash membership before repeat, same-content causal confirmation uploads. |

Rejected alternatives: a new general task database, a second D1 notification outbox, best-effort post-commit broadcasts, periodic idle reconciliation, and weakening the complete-inventory coverage guard. APNs is deferred because it adds provisioning and does not guarantee background delivery. SSE lacks the selected Durable Object hibernation mechanism.

An unresolved older enqueue cannot be retried after a newer enqueue and thereby acquire newer precedence. The coordinator must serialize durable intents. Committed notification revision and intent removal must be atomic. Outstanding enqueue recovery continues while the Mac is offline, while settled delivery retries stop without connected clients.

The immutable operation journal retains historical policy and terminal receipts. Mutable overlay metadata is separate because the existing final-receipt trigger forbids every update on terminal operation rows. Retirement requires the matching operation receipt, a snapshot sequence after application, a sufficient captured cloud revision and the actual matching public value. An old saved snapshot cannot erase pending cloud intent.

## Swarm ownership and verification

Three Sol medium workers implement separate slices in isolated worktrees: Cloudflare queue/notifier/schema, native scheduler/connection/watcher/writer, and bulk public inventory reader. The parent integrates and reviews every diff. No worker deploys or installs independently. There were no arena dropouts.

Done requires meaningful recovery and parity tests, integrated builds, safe additive migration and deployment, installed-app verification, measured full-reader speed, observed cloud and local event paths, and a healthy idle interval without periodic queue reads or inventory scans. Sleeping-Mac and iPhone delivery remain separate claims requiring direct observation. Permission denial must remain visible and cannot be bypassed.

## Integrated verification and rollout

The additive D1 migration and owner Durable Object notifier are deployed to the existing Worker. Cloud-wins was enabled after installing the compatible signed Mac app. Active Worker version: `7b42969e-8cd4-4cef-a90e-9ac76b2845dc`. Existing OAuth app, owner and native identity are retained.

The app uses an existing Apple Development identity and an ignored local signing fingerprint for repeatable updates. The owner approved Always Allow in Keychain. Background reads fail quietly on denial. This is not a notarized Developer ID release. A local private app/journal checkpoint exists. The optional remote D1 export was denied by the current credential; no alternate credential extraction or export bypass was attempted.

Integrated checks passed: 22 Swift tests, 8 native writer tests, bulk reader synthetic fixtures, 36 cloud tests across read transport, OAuth, native queue and event fault recovery, typecheck, signed release build and strict signature verification. The live canonical parity measurement covered 55 records including 45 task/project records: 1.782 seconds versus old scans of 14.948 and 14.928 seconds.

Live verification established automatic local-to-cloud invalidation, cloud-to-Mac title application, offline agent catch-up, competing same-field cloud priority, preservation of unrelated notes and task completion. One title operation's durable applied receipt followed queue acceptance by 0.643 seconds; the matching confirmed snapshot followed by about two seconds. The disposable task automatically reached the cloud about four seconds after local creation. These are individual observations, not percentile guarantees.

Live verification caught a binary/text acknowledgement mismatch and added an actual frame-type regression test. The updated connection remains open. Completed-task Trash verification is being investigated before closing the rollout. Physical Mac sleep/wake and iPhone propagation have not been observed in this run.
