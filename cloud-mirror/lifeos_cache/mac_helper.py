"""One-shot, stdlib-only helper. No daemon, credentials or live access by default."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import random
import sqlite3
import subprocess
import time
from pathlib import Path

from .core import Invalid, digest, encode, utcnow
from .credentials import load_credentials, load_worker_credential
from .transport import HTTPGateway
WORKER_USER_AGENT = "LifeOSReadOnlyMirror/0.1"


class ThingsReader:
    def __init__(self, app_path: str, *, permit_read=False, permit_write=False, allowed_write_ids=None, runner=subprocess.run):
        self.app_path, self.permit_read, self.permit_write, self.runner = app_path, permit_read, permit_write, runner
        self.deadline = None
        self.allowed_write_ids = allowed_write_ids

    def call(self, action, **params):
        if not self.permit_read or action == "patch" and not self.permit_write:
            raise Invalid("live automation is not approved/configured")
        timeout = min(45, self.deadline-time.monotonic()) if self.deadline else 45
        if timeout<=0:
            raise Invalid("pass budget exhausted")
        # Structured argv, no shell or script interpolation. Do not report task/error output.
        result = self.runner(["/usr/bin/osascript", "-l", "JavaScript", str(Path(__file__).with_name("things_read.js"))],
                             input=encode({"app_path": self.app_path, "action": action, "allow_write": self.permit_write, **params}),
                             capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode:
            raise Invalid("supported automation failed; no task contents logged")
        return json.loads(result.stdout)

    def inventory(self):
        before = self.classify()
        result = self.call("inventory", classifications=before)
        if before != self.classify():
            raise Invalid("public classification changed during scan; no upload")
        return result

    def classify(self):
        if not self.permit_read:
            raise Invalid("live automation is not approved/configured")
        timeout = min(45, self.deadline-time.monotonic()) if self.deadline else 45
        if timeout <= 0:
            raise Invalid("pass budget exhausted")
        result = self.runner(["/usr/bin/osascript", str(Path(__file__).with_name("things_classify.applescript")), self.app_path],
                             capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode:
            raise Invalid("public classification failed; no task contents logged")
        rows = json.loads(result.stdout)
        if not isinstance(rows, list) or len(rows)>50000:
            raise Invalid("public classification exceeds safety budget")
        kinds = {}
        for row in rows:
            if not isinstance(row, list) or len(row)!=2 or not isinstance(row[0], str) or not row[0]:
                raise Invalid("invalid public classification")
            kind = {"to do":"todo", "selected to do":"todo", "project":"project"}.get(row[1])
            if not kind or row[0] in kinds and kinds[row[0]] != kind:
                raise Invalid("unknown or inconsistent public class; no upload")
            kinds[row[0]] = kind
        return kinds

    def read(self, target, kind):
        return self.call("read", target=target, kind=kind)

    def patch(self, content):
        if len(content["fields"]) != 1 or set(content["fields"]) - {"title", "notes"}:
            raise Invalid("first-phase writer permits one title/notes field only")
        if self.allowed_write_ids is not None and content.get("target") not in self.allowed_write_ids:
            raise Invalid("target is outside the approved live-test allowlist")
        return self.call("patch", target=content["target"], kind=content["kind"],
                         base=content["base"], fields=content["fields"])


class SiteGateway(HTTPGateway):
    """Dispatcher bearer and independently scoped app key stay in process memory."""
    def __init__(self, origin, dispatcher_token, sync_key):
        super().__init__(origin, sync_key)
        self.dispatcher_token = dispatcher_token
        self.deadline = None

    def headers(self):
        return {"OAI-Sites-Authorization": "Bearer " + self.dispatcher_token,
                "X-LifeOS-Sync-Key": self.token, "Content-Type": "application/json"}

    def request(self, path, body=None):
        from urllib.request import Request
        request = Request(self.origin + "/api/sync/" + path, data=encode(body).encode() if body is not None else None,
                          headers=self.headers())
        timeout = min(15, self.deadline-time.monotonic()) if self.deadline else 15
        if timeout<=0:
            raise Invalid("pass budget exhausted")
        with self.client.open(request, timeout=timeout) as response:
            raw = response.read(1024 * 1024 + 1)
            if len(raw) > 1024 * 1024:
                raise Invalid("gateway response exceeds limit")
            return json.loads(raw)


class ConfiguredSiteGateway(SiteGateway):
    """Load stored credentials at first request, after persisted backoff check."""
    def __init__(self, config, loader=load_credentials):
        super().__init__(config["origin"], "", "")  # Validate origin before reading.
        self.config, self.loader, self.loaded = config, loader, False

    def request(self, path, body=None):
        if not self.loaded:
            self.dispatcher_token, self.token = self.loader(self.config, deadline=self.deadline)
            self.loaded = True
        return super().request(path, body)


class ConfiguredWorkerGateway(SiteGateway):
    """Standalone Worker needs one scoped upload key; no Sites dispatcher key."""
    def __init__(self, config, loader=load_worker_credential):
        if config.get("approved_write"):
            raise Invalid("Worker first connection is read-only")
        super().__init__(config["origin"], "", "")
        self.config, self.loader, self.loaded = config, loader, False

    def headers(self):
        return {"X-LifeOS-Sync-Key":self.token,"Content-Type":"application/json","User-Agent":WORKER_USER_AGENT}

    def request(self, path, body=None):
        if path not in {"begin", "page", "commit"}:
            raise Invalid("Worker transport permits snapshots only")
        if not self.loaded:
            self.token = self.loader(self.config, deadline=self.deadline)
            self.loaded = True
        return super().request(path, body)


class Helper:
    def __init__(self, journal, cloud, reader, clock=time.time, jitter=random.random):
        journal=Path(journal)
        if not journal.exists():
            descriptor=os.open(journal,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
            os.close(descriptor)
        if journal.stat().st_mode & 0o077 or journal.stat().st_uid != os.getuid():
            raise Invalid("journal must be owned by this user with mode 0600")
        self.db = sqlite3.connect(journal, isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS uploads(seq INTEGER PRIMARY KEY AUTOINCREMENT,manifest TEXT,pages TEXT,delivered INTEGER DEFAULT 0);
          CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,claim TEXT,intent TEXT,result TEXT);
          CREATE TABLE IF NOT EXISTS schedule(n INTEGER PRIMARY KEY CHECK(n=1),failures INTEGER,next_at REAL,last_at REAL);
        """)
        self.cloud, self.reader, self.clock, self.jitter = cloud, reader, clock, jitter

    def close(self):
        self.db.close()

    def upload(self):
        row = self.db.execute("SELECT * FROM uploads WHERE delivered=0 ORDER BY seq LIMIT 1").fetchone()
        if not row:
            inventory = self.reader.inventory()
            items = inventory["items"]
            if len({i["id"] for i in items}) != len(items) or len(items) > 10000:
                raise Invalid("duplicate IDs or inventory exceeds tested limit; never truncate")
            if len(encode(items).encode()) > 8*1024*1024:
                raise Invalid("inventory exceeds 8 MiB safety budget; never truncate")
            pages, page=[], []
            for item in items:
                if len(encode([item]).encode())>240*1024:
                    raise Invalid("item exceeds upload budget; never truncate")
                if page and (len(page)>=100 or len(encode(page+[item]).encode())>240*1024):
                    pages.append(page)
                    page=[]
                page.append(item)
            if page or not pages:
                pages.append(page)
            if len(pages)>100:
                raise Invalid("inventory exceeds page budget; never truncate")
            manifest = {"observed_at": utcnow(), "zone": inventory["zone"], "scopes": inventory["scopes"],
                        "count": len(items), "page_hashes": [digest(p) for p in pages], "coverage": inventory["coverage"]}
            if "coverage_evidence" in inventory:
                manifest["coverage_evidence"] = inventory["coverage_evidence"]
            self.db.execute("INSERT INTO uploads(manifest,pages) VALUES(?,?)", (encode(manifest), encode(pages)))
            row = self.db.execute("SELECT * FROM uploads WHERE delivered=0 ORDER BY seq LIMIT 1").fetchone()
        manifest, pages, seq = json.loads(row["manifest"]), json.loads(row["pages"]), row["seq"]
        self.cloud.request("begin", {"sequence": seq, "manifest": manifest})
        for n, page in enumerate(pages):
            self.cloud.request("page", {"sequence": seq, "page": n, "items": page})
        self.cloud.request("commit", {"sequence": seq})
        self.db.execute("UPDATE uploads SET delivered=1 WHERE seq=?", (seq,))

    def apply(self, *, writes=False, crash=None):
        if not writes:
            return  # Read-only initial rollout never claims an approved operation.
        for op in self.cloud.request("pending"):
            saved = self.db.execute("SELECT * FROM receipts WHERE id=?", (op["id"],)).fetchone()
            if saved:
                result = json.loads(saved["result"]) if saved["result"] else {"state": "uncertain", "reason": "durable intent without receipt; no replay"}
                self.cloud.request("claim", {"id": op["id"], "claim": saved["claim"]})
                self.cloud.request("ack", {"id": op["id"], "claim": saved["claim"], "result": result})
                continue
            if op["state"] != "queued":
                continue
            import uuid
            claim = str(uuid.uuid4())
            self.db.execute("INSERT INTO receipts VALUES(?,?,?,NULL)", (op["id"], claim, encode(op)))
            self.cloud.request("claim", {"id": op["id"], "claim": claim})
            if crash == "before_write":
                raise InterruptedError("fixture crash")
            c, before = op["content"], None
            try:
                before = self.reader.read(c["target"], c["kind"])
                if any(before["fields"].get(k) != v for k,v in c["base"].items()):
                    result = {"state": "conflict", "reason": "fresh source field differs", "before": before}
                else:
                    written = self.reader.patch(c)
                    if crash == "after_write":
                        raise InterruptedError("fixture crash")
                    after = self.reader.read(c["target"], c["kind"])
                    okay = written["state"] == "applied" and all(after["fields"].get(k) == {"state": "value", "value": v} for k,v in c["fields"].items())
                    result = {"state": "applied" if okay else written["state"] if written["state"] == "conflict" else "uncertain",
                              "before": before, "after": after, "scope": "Mac supported read only; not iPhone sync"}
            except InterruptedError:
                raise
            except Exception:
                result = {"state": "uncertain", "reason": "automation outcome unknown; no replay"}
            self.db.execute("UPDATE receipts SET result=? WHERE id=?", (encode(result), op["id"]))
            if crash == "before_ack":
                raise InterruptedError("fixture crash")
            self.cloud.request("ack", {"id": op["id"], "claim": claim, "result": result})

    def once(self, *, wake=False, writes=False):
        now = self.clock()
        row = self.db.execute("SELECT * FROM schedule").fetchone()
        # Wake bypasses the normal five-minute period, never an active failure backoff.
        if row and now < row["next_at"] and not (wake and row["failures"] == 0 and now-row["last_at"] >= 30):
            return "idle"
        try:
            deadline=time.monotonic()+90
            self.cloud.deadline=self.reader.deadline=deadline
            self.upload()  # Fresh snapshot before processing approved operations.
            self.apply(writes=writes)
            if writes:
                self.upload()
        except Exception:
            failures = min(10, (row["failures"] if row else 0)+1)
            delay = min(3600, 30*2**(failures-1))*(1+self.jitter()*0.2)
            self.db.execute("INSERT OR REPLACE INTO schedule VALUES(1,?,?,?)", (failures, now+delay, now))
            return "retry_later"  # Safe status only; no request/error/secret logging.
        self.db.execute("INSERT OR REPLACE INTO schedule VALUES(1,0,?,?)", (now+300, now))
        return "synced"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--wake", action="store_true")
    args = parser.parse_args()
    if args.config.stat().st_mode & 0o077 or args.config.stat().st_uid != os.getuid():
        raise SystemExit("Config must be owned by this user with mode 0600")
    config = json.loads(args.config.read_text())
    if not config.get("approved_read"):
        raise SystemExit("Read access is not approved/configured")
    config_path = args.config.resolve()
    with open(str(config_path)+".lock", "a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            return
        try:
            cloud = ConfiguredWorkerGateway(config) if config.get("backend")=="cloudflare" else ConfiguredSiteGateway(config)
            reader = ThingsReader(config["app_path"], permit_read=True, permit_write=config.get("approved_write", False),
                                  allowed_write_ids=config.get("write_allowlist"))
            helper = Helper(config["journal"], cloud, reader)
            try:
                outcome=helper.once(wake=args.wake, writes=config.get("approved_write", False))
                if outcome=="retry_later":
                    print(outcome)  # No routine success/idle logs or notifications.
            finally:
                helper.close()
        except Exception:
            raise SystemExit("Helper unavailable; no sensitive details logged") from None


if __name__ == "__main__":
    main()
