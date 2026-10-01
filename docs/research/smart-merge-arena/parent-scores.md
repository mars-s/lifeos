# Parent scores
All candidate design and rationale files read end to end. Same Sol medium model reduces diversity. Third candidate could not start because thread limit, so arena proceeds with two.

| Criterion | Candidate 1 | Candidate 2 |
| --- | --- | --- |
| Compatible edits and resolution | 4 | 4 |
| Causality and recovery | 3 | 4 |
| Actual API boundaries | 4 | 4 |
| Simplicity and migration | 3 | 4 |
| UX and verification | 4 | 5 |
| Total | 18 | 21 |

Provisional base: candidate 2. Conservative interrupted-setter recovery is easier to reason about than before-value replay under hidden ABA. Retaining divergent confirmation as review is safer than treating it as newer author intent and automatically retiring the desire.

Required correction in both: C==B does not prove no intent. Existing queued requests are explicit owner commands. An explicit set-to-A can intentionally restore A after a local edit to X even if stale displayed base was A. Only a declared derived patch with no changed value can be treated as no-op. Idempotent L==C still needs no setter. This is an artifact verification finding, not a live-code change.

Graft candidate 1's supported-field version vector for Trash rather than a complete public-item fingerprint: exclude derived lists, collection ordering, modification timestamps and unsupported cells. Retain only supported semantic values relevant to competing edits, plus availability generation. Avoid accidental conflicts from midnight list changes and automatic metadata.
