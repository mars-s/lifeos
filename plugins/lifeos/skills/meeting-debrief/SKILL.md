---
name: meeting-debrief
description: Extract only the user's own follow-up tasks from a meeting transcript, cross-checking Granola or other generated notes without trusting them as evidence. Route each task to the right LifeOS area. Use when the user says they just had a meeting or provides meeting notes plus a transcript.
---

# Extract my meeting tasks

The main output is the user's personal action list, not general meeting minutes. Treat the transcript as primary evidence and generated notes as a fallible index into it. The transcript can contain errors, so preserve uncertainty when wording is unclear.

## Capture first

Call `capture_brain_dump` once before analysis. Set `source` to `import` and preserve the complete user-provided packet verbatim, including title, date, participants, notes, and transcript with clear section labels. Use one stable idempotency key if the capture must be retried. This stores the source in LifeOS; it does not write to Things or Calendar.

If the user supplied only a Granola link and not its contents, ask them to paste or export the transcript and notes. Do not imply that the link was read when it was not.

## Identify the user

Treat `Avinaba`, `Avi`, `Me`, and first-person statements by the user as the same person unless the packet says otherwise. Use speaker labels and conversational context to resolve pronouns. Never assign another attendee's task to the user just because it matters to the project.

## Extract only my work

Create a task candidate only when the transcript supports that the user owns the follow-up. Strong signals include:

- another speaker directly asks the user to do it;
- the user says they will do it;
- the group explicitly assigns it to the user;
- the notes name the user as owner and the transcript supports that assignment.

Do not create a user task from `we should`, a general recommendation, someone else's promise, or a task with no owner. Do not treat short acknowledgements such as `yeah`, `yep`, or `mm-hmm` as acceptance on their own. If ownership is plausible but not clear, create a question instead of a task.

For each user-owned task, write a short executable title, keep useful meeting context in its notes, and include a short verbatim transcript excerpt as evidence. Preserve explicit deadlines. Resolve relative dates only when the meeting date and time zone make the date unambiguous.

## Route the area

Choose one existing area for every task:

- `Paperless` for Paperless product, pricing, MCP/API, launch, security, integrations, onboarding, or related company work. When the meeting is clearly a work meeting and no other work area fits, prefer Paperless because most of the user's meetings are for Paperless.
- `Heimdall`, `Korvant`, `Sentinel`, `Monash Automation`, or `Chemwatch` when the transcript clearly concerns that product or job.
- `University` for courses, assignments, classes, or Monash study work that is not Monash Automation.
- `Personal` only for non-work personal tasks or when no work or study area applies.

Do not create new areas. Do not repeat an area name as a project. Suggest a project only when the transcript names a real project or the existing Things data clearly identifies one.

## Cross-check the notes

Check each material note against the transcript and assign one evidence status:

- `Confirmed`: directly supported by transcript wording.
- `Notes only`: present in the notes but not supported by the transcript.
- `Conflict`: the transcript materially disagrees with the notes.
- `Inference`: a useful synthesis that was not directly stated.

Use the status on each proposed user task. A notes excerpt may add context, but it cannot be the only proof of a `Confirmed` task. Keep other attendees' tasks as meeting context only when needed to understand a dependency. Never emit them as task candidates.

## Save the interpretation

Call `submit_brain_dump_semanticization` using the stored capture and source hash:

- only explicit user-owned follow-ups become `task` candidates;
- confirmed decisions and risks become brief supporting context, not extra tasks;
- unresolved ownership, timing, or disagreement becomes `question` candidates;
- every candidate uses a verbatim `source_excerpt` from the transcript section of the stored packet;
- every task candidate has one of the existing LifeOS areas, using the routing rules above;
- confidence reflects the evidence quality, not writing fluency;
- set `needs_clarification` whenever ownership, deadline, or meaning is uncertain.

Do not write a journal entry unless the user provided genuinely reflective first-person material. Do not create or modify Things tasks or Calendar events during the debrief.

## Present the debrief

Lead with a compact result in this order:

1. `Your tasks`, grouped by LifeOS area, with timing and evidence status
2. Ownership or deadline questions that block a task
3. Short meeting context, including material conflicts between notes and transcript

Then call `render_brain_dump_canvas` using the saved revision. Set `source_label` to the notes source, include the meeting date and participants when known, and pass the relevant timestamped transcript turns in `transcript_segments`. Put the user's tasks first and group them by area. Set each task's `assignee` to the user and its `evidence_status` from the cross-check. Use structured nodes for questions and supporting context. Include a Mermaid node that shows real task, person, decision, and dependency relationships. Do not add decorative or guessed links. Clearly label notes-only and inferred material.

For the relationship view, follow [meeting diagram guidance](references/meeting-diagrams.md). This applies Diagram Design's small, source-linked visual grammar to the existing Mermaid canvas; it does not replace the raw transcript, semanticization, or approval flow. If a separate polished static export is requested, use the full Diagram Design skill and its style-guide gate before generating HTML/SVG.

End with the LifeOS capture ID and a reminder that nothing has changed in Things or Calendar. If the user later asks to act on an item, use the normal proposal and approval flow.
