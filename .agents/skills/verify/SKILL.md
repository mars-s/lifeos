---
name: verify
description: Verify LifeOS MCP behavior through an isolated local HTTP server, protocol tool calls, scratch SQLite, and targeted gateway tests. Use after changes to capture, proposals, calendar, Things, or ChatGPT widgets.
---

# Verify LifeOS

Read [features/README.md](features/README.md), then the relevant feature recipe. LifeOS is a Mac-first MCP service. Its user-facing surfaces are ChatGPT tool calls and MCP App widgets. Things and Calendar are external write boundaries. Never drive the logged-in production process or apply a real proposal just to verify a code change.

## Launch

From the repository root, run `uv sync --extra test`, then `uv run python .agents/skills/verify/scripts/verify_lifeos.py run`. The helper starts `.venv/bin/lifeos-mcp` on a free loopback port with a temporary SQLite database and journal directory. It strips inherited `LIFEOS_` settings so it cannot use the configured OAuth tunnel or production database. It waits for `/health` before driving MCP. No Things or Calendar mutation tool is called. The helper terminates only its child process and removes its own scratch directory.

## Doctor

For an already-running isolated instance started by this verification run, call `uv run python .agents/skills/verify/scripts/verify_lifeos.py doctor --port PORT`. It must return `{"status":"ok","service":"lifeos-mcp"}`. A healthy process is not proof that Things, Calendar, or OAuth works. Never point this command at a shared production port and then treat that instance as safe to drive.

## Drive

The `run` helper calls real MCP tools over HTTP: `capture_brain_dump`, `get_brain_dump`, and `search_brain_dumps`. The capture is marked `synthetic_test`, stored in scratch SQLite, and never indexed remotely. The helper checks the response, the second read, search, and the persisted SQLite row. For approved proposal behavior, use the targeted fake-boundary regression: `uv run pytest tests/test_service.py::test_approved_create_rechecks_area_snapshot_before_writing tests/test_things_gateway.py::test_area_snapshot_can_be_reread_by_id -q`. For ChatGPT widget bindings, use the mapped tests in [features/widgets.md](features/widgets.md).

## Evidence

Each `run` writes `artifacts/verification/<UTC timestamp>/capture.json`, `server.log`, and `cleanup.json`. The JSON records the user-facing action and result, the follow-up read and search, the scratch SQLite row, and zero proposals. Check that `cleanup.json` says the exact child stopped and scratch was removed. Do not equate a test pass with a live ChatGPT rendering or a real Things or Calendar write. For gateway tests, evidence is pytest output and operation receipt assertions from the fake production boundary.

## Cleanup

The helper uses `try/finally` and terminates only the PID it started. It removes only its `TemporaryDirectory`; the evidence directory survives. If interrupted, inspect the printed evidence path and any remaining child PID before manual cleanup. Never kill by process name or clear the LifeOS user database.

## Helpers

`scripts/verify_lifeos.py run` performs launch, doctor, drive, evidence, and cleanup for capture. `scripts/verify_lifeos.py doctor --port PORT` is a read-only health check. The repository pipeline command `scripts/verify.sh` runs lint, tests, and the isolated MCP smoke check.
