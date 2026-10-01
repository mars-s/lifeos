from __future__ import annotations

import sqlite3
from hashlib import sha256
from pathlib import Path

import pytest

from lifeos.brain_dump_store import BrainDumpConflict, BrainDumpStore


def build_store(tmp_path: Path) -> BrainDumpStore:
    return BrainDumpStore(tmp_path / "lifeos.sqlite3", tmp_path / "Journal")


def test_capture_then_semanticize_survives_without_chat_history(tmp_path):
    store = build_store(tmp_path)
    raw = "Finish the FIT3155 notes tomorrow, and I should call Mum."

    capture = store.capture(
        raw_text=raw,
        idempotency_key="capture-1",
        source="voice",
        captured_at="2026-09-22T13:30:00+10:00",
        locale="en-AU",
        time_zone="Australia/Melbourne",
    )
    semanticization = store.submit_semanticization(
        capture_id=capture["capture_id"],
        source_hash=capture["source_hash"],
        idempotency_key="semanticization-1",
        interpreted_by="chatgpt",
        summary="Study and a personal call.",
        items=[
            {
                "kind": "task",
                "title": "Finish FIT3155 notes",
                "area": "University",
                "source_excerpt": "Finish the FIT3155 notes tomorrow",
                "time_expression": "tomorrow",
                "confidence": 0.98,
                "needs_clarification": False,
            },
            {
                "kind": "task",
                "title": "Call Mum",
                "area": "Personal",
                "source_excerpt": "I should call Mum",
                "confidence": 0.96,
                "needs_clarification": True,
            },
        ],
        unresolved=["What time should the call happen?"],
        journal_entry="I need to finish my study notes and call Mum.",
    )

    stored = store.get(capture["capture_id"])

    assert stored["raw_text"] == raw
    assert stored["semanticizations"][0]["revision_hash"] == semanticization["revision_hash"]
    assert stored["semanticizations"][0]["items"][0]["candidate_id"].startswith("candidate-")
    journal_path = Path(semanticization["journal_path"])
    assert journal_path.name == "2026-09-22.md"
    journal = journal_path.read_text()
    assert "I need to finish my study notes and call Mum." in journal
    assert raw not in journal


def test_capture_and_semanticization_retries_are_idempotent(tmp_path):
    store = build_store(tmp_path)
    fields = {
        "raw_text": "Book a dentist appointment.",
        "idempotency_key": "capture-1",
        "source": "chat",
        "captured_at": "2026-09-22T13:30:00+10:00",
    }
    first = store.capture(**fields)
    second = store.capture(**fields)
    semantic_fields = {
        "capture_id": first["capture_id"],
        "source_hash": first["source_hash"],
        "idempotency_key": "semanticization-1",
        "interpreted_by": "chatgpt",
        "items": [
            {
                "kind": "task",
                "title": "Book a dentist appointment",
                "source_excerpt": "Book a dentist appointment.",
                "confidence": 1.0,
                "needs_clarification": False,
            }
        ],
    }

    first_revision = store.submit_semanticization(**semantic_fields)
    second_revision = store.submit_semanticization(**semantic_fields)

    assert first["capture_id"] == second["capture_id"]
    assert first_revision["revision_hash"] == second_revision["revision_hash"]
    assert store.get(first["capture_id"])["semanticizations"] == [first_revision]


def test_idempotency_key_rejects_different_capture(tmp_path):
    store = build_store(tmp_path)
    store.capture(
        raw_text="First thought",
        idempotency_key="same-key",
        source="chat",
        captured_at="2026-09-22T13:30:00+10:00",
    )

    with pytest.raises(BrainDumpConflict):
        store.capture(
            raw_text="Different thought",
            idempotency_key="same-key",
            source="chat",
            captured_at="2026-09-22T13:30:00+10:00",
        )


def test_same_words_can_be_captured_again_at_a_different_time(tmp_path):
    store = build_store(tmp_path)

    first = store.capture(
        raw_text="Remember to call Mum.",
        idempotency_key="capture-1",
        source="voice",
        captured_at="2026-09-22T09:00:00+10:00",
    )
    second = store.capture(
        raw_text="Remember to call Mum.",
        idempotency_key="capture-2",
        source="voice",
        captured_at="2026-09-23T09:00:00+10:00",
    )

    assert first["capture_id"] != second["capture_id"]
    assert first["source_hash"] == second["source_hash"]


def test_migrates_early_unique_source_hash_schema_without_losing_captures(tmp_path):
    database_path = tmp_path / "lifeos.sqlite3"
    connection = sqlite3.connect(database_path)
    connection.execute(
        """
        CREATE TABLE brain_dump_captures (
            capture_id TEXT PRIMARY KEY,
            idempotency_key TEXT NOT NULL UNIQUE,
            input_hash TEXT NOT NULL,
            source_hash TEXT NOT NULL UNIQUE,
            source TEXT NOT NULL,
            raw_text TEXT NOT NULL,
            captured_at TEXT NOT NULL,
            locale TEXT,
            time_zone TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        INSERT INTO brain_dump_captures VALUES (
            'old-capture', 'old-key', 'old-input', ?, 'chat',
            'Same words', '2026-09-22T09:00:00+10:00', NULL, NULL,
            '2026-09-22T09:00:00+00:00'
        )
        """,
        (sha256(b"Same words").hexdigest(),),
    )
    connection.commit()
    connection.close()

    store = BrainDumpStore(database_path, tmp_path / "Journal")
    repeated = store.capture(
        raw_text="Same words",
        idempotency_key="new-key",
        source="chat",
        captured_at="2026-09-23T09:00:00+10:00",
    )

    assert store.get("old-capture")["raw_text"] == "Same words"
    assert repeated["capture_id"] != "old-capture"


def test_semanticization_rejects_invented_source_excerpt(tmp_path):
    store = build_store(tmp_path)
    capture = store.capture(
        raw_text="Finish the report.",
        idempotency_key="capture-1",
        source="chat",
        captured_at="2026-09-22T13:30:00+10:00",
    )

    with pytest.raises(ValueError, match="source_excerpt"):
        store.submit_semanticization(
            capture_id=capture["capture_id"],
            source_hash=capture["source_hash"],
            idempotency_key="semanticization-1",
            interpreted_by="chatgpt",
            items=[
                {
                    "kind": "task",
                    "title": "Invented task",
                    "source_excerpt": "This was never said",
                    "confidence": 0.2,
                    "needs_clarification": True,
                }
            ],
        )


def test_list_and_search_return_compact_capture_summaries(tmp_path):
    store = build_store(tmp_path)
    capture = store.capture(
        raw_text="Review the Korvant launch plan.",
        idempotency_key="capture-1",
        source="chat",
        captured_at="2026-09-22T13:30:00+10:00",
    )

    listed = store.list()
    searched = store.search("Korvant")

    assert listed["items"][0]["capture_id"] == capture["capture_id"]
    assert "raw_text" not in listed["items"][0]
    assert searched["items"][0]["preview"] == "Review the Korvant launch plan."


def test_capture_preserves_exact_whitespace_and_memory_receipt(tmp_path):
    store = build_store(tmp_path)
    raw = "  First thought.\nSecond thought.\n"
    capture = store.capture(raw_text=raw, idempotency_key="raw-1", source="voice")

    assert store.get(capture["capture_id"])["raw_text"] == raw
    assert capture["source_hash"] == sha256(raw.encode()).hexdigest()
    assert store.get_memory_receipt(capture["capture_id"]) is None

    first = store.record_memory_receipt(
        capture_id=capture["capture_id"],
        source_hash=capture["source_hash"],
        document_id="memory-doc-1",
    )
    second = store.record_memory_receipt(
        capture_id=capture["capture_id"],
        source_hash=capture["source_hash"],
        document_id="memory-doc-1",
    )

    assert first == second
    assert store.get_memory_receipt(capture["capture_id"]) == first
    with pytest.raises(BrainDumpConflict):
        store.record_memory_receipt(
            capture_id=capture["capture_id"],
            source_hash=capture["source_hash"],
            document_id="memory-doc-2",
        )
