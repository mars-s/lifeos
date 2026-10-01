# Brain-dump capture

A user can send raw thoughts to LifeOS from ChatGPT, then retrieve the exact text later without relying on the conversation as storage.

## Sub-features

- `capture`: save exact text through `capture_brain_dump`.
- `retrieve`: read the saved capture through `get_brain_dump`.
- `search`: find it through `search_brain_dumps`.
- `persist`: confirm one scratch SQLite row and no proposal.

## How to get to it (user POV)

- In ChatGPT, ask LifeOS to preserve a brain dump, then ask it to retrieve or search that capture.
- The same MCP tool path is reachable over local Streamable HTTP at `/mcp`.

## Driving it with verify_lifeos.py

Preconditions:

- Run from the repository root after `uv sync --extra test`.
- Do not use the Mac login stack or a production port.

- **Capture and read.** Run `uv run python .agents/skills/verify/scripts/verify_lifeos.py run`. The helper launches the real MCP server, calls `capture_brain_dump` with source `synthetic_test`, then calls `get_brain_dump` and `search_brain_dumps` with `include_tests=true`.
- **Proof.** Inspect the printed `artifacts/verification/<UTC timestamp>/capture.json`. The request text, returned capture ID, retrieved text, search match, and one SQLite row must agree. `proposal_count` must be zero.
- **Cleanup.** Inspect `cleanup.json`. It must report `server_stopped: true` and `scratch_removed: true`, while `capture.json` remains.

## Gotchas

- Normal list and search tools hide `synthetic_test` captures unless `include_tests=true`.
- `/health` alone does not prove a capture was persisted.
- This run does not test semanticization, remote memory indexing, Things writes, or Calendar writes.
