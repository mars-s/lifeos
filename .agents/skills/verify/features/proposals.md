# Reviewed proposals

A user reviews an immutable change set, approves its exact revision, and applies it only if source records are still fresh. This is the boundary that failed for a Things area snapshot.

## Sub-features

- `area-snapshot`: an area selected in Things can be reread by its opaque ID.
- `freshness`: an approved create rechecks that area before a write.
- `apply-once`: a successful fake-boundary write yields an applied revision and durable receipt.
- `stale`: a changed source prevents writes.

## How to get to it (user POV)

- In ChatGPT, review a `propose_changes` card, approve its `revision_hash`, then call `apply_approved_proposal` with that exact hash.
- The automated recipe drives the service workflow with injected fake Things and Calendar gateways. It does not alter the user's apps.

## Driving it with pytest and fake gateways

Preconditions:

- Run from the repository root after `uv sync --extra test`.
- No real proposal ID or production database is supplied.

- **Area re-read.** Run `uv run pytest tests/test_things_gateway.py::test_area_snapshot_can_be_reread_by_id -q`. The area collection record and by-ID record must have the same hash.
- **Approved apply.** Run `uv run pytest tests/test_service.py::test_approved_create_rechecks_area_snapshot_before_writing -q`. The service must reach `applied`, issue exactly one fake Things write, zero Calendar writes, and record a Things operation receipt.
- **Stale guard.** Run `uv run pytest tests/test_service.py::test_changed_area_snapshot_blocks_approved_create -q`. No fake write or receipt may occur.

## Gotchas

- Passing these tests does not mean the already-approved production proposal was applied. The user must explicitly choose when to retry it.
- Do not bypass freshness checking to get a write through.
- The fake gateway is placed at the Things or Calendar boundary; the proposal service and SQLite receipt path are real.
