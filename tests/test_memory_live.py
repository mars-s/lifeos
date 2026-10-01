"""Opt-in smoke test against the local Supermemory service and remote extractor."""

from __future__ import annotations

import os
import time
from uuid import uuid4

import pytest

from lifeos.brain_dump_store import BrainDumpStore
from lifeos.memory_gateway import SupermemoryGateway
from lifeos.proposal_store import ProposalStore
from lifeos.service import LifeOSService


@pytest.mark.skipif(
    os.environ.get("LIFEOS_LIVE_MEMORY_TEST") != "1",
    reason="requires running Supermemory and sends synthetic text to the remote extractor",
)
def test_capture_index_and_recall_through_live_memory(tmp_path):
    database = tmp_path / "lifeos.sqlite3"
    service = LifeOSService(
        ProposalStore(database),
        object(),
        object(),
        BrainDumpStore(database, tmp_path / "Journal"),
        SupermemoryGateway(),
    )
    marker = uuid4().hex[:10]
    raw = f"Synthetic LifeOS test {marker}: Aster keeps a blue notebook by the window."
    capture = service.capture_brain_dump(
        raw_text=raw,
        idempotency_key=f"live-{marker}",
        source="synthetic_test",
    )
    document_id = None
    try:
        queued = service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])
        document_id = queued["document_id"]
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            status = service.get_brain_dump_memory_status(capture["capture_id"])
            if status["status"] in {"done", "failed"}:
                break
            time.sleep(2)
        assert status["status"] == "done"

        recalled = service.recall_memory(f"Aster blue notebook {marker}", limit=20, scope="test")
        assert any("blue notebook" in result["text"] for result in recalled["results"])
        assert any(
            capture["capture_id"] in result["source_capture_ids"]
            for result in recalled["results"]
        )
        personal = service.recall_memory(f"Aster blue notebook {marker}", limit=20)
        assert all(
            capture["capture_id"] not in result["source_capture_ids"]
            for result in personal["results"]
        )
    finally:
        if document_id:
            service.memory.delete_document(document_id)
