# Anytype is the notebook; Bana is parked

Status: accepted, 11 Oct 2026. Supersedes [ADR 0002](0002-bana-day-page-is-the-journal.md).

The person uses Anytype every day. Bana was a notebook built for LifeOS, and nobody lives in it. A notebook only helps if it is the one you open, so the notebook is Anytype.

Decision:

- LifeOS reaches Anytype only through its documented Local API (Anytype-Version 2025-11-08), from `src/lifeos/anytype_gateway.py`. The note tools, their tiers, the `notes` and `notes:write` scopes and the request_id rules stay as they were; only the backend changed. The Bana gateway is removed.
- One space is the LifeOS space, chosen by `lifeos anytype connect`. LifeOS creates its own types (Capture, Interpretation, Suggested action, Meeting, Proposal, Journal day), properties (keys start with `lifeos_`, plus `made_by`) and the Ask agent tag there, once.
- Journal prose goes to that day's Journal day object. `lifeos export-journal` still writes it to Markdown, which stays an export, and still the fallback while Anytype is closed.
- The LifeOS SQLite ledger stays the immutable record of raw captures. Anytype gets a copy with the same Source hash; if they differ, the ledger wins and the copy is flagged.
- The person can also ask from Anytype itself: a chat named LifeOS, answered by the LifeOS chat agent through Codex and the same tools.
- The base URL, the key source and the space are configuration, so the same code can later talk to a headless `anytype-cli` on a server.

Kept from before: approval is only the person's (card or `lifeos approve`), never a note edit or a chat message. Nothing in Anytype is deleted by LifeOS: every DELETE is outside the allowlist. Note text is data, not instructions.

Consequences:

- Anytype has no outline, so "under a node" became links: interpretations and suggested actions point back with the `lifeos_source` property, and "move" means adding to a collection.
- Anytype has no lock, so the capture copy can be edited by the person. The ledger still wins.
- Anytype has no revision counter, so freshness is a hash of the object's name, body, type and properties, leaving out what Anytype changes by itself (last modified, last opened, backlinks).
- The Mac must be awake with Anytype open for cloud agents and the chat agent to reach notes.
