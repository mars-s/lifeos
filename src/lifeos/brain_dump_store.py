"""Durable local storage for raw brain dumps and immutable interpretations."""

from __future__ import annotations

import fcntl
import json
import os
import sqlite3
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

from .models import canonical_json


class BrainDumpError(RuntimeError):
    pass


class UnknownBrainDump(BrainDumpError):
    pass


class BrainDumpConflict(BrainDumpError):
    pass


class BrainDumpStore:
    """Store exact captures before any model interpretation can be lost."""

    def __init__(self, database_path: str | Path, journal_dir: str | Path) -> None:
        self._lock = RLock()
        self._journal_dir = Path(journal_dir)
        self._connection = sqlite3.connect(Path(database_path), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode = WAL")
        self._connection.execute("PRAGMA synchronous = FULL")
        self._connection.execute("PRAGMA foreign_keys = ON")
        self._migrate()

    def close(self) -> None:
        self._connection.close()

    def _migrate(self) -> None:
        self._migrate_repeated_capture_support()
        with self._transaction() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS brain_dump_captures (
                    capture_id TEXT PRIMARY KEY,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    input_hash TEXT NOT NULL,
                    source_hash TEXT NOT NULL,
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
                CREATE TABLE IF NOT EXISTS brain_dump_semanticizations (
                    capture_id TEXT NOT NULL REFERENCES brain_dump_captures(capture_id),
                    revision_number INTEGER NOT NULL,
                    revision_hash TEXT NOT NULL UNIQUE,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    input_hash TEXT NOT NULL,
                    source_hash TEXT NOT NULL,
                    interpreted_by TEXT NOT NULL,
                    schema_version TEXT NOT NULL,
                    summary TEXT,
                    unresolved_json TEXT NOT NULL,
                    items_json TEXT NOT NULL,
                    journal_entry TEXT,
                    journal_path TEXT,
                    journal_written INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (capture_id, revision_number),
                    UNIQUE (capture_id, revision_hash)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS brain_dump_materialization_links (
                    capture_id TEXT NOT NULL,
                    revision_hash TEXT NOT NULL,
                    candidate_id TEXT NOT NULL,
                    things_id TEXT,
                    calendar_event_id TEXT,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (capture_id, revision_hash, candidate_id),
                    FOREIGN KEY (capture_id, revision_hash)
                        REFERENCES brain_dump_semanticizations(capture_id, revision_hash)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS brain_dump_captured_at ON brain_dump_captures(captured_at DESC)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS brain_dump_memory_receipts (
                    capture_id TEXT PRIMARY KEY REFERENCES brain_dump_captures(capture_id),
                    source_hash TEXT NOT NULL,
                    document_id TEXT NOT NULL UNIQUE,
                    indexed_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS brain_dump_memory_sources (
                    capture_id TEXT NOT NULL REFERENCES brain_dump_captures(capture_id),
                    memory_id TEXT NOT NULL,
                    observed_at TEXT NOT NULL,
                    PRIMARY KEY (capture_id, memory_id)
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS brain_dump_memory_source_lookup ON brain_dump_memory_sources(memory_id)"
            )

    def _migrate_repeated_capture_support(self) -> None:
        """Remove the early source-hash uniqueness rule while preserving captures."""
        row = self._connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'brain_dump_captures'"
        ).fetchone()
        if row is None or "source_hash TEXT NOT NULL UNIQUE" not in row["sql"]:
            return

        with self._lock:
            self._connection.execute("PRAGMA foreign_keys = OFF")
            try:
                self._connection.execute("BEGIN IMMEDIATE")
                self._connection.execute(
                    """
                    CREATE TABLE brain_dump_captures_replacement (
                        capture_id TEXT PRIMARY KEY,
                        idempotency_key TEXT NOT NULL UNIQUE,
                        input_hash TEXT NOT NULL,
                        source_hash TEXT NOT NULL,
                        source TEXT NOT NULL,
                        raw_text TEXT NOT NULL,
                        captured_at TEXT NOT NULL,
                        locale TEXT,
                        time_zone TEXT,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                self._connection.execute(
                    """
                    INSERT INTO brain_dump_captures_replacement
                    SELECT capture_id, idempotency_key, input_hash, source_hash, source,
                           raw_text, captured_at, locale, time_zone, created_at
                    FROM brain_dump_captures
                    """
                )
                self._connection.execute("DROP TABLE brain_dump_captures")
                self._connection.execute(
                    "ALTER TABLE brain_dump_captures_replacement RENAME TO brain_dump_captures"
                )
                self._connection.commit()
            except BaseException:
                self._connection.rollback()
                raise
            finally:
                self._connection.execute("PRAGMA foreign_keys = ON")

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            try:
                self._connection.execute("BEGIN IMMEDIATE")
                yield self._connection
                self._connection.commit()
            except BaseException:
                self._connection.rollback()
                raise

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _captured_at(value: str | None) -> datetime:
        if value is None:
            return datetime.now().astimezone()
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("captured_at must be an ISO-8601 datetime") from error
        if parsed.tzinfo is None:
            raise ValueError("captured_at must include a time-zone offset")
        return parsed

    def capture(
        self,
        *,
        raw_text: str,
        idempotency_key: str,
        source: str,
        captured_at: str | None = None,
        locale: str | None = None,
        time_zone: str | None = None,
    ) -> dict[str, Any]:
        if not raw_text.strip():
            raise ValueError("raw_text must not be empty")
        text = raw_text
        if not idempotency_key:
            raise ValueError("idempotency_key must not be empty")
        timestamp = self._captured_at(captured_at)
        payload = {
            "raw_text": text,
            "source": source,
            "captured_at": timestamp.isoformat(),
            "locale": locale,
            "time_zone": time_zone,
        }
        input_hash = sha256(canonical_json(payload).encode()).hexdigest()
        source_hash = sha256(text.encode()).hexdigest()

        with self._transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM brain_dump_captures WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing:
                if existing["input_hash"] != input_hash:
                    raise BrainDumpConflict("idempotency key already belongs to another capture")
                return self._capture_to_dict(existing)

            capture_id = str(uuid4())
            created_at = self._now()
            connection.execute(
                """
                INSERT INTO brain_dump_captures(
                    capture_id, idempotency_key, input_hash, source_hash, source,
                    raw_text, captured_at, locale, time_zone, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    capture_id,
                    idempotency_key,
                    input_hash,
                    source_hash,
                    source,
                    text,
                    timestamp.isoformat(),
                    locale,
                    time_zone,
                    created_at,
                ),
            )
            row = connection.execute(
                "SELECT * FROM brain_dump_captures WHERE capture_id = ?", (capture_id,)
            ).fetchone()
        return self._capture_to_dict(row)

    def submit_semanticization(
        self,
        *,
        capture_id: str,
        source_hash: str,
        idempotency_key: str,
        interpreted_by: str,
        items: Sequence[Mapping[str, Any]],
        unresolved: Sequence[str] = (),
        summary: str | None = None,
        journal_entry: str | None = None,
        schema_version: str = "1",
    ) -> dict[str, Any]:
        capture = self._require_capture(capture_id)
        if source_hash != capture["source_hash"]:
            raise BrainDumpConflict("source_hash does not match the stored raw capture")
        if not idempotency_key or not interpreted_by or not schema_version:
            raise ValueError("idempotency_key, interpreted_by, and schema_version are required")
        prepared_items = []
        for index, item in enumerate(items):
            candidate = dict(item)
            excerpt = candidate.get("source_excerpt")
            if excerpt is not None and excerpt not in capture["raw_text"]:
                raise ValueError("every source_excerpt must occur verbatim in the raw capture")
            candidate_hash = sha256(
                f"{capture_id}:{index}:{canonical_json(candidate)}".encode()
            ).hexdigest()
            candidate.setdefault("candidate_id", f"candidate-{candidate_hash[:20]}")
            prepared_items.append(candidate)
        clean_unresolved = [str(value).strip() for value in unresolved if str(value).strip()]
        clean_journal = journal_entry.strip() if journal_entry and journal_entry.strip() else None
        payload = {
            "capture_id": capture_id,
            "source_hash": source_hash,
            "interpreted_by": interpreted_by,
            "schema_version": schema_version,
            "summary": summary,
            "unresolved": clean_unresolved,
            "items": prepared_items,
            "journal_entry": clean_journal,
        }
        input_hash = sha256(canonical_json(payload).encode()).hexdigest()

        with self._transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM brain_dump_semanticizations WHERE idempotency_key = ?",
                (idempotency_key,),
            ).fetchone()
            if existing:
                if existing["input_hash"] != input_hash:
                    raise BrainDumpConflict(
                        "idempotency key already belongs to another semanticization"
                    )
                revision = self._semanticization_to_dict(existing)
            else:
                latest = connection.execute(
                    "SELECT COALESCE(MAX(revision_number), 0) AS revision FROM brain_dump_semanticizations WHERE capture_id = ?",
                    (capture_id,),
                ).fetchone()
                revision_number = int(latest["revision"]) + 1
                revision_payload = dict(payload, revision_number=revision_number)
                revision_hash = sha256(canonical_json(revision_payload).encode()).hexdigest()
                created_at = self._now()
                connection.execute(
                    """
                    INSERT INTO brain_dump_semanticizations(
                        capture_id, revision_number, revision_hash, idempotency_key,
                        input_hash, source_hash, interpreted_by, schema_version, summary,
                        unresolved_json, items_json, journal_entry, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        capture_id,
                        revision_number,
                        revision_hash,
                        idempotency_key,
                        input_hash,
                        source_hash,
                        interpreted_by,
                        schema_version,
                        summary,
                        canonical_json(clean_unresolved),
                        canonical_json(prepared_items),
                        clean_journal,
                        created_at,
                    ),
                )
                existing = connection.execute(
                    "SELECT * FROM brain_dump_semanticizations WHERE revision_hash = ?",
                    (revision_hash,),
                ).fetchone()
                revision = self._semanticization_to_dict(existing)

        if clean_journal and not revision["journal_written"]:
            journal_path = self._append_journal(capture, revision)
            with self._transaction() as connection:
                connection.execute(
                    """
                    UPDATE brain_dump_semanticizations
                    SET journal_path = ?, journal_written = 1
                    WHERE revision_hash = ?
                    """,
                    (str(journal_path), revision["revision_hash"]),
                )
            revision["journal_path"] = str(journal_path)
            revision["journal_written"] = True
        return revision

    def get(self, capture_id: str) -> dict[str, Any]:
        capture = self._capture_to_dict(self._require_capture(capture_id))
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM brain_dump_semanticizations
                WHERE capture_id = ? ORDER BY revision_number
                """,
                (capture_id,),
            ).fetchall()
        capture["semanticizations"] = [self._semanticization_to_dict(row) for row in rows]
        return capture

    def get_memory_receipt(self, capture_id: str) -> dict[str, str] | None:
        self._require_capture(capture_id)
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM brain_dump_memory_receipts WHERE capture_id = ?",
                (capture_id,),
            ).fetchone()
        return dict(row) if row is not None else None

    def record_memory_receipt(
        self, *, capture_id: str, source_hash: str, document_id: str
    ) -> dict[str, str]:
        if not document_id:
            raise ValueError("document_id must not be empty")
        capture = self._require_capture(capture_id)
        if capture["source_hash"] != source_hash:
            raise BrainDumpConflict("source_hash does not match the stored raw capture")
        with self._transaction() as connection:
            existing = connection.execute(
                "SELECT * FROM brain_dump_memory_receipts WHERE capture_id = ?",
                (capture_id,),
            ).fetchone()
            if existing is not None:
                if existing["document_id"] != document_id or existing["source_hash"] != source_hash:
                    raise BrainDumpConflict("capture is linked to another memory document")
                return dict(existing)
            connection.execute(
                """
                INSERT INTO brain_dump_memory_receipts(capture_id, source_hash, document_id, indexed_at)
                VALUES (?, ?, ?, ?)
                """,
                (capture_id, source_hash, document_id, self._now()),
            )
            row = connection.execute(
                "SELECT * FROM brain_dump_memory_receipts WHERE capture_id = ?",
                (capture_id,),
            ).fetchone()
        return dict(row)

    def record_memory_sources(self, capture_id: str, memory_ids: Sequence[str]) -> None:
        if self.get_memory_receipt(capture_id) is None:
            raise BrainDumpConflict("capture has no memory index receipt")
        with self._transaction() as connection:
            connection.executemany(
                """
                INSERT OR IGNORE INTO brain_dump_memory_sources(capture_id, memory_id, observed_at)
                VALUES (?, ?, ?)
                """,
                [(capture_id, memory_id, self._now()) for memory_id in memory_ids if memory_id],
            )

    def capture_ids_for_memory(self, memory_id: str) -> list[str]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT capture_id FROM brain_dump_memory_sources WHERE memory_id = ? ORDER BY capture_id",
                (memory_id,),
            ).fetchall()
        return [row["capture_id"] for row in rows]

    def list(self, *, limit: int = 20, offset: int = 0, include_tests: bool = False) -> dict[str, Any]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT c.*, COUNT(s.revision_number) AS revision_count
                FROM brain_dump_captures c
                LEFT JOIN brain_dump_semanticizations s ON s.capture_id = c.capture_id
                WHERE (? OR c.source != 'synthetic_test')
                GROUP BY c.capture_id
                ORDER BY c.captured_at DESC LIMIT ? OFFSET ?
                """,
                (include_tests, limit, offset),
            ).fetchall()
            total = self._connection.execute(
                "SELECT COUNT(*) AS count FROM brain_dump_captures WHERE (? OR source != 'synthetic_test')",
                (include_tests,),
            ).fetchone()["count"]
        return {
            "items": [self._capture_summary(row) for row in rows],
            "count": len(rows),
            "total": total,
            "limit": limit,
            "offset": offset,
        }

    def search(self, query: str, *, limit: int = 20, include_tests: bool = False) -> dict[str, Any]:
        term = query.strip()
        if not term:
            raise ValueError("query must not be empty")
        pattern = f"%{term}%"
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT DISTINCT c.*,
                    (SELECT COUNT(*) FROM brain_dump_semanticizations s2
                     WHERE s2.capture_id = c.capture_id) AS revision_count
                FROM brain_dump_captures c
                LEFT JOIN brain_dump_semanticizations s ON s.capture_id = c.capture_id
                WHERE (? OR c.source != 'synthetic_test')
                  AND (c.raw_text LIKE ? OR s.summary LIKE ? OR s.items_json LIKE ?)
                ORDER BY c.captured_at DESC LIMIT ?
                """,
                (include_tests, pattern, pattern, pattern, limit),
            ).fetchall()
        return {"items": [self._capture_summary(row) for row in rows], "count": len(rows)}

    def _require_capture(self, capture_id: str) -> sqlite3.Row:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM brain_dump_captures WHERE capture_id = ?", (capture_id,)
            ).fetchone()
        if row is None:
            raise UnknownBrainDump(capture_id)
        return row

    @staticmethod
    def _capture_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "capture_id": row["capture_id"],
            "source_hash": row["source_hash"],
            "source": row["source"],
            "raw_text": row["raw_text"],
            "captured_at": row["captured_at"],
            "locale": row["locale"],
            "time_zone": row["time_zone"],
            "created_at": row["created_at"],
        }

    @staticmethod
    def _capture_summary(row: sqlite3.Row) -> dict[str, Any]:
        text = row["raw_text"]
        return {
            "capture_id": row["capture_id"],
            "source_hash": row["source_hash"],
            "source": row["source"],
            "captured_at": row["captured_at"],
            "preview": text if len(text) <= 180 else f"{text[:177]}...",
            "revision_count": int(row["revision_count"]),
        }

    @staticmethod
    def _semanticization_to_dict(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "capture_id": row["capture_id"],
            "revision_number": row["revision_number"],
            "revision_hash": row["revision_hash"],
            "source_hash": row["source_hash"],
            "interpreted_by": row["interpreted_by"],
            "schema_version": row["schema_version"],
            "summary": row["summary"],
            "unresolved": json.loads(row["unresolved_json"]),
            "items": json.loads(row["items_json"]),
            "journal_entry": row["journal_entry"],
            "journal_path": row["journal_path"],
            "journal_written": bool(row["journal_written"]),
            "created_at": row["created_at"],
        }

    def _append_journal(self, capture: sqlite3.Row, revision: Mapping[str, Any]) -> Path:
        captured_at = datetime.fromisoformat(capture["captured_at"])
        self._journal_dir.mkdir(parents=True, exist_ok=True)
        path = self._journal_dir / f"{captured_at.date().isoformat()}.md"
        marker = f"<!-- lifeos:brain-dump {capture['capture_id']} {revision['revision_hash']} -->"
        heading = captured_at.strftime("%H:%M")
        entry = f"\n## {heading}\n\n{marker}\n\n{revision['journal_entry']}\n"
        with path.open("a+", encoding="utf-8") as handle:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            handle.seek(0)
            existing = handle.read()
            if not existing:
                handle.write(f"# {captured_at.date().isoformat()}\n")
            if marker not in existing:
                handle.write(entry)
                handle.flush()
                os.fsync(handle.fileno())
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        return path
