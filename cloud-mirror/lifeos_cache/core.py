from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

Json = dict[str, Any]
FIELDS = {"title", "notes", "deadline", "completed"}
TERMINAL = {"applied", "conflict", "failed", "uncertain", "rejected"}


class Invalid(ValueError):
    pass


def encode(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(encode(value).encode()).hexdigest()


def utcnow() -> str:
    return datetime.now(UTC).isoformat()


def timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise Invalid("timestamp requires an offset")
    return parsed


def validate_fields(fields: Json) -> None:
    if not isinstance(fields, dict) or not fields or set(fields) - FIELDS:
        raise Invalid("unsupported or empty fields")
    for key, value in fields.items():
        if key in {"title", "notes"} and (not isinstance(value, str) or len(value) > 4000):
            raise Invalid("text must contain at most 4000 characters")
        if key == "completed" and not isinstance(value, bool):
            raise Invalid("completed must be boolean")
        if (
            key == "deadline"
            and value is not None
            and (not isinstance(value, str) or date.fromisoformat(value).isoformat() != value)
        ):
            raise Invalid("deadline must be YYYY-MM-DD or null")


class Store:
    """Single owner, single gateway process; atomic SQLite transactions.

    IDs and operation content are immutable. Only explicit user approval queues
    an operation. Executing operations are never automatically reissued.
    """

    def __init__(self, path: str | Path, clock=utcnow):
        self.clock = clock
        self.lock = threading.RLock()
        self.db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            PRAGMA foreign_keys=ON;
            PRAGMA busy_timeout=5000;
            CREATE TABLE IF NOT EXISTS snapshots (
                id TEXT PRIMARY KEY, data TEXT NOT NULL, revision TEXT NOT NULL,
                deleted INTEGER NOT NULL, observed_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS sync (
                singleton INTEGER PRIMARY KEY CHECK(singleton=1), sequence INTEGER NOT NULL,
                payload_hash TEXT NOT NULL, received_at TEXT NOT NULL, observed_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS operations (
                id TEXT PRIMARY KEY, content TEXT NOT NULL, revision TEXT NOT NULL,
                state TEXT NOT NULL, claim TEXT, result TEXT);
            CREATE TABLE IF NOT EXISTS audit (
                n INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL,
                event TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS immutable_content
                BEFORE UPDATE OF content, revision, id ON operations
                BEGIN SELECT RAISE(ABORT, 'immutable operation'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_audit_update BEFORE UPDATE ON audit
                BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
            CREATE TRIGGER IF NOT EXISTS immutable_audit_delete BEFORE DELETE ON audit
                BEGIN SELECT RAISE(ABORT, 'immutable audit'); END;
        """)

    def close(self) -> None:
        self.db.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                yield self.db
                self.db.execute("COMMIT")
            except BaseException:
                self.db.execute("ROLLBACK")
                raise

    def audit(self, db, op_id: str, event: str, detail: Any) -> None:
        db.execute(
            "INSERT INTO audit(operation_id,event,detail,at) VALUES(?,?,?,?)",
            (op_id, event, encode(detail), self.clock()),
        )

    def upload(self, sequence: int, observed_at: str, items: list[Json]) -> Json:
        if type(sequence) is not int or sequence < 1 or not isinstance(items, list):
            raise Invalid("positive sequence and complete items list required")
        observed = timestamp(observed_at)
        if observed > timestamp(self.clock()):
            raise Invalid("future snapshot timestamp")
        normalized = {}
        for item in items:
            if set(item) != {"id", "fields"} or not isinstance(item["id"], str) or not item["id"]:
                raise Invalid("invalid snapshot item")
            if item["id"] in normalized:
                raise Invalid("duplicate snapshot ID")
            validate_fields(item["fields"])
            normalized[item["id"]] = item["fields"]
        payload_hash = digest({"items": normalized, "observed_at": observed_at})
        with self.tx() as db:
            prior = db.execute("SELECT * FROM sync").fetchone()
            if prior and sequence <= prior["sequence"]:
                if sequence == prior["sequence"] and payload_hash == prior["payload_hash"]:
                    return {"duplicate": True}
                raise Invalid("stale or reused snapshot sequence")
            if prior and observed < timestamp(prior["observed_at"]):
                raise Invalid("snapshot observation moved backwards")
            # Only this COMPLETE inventory API infers deletion from absence.
            for row in db.execute("SELECT id,data FROM snapshots").fetchall():
                if row["id"] not in normalized:
                    db.execute("UPDATE snapshots SET deleted=1, observed_at=? WHERE id=?", (observed_at, row["id"]))
            for item_id, fields in normalized.items():
                db.execute(
                    """INSERT INTO snapshots VALUES(?,?,?,?,?) ON CONFLICT(id)
                    DO UPDATE SET data=excluded.data, revision=excluded.revision,
                    deleted=0, observed_at=excluded.observed_at""",
                    (item_id, encode(fields), digest(fields), 0, observed_at),
                )
            db.execute(
                "INSERT OR REPLACE INTO sync VALUES(1,?,?,?,?)", (sequence, payload_hash, self.clock(), observed_at)
            )
        return {"duplicate": False}

    def propose(
        self,
        op_id: str,
        kind: str,
        fields: Json,
        zone: str,
        target: str | None = None,
        base_revision: str | None = None,
    ) -> Json:
        if not isinstance(op_id, str) or not 1 <= len(op_id) <= 128:
            raise Invalid("operation ID required; it is also the idempotency key")
        if kind not in {"patch", "create"}:
            raise Invalid("only patch and create are supported; delete is disabled")
        validate_fields(fields)
        ZoneInfo(zone)  # Civil Things dates retain the reviewed IANA timezone.
        with self.tx() as db:
            existing = db.execute("SELECT * FROM operations WHERE id=?", (op_id,)).fetchone()
            # Compare request inputs before consulting a now-changed cache.
            if existing:
                content = json.loads(existing["content"])
                inputs = {
                    "kind": kind,
                    "fields": fields,
                    "zone": zone,
                    "target": target,
                    "base_revision": base_revision,
                }
                if any(content[k] != v for k, v in inputs.items()):
                    raise Invalid("idempotency key reused with different content")
                return self._operation(existing)
            base = None
            if kind == "patch":
                row = db.execute("SELECT * FROM snapshots WHERE id=?", (target,)).fetchone()
                if not row or row["deleted"] or row["revision"] != base_revision:
                    raise Invalid("base revision missing, deleted or stale")
                data = json.loads(row["data"])
                if set(fields) - set(data):
                    raise Invalid("cannot edit an unobserved field")
                base = {key: data[key] for key in fields}
            elif target is not None or base_revision is not None or not fields.get("title"):
                raise Invalid("create needs a title and no existing target")
            content = {
                "kind": kind,
                "fields": fields,
                "zone": zone,
                "target": target,
                "base_revision": base_revision,
                "base": base,
            }
            revision = digest({"id": op_id, "content": content})
            db.execute("INSERT INTO operations VALUES(?,?,?,'draft',NULL,NULL)", (op_id, encode(content), revision))
            self.audit(db, op_id, "proposed", content)
        return self.operation(op_id)

    @staticmethod
    def _operation(row) -> Json:
        return {
            "id": row["id"],
            "revision": row["revision"],
            "state": row["state"],
            "content": json.loads(row["content"]),
            "claim": row["claim"],
            "result": json.loads(row["result"]) if row["result"] else None,
        }

    def operation(self, op_id: str) -> Json:
        with self.lock:
            row = self.db.execute("SELECT * FROM operations WHERE id=?", (op_id,)).fetchone()
            if not row:
                raise Invalid("unknown operation")
            return self._operation(row)

    def decide(self, op_id: str, revision: str, approve: bool) -> Json:
        with self.tx() as db:
            op = self.operation(op_id)
            if op["revision"] != revision:
                raise Invalid("approval must match the immutable reviewed revision")
            desired = "queued" if approve else "rejected"
            if op["state"] == desired:
                return op
            if op["state"] != "draft":
                raise Invalid("decision cannot change after approval or rejection")
            db.execute("UPDATE operations SET state=? WHERE id=?", (desired, op_id))
            self.audit(db, op_id, "approved" if approve else "rejected", {"revision": revision})
        return self.operation(op_id)

    def pending(self) -> list[Json]:
        with self.lock:
            return [
                self._operation(row)
                for row in self.db.execute(
                    "SELECT * FROM operations WHERE state IN ('queued','executing') ORDER BY rowid"
                )
            ]

    def claim(self, op_id: str, claim_id: str) -> Json:
        if not isinstance(claim_id, str) or not claim_id:
            raise Invalid("claim ID required")
        with self.tx() as db:
            op = self.operation(op_id)
            if op["state"] == "executing" and op["claim"] == claim_id:
                return op
            if op["state"] != "queued":
                raise Invalid("operation already claimed or not approved")
            db.execute("UPDATE operations SET state='executing',claim=? WHERE id=?", (claim_id, op_id))
            self.audit(db, op_id, "claimed", {"claim": claim_id})
        return self.operation(op_id)

    def acknowledge(self, op_id: str, claim_id: str, result: Json) -> Json:
        if not isinstance(result, dict) or result.get("state") not in TERMINAL - {"rejected"}:
            raise Invalid("invalid result state")
        if result["state"] == "applied" and not {"before", "after", "target"} <= set(result):
            raise Invalid("applied requires a verified before/after receipt")
        with self.tx() as db:
            op = self.operation(op_id)
            if op["claim"] != claim_id:
                raise Invalid("claim mismatch")
            if op["state"] in TERMINAL:
                if op["result"] == result:
                    return op
                raise Invalid("terminal receipt cannot be rewritten")
            if op["state"] != "executing":
                raise Invalid("unclaimed operation")
            db.execute("UPDATE operations SET state=?,result=? WHERE id=?", (result["state"], encode(result), op_id))
            self.audit(db, op_id, "receipt", result)
            # Receipt is audit evidence. Cache changes only on a complete Things read.
        return self.operation(op_id)

    def state(self) -> Json:
        with self.lock:
            sync = self.db.execute("SELECT * FROM sync").fetchone()
            age = (
                None if not sync else max(0, (timestamp(self.clock()) - timestamp(sync["observed_at"])).total_seconds())
            )
            return {
                "source": "last-synced Things snapshot; not ThingsCloud",
                "last_sync_at": sync["observed_at"] if sync else None,
                "last_received_at": sync["received_at"] if sync else None,
                "sync_age_seconds": age,
                "adapter_status": "recent" if age is not None and age < 120 else "offline_or_stale",
                "confirmed": [
                    {
                        "id": row["id"],
                        "fields": json.loads(row["data"]),
                        "revision": row["revision"],
                        "deleted": bool(row["deleted"]),
                    }
                    for row in self.db.execute("SELECT * FROM snapshots ORDER BY id")
                ],
                "operations": [
                    self._operation(row) for row in self.db.execute("SELECT * FROM operations ORDER BY rowid")
                ],
            }

    def backup(self, destination: str | Path) -> None:
        # The caller chooses a local path; no remote arbitrary-path endpoint.
        with self.lock:
            output = sqlite3.connect(destination)
            try:
                self.db.backup(output)
            finally:
                output.close()
