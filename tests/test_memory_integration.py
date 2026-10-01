from __future__ import annotations

from pathlib import Path

import pytest

from lifeos.brain_dump_store import BrainDumpConflict, BrainDumpStore
from lifeos.memory_gateway import SupermemoryGateway, UnknownMemoryDocument
from lifeos.proposal_store import ProposalStore
from lifeos.service import LifeOSService


class FakeMemory:
    def __init__(self) -> None:
        self.documents: dict[str, dict] = {}
        self.add_calls = 0

    def get_document(self, identifier: str) -> dict:
        if identifier not in self.documents:
            raise UnknownMemoryDocument("missing")
        return self.documents[identifier]

    def add_document(self, *, content: str, custom_id: str, container_tag: str = "lifeos") -> dict:
        self.add_calls += 1
        document = {
            "id": "doc-1",
            "customId": custom_id,
            "content": content,
            "containerTags": [container_tag],
            "status": "queued",
        }
        self.documents[custom_id] = document
        self.documents["doc-1"] = document
        return document

    def search(self, query: str, *, limit: int, container_tag: str = "lifeos") -> dict:
        self.last_search_tag = container_tag
        return {
            "results": [
                {"id": "memory-1", "memory": "Aster likes blue notebooks.", "similarity": 0.9},
                {
                    "chunk": "Aster said blue notebooks help.",
                    "similarity": 0.8,
                    "documents": [{"id": next(key for key in self.documents if key.startswith("lifeos-capture-"))}],
                },
            ][:limit]
        }


def build_service(tmp_path: Path) -> tuple[LifeOSService, FakeMemory]:
    memory = FakeMemory()
    database = tmp_path / "lifeos.sqlite3"
    service = LifeOSService(
        ProposalStore(database),
        object(),
        object(),
        BrainDumpStore(database, tmp_path / "Journal"),
        memory,
    )
    return service, memory


def test_index_is_explicit_idempotent_and_source_linked(tmp_path):
    service, memory = build_service(tmp_path)
    capture = service.capture_brain_dump(
        raw_text="Aster said blue notebooks help.", idempotency_key="capture-1", source="chat"
    )

    with pytest.raises(BrainDumpConflict):
        service.index_brain_dump_memory(capture["capture_id"], "wrong hash")
    assert memory.add_calls == 0

    first = service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])
    second = service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])

    assert first == second
    assert first["status"] == "queued"
    assert memory.add_calls == 1
    assert service.get_brain_dump_memory_status(capture["capture_id"])["document_id"] == "doc-1"

    memory.documents["doc-1"]["status"] = "done"
    memory.documents["doc-1"]["memories"] = [{"id": "memory-1"}]
    assert service.get_brain_dump_memory_status(capture["capture_id"])["memory_count"] == 1

    recalled = service.recall_memory("blue notebooks")
    assert recalled["results"][0]["kind"] == "derived_memory"
    assert recalled["results"][0]["source_capture_ids"] == [capture["capture_id"]]
    assert recalled["results"][1]["source_capture_ids"] == [capture["capture_id"]]


def test_index_recovers_remote_document_without_reposting(tmp_path):
    service, memory = build_service(tmp_path)
    capture = service.capture_brain_dump(
        raw_text="Aster said blue notebooks help.", idempotency_key="capture-1", source="chat"
    )
    memory.add_document(
        content="Aster said blue notebooks help.",
        custom_id=f"lifeos-capture-{capture['capture_id']}",
    )

    status = service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])

    assert status["document_id"] == "doc-1"
    assert memory.add_calls == 1


def test_status_rejects_a_changed_remote_document(tmp_path):
    service, memory = build_service(tmp_path)
    capture = service.capture_brain_dump(
        raw_text="Original words.", idempotency_key="capture-1", source="chat"
    )
    service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])
    memory.documents["doc-1"]["content"] = "Changed words."

    with pytest.raises(BrainDumpConflict, match="content differs"):
        service.get_brain_dump_memory_status(capture["capture_id"])


def test_gateway_rejects_non_loopback_addresses():
    with pytest.raises(ValueError, match="loopback"):
        SupermemoryGateway("https://api.supermemory.ai")
    with pytest.raises(ValueError, match="loopback"):
        SupermemoryGateway("http://192.168.1.100:6767")


def test_synthetic_captures_are_isolated_from_personal_memory(tmp_path):
    service, memory = build_service(tmp_path)
    capture = service.capture_brain_dump(
        raw_text="Synthetic Aster memory.", idempotency_key="test-1", source="synthetic_test"
    )
    service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])
    assert memory.documents["doc-1"]["containerTags"] == ["lifeos-test"]
    assert service.list_brain_dumps()["total"] == 0
    assert service.search_brain_dumps("Aster")["count"] == 0
    assert service.list_brain_dumps(include_tests=True)["total"] == 1
    assert service.search_brain_dumps("Aster", include_tests=True)["count"] == 1

    service.recall_memory("Aster")
    assert memory.last_search_tag == "lifeos"
    service.recall_memory("Aster", scope="test")
    assert memory.last_search_tag == "lifeos-test"

    with pytest.raises(ValueError, match="scope"):
        service.recall_memory("Aster", scope="all")


def test_review_shows_claims_against_exact_original(tmp_path):
    service, memory = build_service(tmp_path)
    capture = service.capture_brain_dump(
        raw_text="Aster said blue notebooks help.", idempotency_key="capture-review", source="chat"
    )
    assert service.review_brain_dump_memory(capture["capture_id"])["status"] == "not_indexed"
    service.index_brain_dump_memory(capture["capture_id"], capture["source_hash"])
    memory.documents["doc-1"]["status"] = "done"
    memory.documents["doc-1"]["memories"] = [
        {"id": "memory-1", "memory": "Aster likes blue notebooks."}
    ]
    review = service.review_brain_dump_memory(capture["capture_id"])
    assert review["raw_text"] == "Aster said blue notebooks help."
    assert review["claims"] == [
        {"memory_id": "memory-1", "text": "Aster likes blue notebooks.", "review_status": "unreviewed"}
    ]
