# Things automation capability matrix · September 30, 2026

Things is running from `/Users/avi/Documents/apps/Things3.app`. Its public scripting dictionary was inspected at `Contents/Resources/Things.sdef`, without sending an Apple event or reading tasks. Standard application locations, Spotlight and NSWorkspace did not resolve it; those checks were incomplete, not evidence that Things was absent. Hidden/private experimental JSON and reorder commands in the dictionary are excluded.

Sources: [installed dictionary](/Users/avi/Documents/apps/Things3.app/Contents/Resources/Things.sdef), [vendor AppleScript documentation](https://culturedcode.com/things/support/articles/4562654/), [Shortcuts technical documentation](https://culturedcode.com/things/support/articles/9596775/), [URL scheme](https://culturedcode.com/things/support/articles/2803573/). This table distinguishes vendor capabilities from the implemented first phase. Approved live public reads were tested; no live writes or upload occurred.

| Field | Public AppleScript read / write | Shortcuts / URL alternative | First phase |
|---|---|---|---|
| IDs | Read-only for task, project, area, tag | Shortcuts item ID / URL target IDs | Read; immutable identity |
| Title, notes | Read/write; area/tag title, task/project notes | Read/edit text in Shortcuts; URL patch text | Read; guarded task/project title/notes writer prepared, disabled |
| Checklist | Not exposed | Shortcuts text with checkbox syntax; URL replaces/appends rows | Unsupported in initial reader; never replace blindly |
| Tags | Tag objects, titles, parent tag; read/write | Shortcuts direct versus inherited tags; URL tag names | Read IDs/relationships; writes disabled |
| Projects, areas | Enumerate; create/edit/delete | Shortcuts item types; URL project/parent commands | Read; no create/delete |
| Headings | Not publicly exposed | Shortcuts find/create; title/status edits; URL heading placement | Unsupported initially |
| Start date | Read-only activation date; schedule command writes | Shortcuts Start/date; URL when | Read; no scheduling writes |
| Deadline | Read/write due date (deadline) | Shortcuts deadline; URL deadline | Read; no date writes |
| Reminder | Not exposed | Shortcuts reminder date/time; URL when with time | Unsupported initially |
| Recurrence | No public rule/template field | Shortcuts does not expose rule or deadline offset; URL restricts repeating edits | Unsupported; no repeat editing |
| UI order | Collection order observable per list; no supported general reorder command | Shortcuts sorting is not Things manual order; URL no reorder | Preserve per-list ID/index memberships; no order writes |
| Today / evening | Today membership; evening not exposed | Shortcuts Evening; URL when=evening | Initial read cannot distinguish evening; unknown |
| Completion, cancellation | Status and dates read/write | Shortcuts status; URL flags with repeating restrictions | Read; writes disabled |
| Logbook/archive | List membership and logging command | Shortcuts Is Logged/status; heading archive semantics differ | Explicit observed Logbook membership plus status/timestamps; no archive inference from status/parent |
| Trash/deletion | Public Trash list; delete; empty trash | Shortcuts delete with immediate option | Explicit observed Trash membership; no delete; disappearance is cache absence, not proof of permanent deletion |
| Relationships | Task project/area, project area, tag parent | Shortcuts parent/heading IDs; URL parent/heading IDs | Read available IDs; absent/unknown distinguished |
| Priority | No numeric task priority property | Tags or user order can express intent | Separate cloud planning priority; never invent a Things numeric priority |

`Find Items` in Shortcuts returns at most 500 items. No offset/cursor is documented. An unfiltered result at that cap cannot be called a full inventory. A future Shortcuts reader needs disjoint exhaustive partitions with coverage evidence before completeness; truncation must abort, not infer deletion. Live testing showed the initial JXA top-level enumeration was incomplete (8 tasks, 0 projects). The corrected AppleScript/JXA union spans all public lists, top-level collections and project/area children, with stable-ID classification and deduplication. It returned 45 tasks, 4 projects, 4 areas and 6 tags; observed Logbook membership 36 and Trash membership 5. All seven installed built-in list IDs must resolve; field/membership/order comparisons across two passes and before/after classifications must agree. Failures abort without a snapshot. This defines **supported public coverage**, not internal/full fidelity, an atomic snapshot or a ThingsCloud sync barrier. See [coverage definition](mac/READ_ONLY_HANDOFF.md).

The wire format distinguishes `value`, `absent`, `unsupported`, and `unknown` cells. Empty strings/arrays are values. A successful missing-value read is absent; an error is unknown. Unknown/unsupported incoming cells retain previous data as `last_known`; fields omitted by an adapter are retained. Unknown vendor properties are never queried automatically, and unknown wire fields are retained without becoming editable. Object relationships are IDs, not names. Civil dates retain the Mac IANA timezone; instant timestamps include offsets. The reader does not claim full application fidelity.

Original LifeOS at `/Users/avi/Documents/ChatGPT/lifeos` runs a local MCP server (`127.0.0.1:48763`) with ngrok/GitHub OAuth for remote access; it is not a durable cloud service. Its approval revision hashes, source snapshots and per-operation receipts inform this companion. Its direct `things-py` reader is not imported. No original configuration or runtime was altered.
