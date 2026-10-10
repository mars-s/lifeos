# The Bana day page is the journal; Markdown is an export

Status: accepted, 10 Oct 2026 (LifeOS + Bana plan, decisions 1 and 2).

LifeOS used to append reflective prose to a Daily Journal Markdown file, and that file was the journal's source of truth. With Bana as the notebook, keeping Markdown authoritative would mean writing the journal twice: once in Bana, where the person reads and edits it on the Mac and the iPhone, and once in a file nobody edits.

Decision: journal prose is written to the Bana day page. `lifeos export-journal` writes that page to `LIFEOS_JOURNAL_DIR/<date>.md` on a schedule (launchd example in `launchd/`). The export never overwrites a file it did not write; it goes beside it as `<date>.bana.md`. While Bana is closed, a semanticization falls back to the old Markdown append, so no prose is lost.

Raw captures are different. The LifeOS SQLite ledger stays the immutable record (decision 2). Bana gets a copy of each capture with the same `Source hash`; if they ever differ, the ledger wins and the copy is flagged (`source_hash_matches: false`).

Consequences:

- Journal prose written while Bana was closed stays in Markdown only. It is not copied into Bana later.
- Search, memory and planning should read journal prose from Bana (`notes_today`, `notes_search`), not from the Markdown folder.
- Revisit raw-capture ownership after promotion to Things (phase 4) has been used for a while.
