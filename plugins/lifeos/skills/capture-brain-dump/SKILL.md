---
name: capture-brain-dump
description: Preserve a spoken or typed brain dump in LifeOS, then extract reviewable candidate tasks, projects, notes, ideas, questions, and journal prose without writing to Things or Calendar.
---

# Capture a brain dump

Use this when the user says they are brain dumping, unloading thoughts, capturing ideas, or wants their speech organized for later.

1. Call `capture_brain_dump` first with the user's exact words. Do not clean up, summarize, or omit repetitions in `raw_text`. Use `voice` when the input came from voice mode and `chat` otherwise. Use one stable idempotency key for retries of this capture.
2. Interpret the saved text into candidate items. Each item must have a concise title, a kind, confidence, and an exact `source_excerpt` when the raw words support one.
3. Call `submit_brain_dump_semanticization` with the returned `capture_id` and `source_hash`. Set `interpreted_by` to `chatgpt`. Use a different stable idempotency key for this interpretation.
4. Call `render_brain_dump_canvas` with the saved `capture_id`, the semanticization revision hash, and the same durable data. Include task candidates, possible Calendar placement, journal prose, and unresolved questions when present. Keep task candidates primary, supporting context short, and node source order deliberate. Placement fields are compatibility hints; the renderer owns the collision-free layout. Calendar items are previews, not scheduled events.
5. Report the saved capture ID, candidate count, and unresolved questions. Keep the response brief unless the user asks to review details.

When the user asks LifeOS to remember or semantically recall this capture, call `index_brain_dump_memory` with the saved `capture_id` and exact `source_hash`. This sends the raw capture to the configured remote MiMo extractor through the local Supermemory process. Tell the user whether processing is queued or complete; check with `get_brain_dump_memory_status` before claiming recall is ready. Do not silently index confidential meeting transcripts just because they were captured.

For later recall, use `recall_memory` to find likely context, then `get_brain_dump` for the exact words when a result has a source capture ID. Treat an extracted memory as a fallible claim. A result without a source capture ID should not be presented as a verified quote.

Map clear work context to the existing areas University, Personal, Paperless, Chemwatch, Heimdall, Korvant, Sentinel, or Monash Automation. Use Personal only when nothing else applies. Do not guess an area when the wording points to more than one.

Preserve phrases such as "tomorrow" or "next week" in `time_expression`. Only set `suggested_when` when the date is unambiguous from the conversation's date and time zone. Leave uncertain durations empty. Put ambiguity into `unresolved` and mark affected items `needs_clarification`.

Use `journal_entry` only for reflective prose the user would reasonably expect in a daily journal. A task list alone is not a journal entry.

Prefer the structured `tasks`, `calendar`, `journal`, and `questions` nodes. Use a `mermaid` node when relationships benefit from a flowchart, mind map, timeline, or journey. Keep labels concise, provide plain Mermaid source without frontmatter, and put a meaningful plain-language summary of the relationships in the node's `body` for accessibility. LifeOS applies the host-aware theme and strict security settings. `custom_html` is a legacy escape hatch for an interaction Mermaid cannot express. Its HTML, CSS, and JavaScript run in an isolated nested sandbox with no network or LifeOS tool access; do not use it for diagrams or merely to restyle a normal list.

Capturing and interpreting write to LifeOS local storage. Optional memory indexing also sends the raw text to the configured remote extractor. None of these steps create or update Things tasks, projects, or Calendar events. If the user asks to act on candidates, show a normal LifeOS proposal and wait for the existing approval flow.
