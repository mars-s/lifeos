# LifeOS planner

LifeOS is a personal coordination product that connects Things 3, Apple Calendar, a daily journal, and conversational agents. It helps one user turn captured intent into reviewed tasks and scheduled time.

## Language

**Things Task**:
A to-do whose canonical record lives in Things 3.
_Avoid_: Planner task, calendar task

**External Commitment**:
A calendar occurrence that consumes available time and was not created by LifeOS.
_Avoid_: Fixed task, imported task

**Planned Work Block**:
A calendar event that reserves time for a Things Task. It may mirror selected task context and link back to the Things Task.
_Avoid_: Task, meeting, schedule

**Schedule Proposal**:
A set of proposed scheduling changes that the user can review and adjust before applying it.
_Avoid_: Final schedule, committed plan

**Brain Dump**:
Free-form text or speech from the user that the agent analyzes for journal content, possible tasks, projects, and scheduling changes.
_Avoid_: Journal entry, task list

**Brain Dump Capture**:
The durable LifeOS record of one Brain Dump. It preserves the exact raw input, its origin, and immutable interpretation revisions. It does not create a Things Task or calendar event.
_Avoid_: Chat history, transcript summary

**Semanticization Revision**:
One immutable, source-linked interpretation of a Brain Dump Capture into candidate items and unresolved questions. A later interpretation creates another revision instead of replacing the earlier one.
_Avoid_: Final task list, memory

**Derived Memory**:
A searchable claim extracted from a Brain Dump Capture by the local memory service. It can be revised or forgotten and never replaces the raw capture or a Semanticization Revision.
_Avoid_: Source record, journal entry, fact

**Memory Index Receipt**:
The LifeOS record linking a Brain Dump Capture to the memory service's document. It tracks indexing status without becoming the source of the captured words.
_Avoid_: Brain Dump Capture, memory

**Memory Source Review**:
A read-only comparison of Derived Memories with the exact Brain Dump Capture that produced them. A source link shows provenance, not that a claim is true.
_Avoid_: Memory approval, fact verification

**Synthetic Test Capture**:
An explicitly labeled Brain Dump Capture used to test memory extraction. Its derived memories live in a separate `lifeos-test` index and do not appear in normal recall.
_Avoid_: Real commitment, personal memory

**Suggested Action**:
An action inferred from a Brain Dump that has not yet become a Things Task or calendar change.
_Avoid_: Task, reminder

**Daily Journal**:
The Markdown document that is the canonical journal record for one local calendar date.
_Avoid_: Memory, transcript

**Agent**:
A conversational ChatGPT or Claude client that uses the LifeOS tool interface to read context and propose or apply actions.
_Avoid_: Scheduler, classifier

**LifeOS Link**:
The app-owned relationship between one Things Task and one or more Planned Work Blocks. Things 3 and Apple Calendar do not provide this relationship themselves.
_Avoid_: Native sync, calendar sync

## Authority

**Task authority**:
Things 3 is authoritative for the content, project membership, dates, and completion state of a Things Task.

**Timing authority**:
Apple Calendar is authoritative for the timing of External Commitments and Planned Work Blocks.

**Journal authority**:
Daily Journal Markdown is authoritative for journal prose. Search indexes, connections, and memories are derived from it.
