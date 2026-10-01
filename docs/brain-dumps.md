# Brain dumps

ChatGPT is an interpreter for this workflow, not the durable store.

1. `capture_brain_dump` writes the user's exact words to local SQLite and returns a content hash.
2. ChatGPT extracts candidate items while preserving source excerpts and ambiguity.
3. `submit_brain_dump_semanticization` stores that interpretation as an immutable revision linked to the raw capture.
4. `get_brain_dump`, `list_brain_dumps`, and `search_brain_dumps` retrieve the record without relying on chat history.
5. `render_brain_dump_canvas` lays out the saved interpretation as task, Calendar, journal, and question previews.
6. A later review step can turn selected candidates into the existing proposal and approval flow.

The capture step never writes to Things or Calendar. Semanticization never overwrites the raw words. Reprocessing with another model creates a new revision.

Reflective prose may be appended to the Daily Journal Markdown. Candidate tasks, project ideas, and questions stay in SQLite until the user reviews them.

The plugin skill is under `plugins/lifeos/skills/capture-brain-dump`. Its workflow captures first, semanticizes second, renders the canvas, and stops before external writes.
