"""Mac adapter boundary. Fixtures only; no Things imports, DB reads or commands."""

from __future__ import annotations

import copy
import json
import sqlite3
import uuid
from pathlib import Path
from typing import Protocol

from .core import Json, encode, utcnow
from .transport import Gateway


class Conflict(Exception):
    pass


class DefinitiveFailure(Exception):
    """Only for errors for which the backend guarantees no side effect."""


class SimulatedCrash(BaseException):
    pass


class ThingsAutomation(Protocol):
    def inventory(self) -> list[Json]: ...
    def read(self, target: str) -> Json | None: ...
    def guarded_patch(self, target: str, base: Json, fields: Json, zone: str) -> Json: ...
    def create(self, fields: Json, zone: str) -> Json: ...


class MockThings:
    """Atomic compare-and-patch is a MOCK guarantee, unavailable in Things URL API."""

    def __init__(self, items: list[Json]):
        self.items = {item["id"]: copy.deepcopy(item["fields"]) for item in items}
        self.writes = 0
        self.failure = None

    def inventory(self) -> list[Json]:
        return [{"id": key, "fields": copy.deepcopy(fields)} for key, fields in self.items.items()]

    def read(self, target: str) -> Json | None:
        return copy.deepcopy(self.items.get(target))

    def guarded_patch(self, target: str, base: Json, fields: Json, zone: str) -> Json:
        current = self.read(target)
        if current is None or any(current.get(key) != value for key, value in base.items()):
            raise Conflict("same field changed or item deleted")
        self._fail()
        self.items[target].update(copy.deepcopy(fields))
        self.writes += 1
        return {"id": target, "fields": self.read(target)}

    def create(self, fields: Json, zone: str) -> Json:
        self._fail()
        target = str(uuid.uuid4())
        self.items[target] = copy.deepcopy(fields)
        self.writes += 1
        return {"id": target, "fields": self.read(target)}

    def _fail(self):
        if self.failure:
            raise self.failure


class SupportedMacAutomation:
    """Deliberately disconnected until a separately approved supported-API test.

    Use fixed AppleScript/Shortcuts templates, structured parameters and fresh
    supported reads. Never delegate raw shell/script/URL text from a cloud request.
    Things has no CAS API: strict concurrent-iPhone protection remains a live gate.
    """

    def __getattr__(self, name):
        raise DefinitiveFailure("live Things automation is not configured")


class Adapter:
    def __init__(self, cloud: Gateway, things: ThingsAutomation, receipt_path: str | Path):
        self.cloud = cloud  # A transport facade can expose these same methods over HTTP.
        self.things = things
        self.local = sqlite3.connect(receipt_path, isolation_level=None)
        self.local.execute("PRAGMA journal_mode=WAL")
        self.local.execute("PRAGMA synchronous=FULL")
        self.local.executescript("""
            CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,claim TEXT NOT NULL,
                intent TEXT NOT NULL,result TEXT);
            CREATE TABLE IF NOT EXISTS uploads(sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
        """)

    def close(self):
        self.local.close()

    def sync(self):
        # Persist the exact upload before sending. Replay lost acknowledgements
        # before taking a newer inventory; sequence survives process restart.
        pending = self.local.execute(
            "SELECT sequence,payload FROM uploads WHERE delivered=0 ORDER BY sequence"
        ).fetchall()
        if not pending:
            payload = encode({"observed_at": self.cloud.clock(), "items": self.things.inventory()})
            cursor = self.local.execute("INSERT INTO uploads(payload) VALUES(?)", (payload,))
            pending = [(cursor.lastrowid, payload)]
        for sequence, payload in pending:
            self.cloud.upload(sequence, **json.loads(payload))
            self.local.execute("UPDATE uploads SET delivered=1 WHERE sequence=?", (sequence,))

    def run_once(self, crash: str | None = None):
        for op in self.cloud.pending():
            saved = self.local.execute("SELECT claim,intent,result FROM receipts WHERE id=?", (op["id"],)).fetchone()
            if saved:
                claim, _, result_text = saved
                if op["state"] == "queued":
                    self.cloud.claim(op["id"], claim)
                result = (
                    json.loads(result_text)
                    if result_text
                    else {
                        "state": "uncertain",
                        "reason": "crash after durable intent; inspect Things before a new proposal",
                    }
                )
                self.cloud.acknowledge(op["id"], claim, result)
                continue
            if op["state"] == "executing":
                # Lost local journal / another adapter. Never steal a lease.
                continue
            claim = str(uuid.uuid4())
            self.local.execute("INSERT INTO receipts VALUES(?,?,?,NULL)", (op["id"], claim, encode(op)))
            self.cloud.claim(op["id"], claim)
            if crash == "before_write":
                raise SimulatedCrash()
            content = op["content"]
            before = None
            try:
                if content["kind"] == "patch":
                    before = self.things.read(content["target"])
                    if before is None or any(before.get(k) != v for k, v in content["base"].items()):
                        raise Conflict("same field changed or item deleted")
                    item = self.things.guarded_patch(
                        content["target"], content["base"], content["fields"], content["zone"]
                    )
                else:
                    item = self.things.create(content["fields"], content["zone"])
                if crash == "after_write":
                    raise SimulatedCrash()
                after = self.things.read(item["id"])
                if after is None or any(after.get(k) != v for k, v in content["fields"].items()):
                    result = {"state": "uncertain", "reason": "post-write verification mismatch"}
                else:
                    result = {
                        "state": "applied",
                        "target": item["id"],
                        "before": before,
                        "after": after,
                        "verified_at": utcnow(),
                        "confirmation_scope": "Mac Things read; not iPhone sync",
                    }
            except Conflict:
                result = {"state": "conflict", "before": before, "reason": "same field changed or target deleted"}
            except DefinitiveFailure:
                result = {"state": "failed", "reason": "command rejected before any side effect"}
            except Exception:  # noqa: BLE001 -- an unknown automation failure must never trigger replay
                result = {"state": "uncertain", "reason": "automation error; outcome unknown"}
            self.local.execute("UPDATE receipts SET result=? WHERE id=?", (encode(result), op["id"]))
            if crash == "before_ack":
                raise SimulatedCrash()
            self.cloud.acknowledge(op["id"], claim, result)
        self.sync()
