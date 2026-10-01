# LifeOS verification map

This is the maintained index of LifeOS user paths. Read the feature file before claiming a path was verified. The automated HTTP run uses a disposable database; it never uses the Mac login stack or ChatGPT's authenticated tunnel.

## Baseline

- Install dependencies with `uv sync --extra test`.
- Run `scripts/verify.sh` for lint, all tests, and one real HTTP MCP capture path.
- Use the generated `artifacts/verification/<UTC timestamp>/` evidence. Do not delete evidence during cleanup.
- The isolated server can run alongside production because it uses another loopback port and scratch data. The helper strips `LIFEOS_` environment variables.
- A fake Things or Calendar gateway is permitted only at that external boundary in tests. It is not proof of a live write.

## Features

- [Brain-dump capture](capture.md): preserve exact raw text, retrieve it, and search it across MCP calls.
- [Reviewed proposals](proposals.md): bind approval to a revision, recheck Things area snapshots, apply once, and record receipts through a fake external gateway.
- [ChatGPT widgets](widgets.md): publish MCP Apps resources and structured results for plan, proposal, and brain-dump cards.
