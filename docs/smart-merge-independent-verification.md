# Independent smart sync verification

This slice adds synthetic tests only. It does not use live Things, credentials, deployed services or private application storage.

Run:

```sh
cd cloud-mirror/cloudflare
SMART_SOURCE_ROOT=/tmp/lifeos-smart-cloud/cloud-mirror/cloudflare node smart-test.mjs
cd ../../mac-sync
swift test
node --test Tests/native-write.test.mjs
```

Omit SMART_SOURCE_ROOT after integrating the cloud implementation into the same checkout. The fixture bundles the actual worker, OwnerSync, NativeQueue and MirrorStore into local Miniflare workerd, with real SQLite D1 and persistent Durable Object storage. Its own D1 wrapper injects response loss after a successful semantic commit. Each fault must be observed as consumed before the test can pass. Restart uses the same persistence folder and an independent Miniflare instance.

The cloud cases cover native authentication, item/meta feed commits, bounded cursor paging, frozen bootstrap during a concurrent commit, retained bases and recorded ABA, displayed pending basis tokens, explicit setters versus derived no-ops, legacy payloads, immutable receipts and audit fences, exact confirmation proofs, post-write review, successor protection, target-wide Trash barriers, typed interrupted audits, runnable command paging beyond twenty, all four mutation response-loss boundaries, and protocol 2/3 notification catch-up after restart.

The new Swift cases cover atomic replica cursor/projection/work updates, malformed page rollback, duplicate and own-feed events, staged bootstrap interruption and restart, canonical bootstrap validation, stale projection removal, preparation failure remaining retryable, supersession after preparation, durable decision before invocation, exact receipt retry after ACK loss, writing recovery using the verification-only marker, uncertain actions retaining attention, and bounded proof capture before inventory with exact snapshot retry. The existing JavaScript writer tests separately check that ambiguous smart recovery performs zero setters, including return to the original base value.

Independent failures found and fixed by the production owners:

- Confirmed-base triggers aborted changed snapshot commits under SQLite outer conflict rules.
- SQLite extracted false as numeric zero when constructing a confirmed Trash base.
- Bootstrap accepted invalid deleted markers and promoted malformed state.
- Completed bootstrap left stale projections from the previous replica.
- An older smart writing journal without a retained decision could produce an uncertain receipt that the strict cloud validator rejected after public verification failed. The native fix supplies a typed unknown observation and an interrupted classification, preserving the immutable base and desired value.

Limits: these fixtures do not prove macOS Automation permissions, AppleEvent timing, actual Things storage notifications, Keychain behavior, deployed Cloudflare limits, or hidden local ABA between observations. Fake automation validates the native orchestration marker and durable state, while the writer surrogate validates setter count. The cloud tests call a synthetic enqueue entry that uses the real owner coordinator, so rendered MCP basis-token presentation is outside this slice. No claim is made that a public Things setter can be atomically fenced against a simultaneous cloud command.

Final result: PASS on 2 October 2026, Melbourne time. Swift test passed all 40 cases (24 existing and 16 new). The real local workerd suite passed all 15 reported tests (14 cases plus its enclosing test). The existing writer surrogate passed 12 cases. JavaScript syntax and Git whitespace checks passed. The native source includes follow-ups through c0253e1. Cloud tests used the current production worker tree at /tmp/lifeos-smart-cloud, including its confirmed-base trigger, boolean and transport fixes. This report is synthetic verification, not deployment approval or a live application test.

The final Unicode regression accepts twenty distinct 4,000-character title commands, then checks that pending returns a nonempty ordered prefix of complete operations below 256 KiB. Every returned payload equals its full operation lookup. Confirmed, desired and effective bases retain only supported title/status/Trash fields, even when the source frame contains unrelated notes. A retained 4,001-character title base rejects before insertion into native_operations. The effective-frame fixture is seeded directly into synthetic D1 to verify acceptance pruning, so this case does not claim to exercise the MCP renderer that creates that frame.

The strengthened uncertain-audit assertions verify exact immutable base/desired, unknown observation with verification_failed reason for a missing-decision recovery, retained observed Fixture value after a prepared invocation fails, and absence of invented verified_after values in both paths.
