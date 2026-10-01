import io
import json
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

from lifeos_cache.adapter import Adapter, DefinitiveFailure, MockThings, SimulatedCrash
from lifeos_cache.api import API
from lifeos_cache.core import Invalid, Store
from lifeos_cache.transport import HTTPGateway, NoRedirect

FIXTURE = [{"id": "t1", "fields": {"title": "Book flight", "notes": "old", "deadline": None, "completed": False}}]
TOKENS = {
    "dot": "fixture-dot-access-only-0000",
    "reviewer": "fixture-review-access-0000",
    "adapter": "fixture-adapter-access-0000",
}


class Harness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.now = "2026-09-30T19:00:00+00:00"
        self.store = Store(self.root / "cloud.sqlite", lambda: self.now)
        self.things = MockThings(FIXTURE)
        self.adapter = Adapter(self.store, self.things, self.root / "mac.sqlite")
        self.adapter.sync()

    def tearDown(self):
        self.adapter.close()
        self.store.close()
        self.temp.cleanup()

    def proposal(self, op_id="p1", fields=None, kind="patch"):
        if fields is None:
            fields = {"title": "Confirm flight"}
        if kind == "create":
            return self.store.propose(op_id, kind, fields, "Europe/London")
        record = self.store.state()["confirmed"][0]
        return self.store.propose(op_id, kind, fields, "Europe/London", "t1", record["revision"])

    def approved(self, **kwargs):
        op = self.proposal(**kwargs)
        return self.store.decide(op["id"], op["revision"], True)

    def restart(self):
        self.adapter.close()
        self.store.close()
        self.store = Store(self.root / "cloud.sqlite", lambda: self.now)
        self.adapter = Adapter(self.store, self.things, self.root / "mac.sqlite")


class CacheTests(Harness):
    def test_draft_never_executes_and_reject_is_final(self):
        op = self.proposal()
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 0)
        self.store.decide(op["id"], op["revision"], False)
        with self.assertRaises(Invalid):
            self.store.decide(op["id"], op["revision"], True)
        self.assertEqual(self.store.pending(), [])

    def test_revision_is_immutable_and_exact_approval_required(self):
        op = self.proposal()
        with self.assertRaises(Invalid):
            self.store.decide("p1", "not-reviewed", True)
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute("UPDATE operations SET content='{}' WHERE id='p1'")
        self.assertEqual(self.store.operation("p1")["revision"], op["revision"])

    def test_offline_pending_survives_restart_and_reconnect(self):
        self.approved()
        self.now = "2026-10-01T19:00:00+00:00"
        self.restart()
        state = self.store.state()
        self.assertEqual(state["adapter_status"], "offline_or_stale")
        self.assertEqual(state["sync_age_seconds"], 86400)
        self.assertEqual(state["confirmed"][0]["fields"]["title"], "Book flight")
        self.assertEqual(state["operations"][0]["state"], "queued")
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "applied")
        self.assertEqual(self.store.state()["confirmed"][0]["fields"]["title"], "Confirm flight")

    def test_same_field_iphone_change_blocks_write(self):
        self.approved()
        self.things.items["t1"]["title"] = "iPhone changed this"
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "conflict")
        self.assertEqual(self.things.writes, 0)
        self.assertEqual(self.things.items["t1"]["title"], "iPhone changed this")

    def test_other_field_change_survives_small_patch(self):
        self.approved()
        self.things.items["t1"]["notes"] = "New iPhone notes"
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "applied")
        self.assertEqual(self.things.items["t1"]["notes"], "New iPhone notes")

    def test_conflict_at_atomic_mock_boundary(self):
        self.approved()
        original = self.things.guarded_patch

        def concurrent(target, base, fields, zone):
            self.things.items[target]["title"] = "Concurrent change"
            return original(target, base, fields, zone)

        self.things.guarded_patch = concurrent
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "conflict")
        self.assertEqual(self.things.writes, 0)

    def test_duplicate_request_after_cache_changed_is_still_idempotent(self):
        op = self.approved()
        self.adapter.run_once()
        repeat = self.store.propose(
            "p1", "patch", {"title": "Confirm flight"}, "Europe/London", "t1", op["content"]["base_revision"]
        )
        self.assertEqual(repeat["state"], "applied")
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 1)
        with self.assertRaises(Invalid):
            self.store.propose(
                "p1", "patch", {"title": "different"}, "Europe/London", "t1", op["content"]["base_revision"]
            )

    def test_claim_cannot_be_stolen_or_issued_without_approval(self):
        self.proposal()
        with self.assertRaises(Invalid):
            self.store.claim("p1", "other")
        self.approved()
        self.store.claim("p1", "one")
        self.assertEqual(self.store.claim("p1", "one")["state"], "executing")
        with self.assertRaises(Invalid):
            self.store.claim("p1", "two")

    def test_ack_retry_is_identical_and_audit_is_append_only(self):
        self.approved()
        self.adapter.run_once()
        op = self.store.operation("p1")
        self.store.acknowledge("p1", op["claim"], op["result"])
        with self.assertRaises(Invalid):
            self.store.acknowledge("p1", op["claim"], {"state": "failed"})
        rows = self.store.db.execute("SELECT event,detail FROM audit ORDER BY n").fetchall()
        self.assertEqual([row["event"] for row in rows], ["proposed", "approved", "claimed", "receipt"])
        receipt = json.loads(rows[-1]["detail"])
        self.assertEqual(receipt["before"]["title"], "Book flight")
        self.assertEqual(receipt["after"]["title"], "Confirm flight")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.db.execute("DELETE FROM audit")

    def test_create_receipt_crash_replay_does_not_duplicate(self):
        self.approved(kind="create")
        with self.assertRaises(SimulatedCrash):
            self.adapter.run_once("before_ack")
        self.assertEqual(self.store.operation("p1")["state"], "executing")
        self.restart()
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 1)
        self.assertEqual(len(self.things.items), 2)
        self.assertEqual(self.store.operation("p1")["state"], "applied")

    def test_create_crash_between_side_effect_and_receipt_requires_reconciliation(self):
        self.approved(kind="create")
        with self.assertRaises(SimulatedCrash):
            self.adapter.run_once("after_write")
        self.restart()
        self.adapter.run_once()
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 1)
        self.assertEqual(self.store.operation("p1")["state"], "uncertain")

    def test_crash_before_write_is_conservative_and_never_reissues(self):
        self.approved()
        with self.assertRaises(SimulatedCrash):
            self.adapter.run_once("before_write")
        self.restart()
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 0)
        self.assertEqual(self.store.operation("p1")["state"], "uncertain")

    def test_patch_crash_after_write_is_uncertain_not_applied_by_value_guess(self):
        self.approved()
        with self.assertRaises(SimulatedCrash):
            self.adapter.run_once("after_write")
        self.restart()
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 1)
        self.assertEqual(self.store.operation("p1")["state"], "uncertain")

    def test_lost_mac_receipts_cannot_steal_an_executing_operation(self):
        self.approved()
        self.store.claim("p1", "old-device")
        self.adapter.run_once()
        self.assertEqual(self.things.writes, 0)
        self.assertEqual(self.store.operation("p1")["state"], "executing")

    def test_snapshot_ack_crash_replays_exact_sequence(self):
        original = self.store.upload

        def lose_ack(*args, **kwargs):
            original(*args, **kwargs)
            raise ConnectionError("lost acknowledgement")

        self.store.upload = lose_ack
        self.now = "2026-09-30T19:01:00+00:00"
        with self.assertRaises(ConnectionError):
            self.adapter.sync()
        self.store.upload = original
        self.restart()
        self.adapter.sync()
        self.assertEqual(self.store.db.execute("SELECT sequence FROM sync").fetchone()[0], 2)
        self.assertEqual(self.adapter.local.execute("SELECT count(*) FROM uploads WHERE delivered=0").fetchone()[0], 0)

    def test_stale_snapshot_and_reused_sequence_are_rejected(self):
        with self.assertRaises(Invalid):
            self.store.upload(1, self.now, [])
        self.store.upload(2, self.now, FIXTURE)
        with self.assertRaises(Invalid):
            self.store.upload(1, self.now, FIXTURE)
        with self.assertRaises(Invalid):
            self.store.upload(3, "2026-09-29T19:00:00+00:00", FIXTURE)
        with self.assertRaises(Invalid):
            self.store.upload(3, "2026-10-01T19:00:00+00:00", FIXTURE)

    def test_deletion_blocks_pending_edit_and_keeps_tombstone(self):
        self.approved()
        del self.things.items["t1"]
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "conflict")
        self.assertTrue(self.store.state()["confirmed"][0]["deleted"])
        self.assertEqual(self.things.writes, 0)
        with self.assertRaises(Invalid):
            self.proposal("p2")

    def test_definitive_failure_vs_ambiguous_command_failure(self):
        self.approved()
        self.things.failure = DefinitiveFailure("do not expose private command")
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "failed")
        self.approved(op_id="p2")
        self.things.failure = TimeoutError("private URL must never leak")
        self.adapter.run_once()
        result = self.store.operation("p2")["result"]
        self.assertEqual(result["state"], "uncertain")
        self.assertNotIn("private URL", json.dumps(result))

    def test_postwrite_verification_mismatch_is_uncertain(self):
        self.approved()
        original = self.things.guarded_patch

        def mismatch(*args):
            item = original(*args)
            self.things.items["t1"]["title"] = "changed immediately"
            return item

        self.things.guarded_patch = mismatch
        self.adapter.run_once()
        self.assertEqual(self.store.operation("p1")["state"], "uncertain")

    def test_date_timezone_and_field_allowlist(self):
        op = self.approved(fields={"deadline": "2026-10-25"})
        self.adapter.run_once()
        self.assertEqual(op["content"]["zone"], "Europe/London")
        self.assertEqual(self.things.items["t1"]["deadline"], "2026-10-25")
        for fields in [{"deadline": "tomorrow"}, {"completed": "true"}, {"script": "rm"}]:
            with self.assertRaises(ValueError):
                self.proposal("invalid", fields)
        with self.assertRaises(ValueError):
            self.store.upload(3, "2026-09-30T19:00:00", FIXTURE)

    def test_stale_base_revision_and_unobserved_field_block_proposal(self):
        with self.assertRaises(Invalid):
            self.store.propose("p1", "patch", {"title": "x"}, "Etc/UTC", "t1", "stale")
        self.store.upload(2, self.now, [{"id": "t1", "fields": {"title": "partial data"}}])
        with self.assertRaises(Invalid):
            self.proposal(fields={"notes": "unobserved"})

    def test_backup_restore_keeps_receipts_and_pending(self):
        self.approved()
        backup = self.root / "backup.sqlite"
        self.store.backup(backup)
        restored = Store(backup, lambda: self.now)
        try:
            self.assertEqual(restored.operation("p1")["state"], "queued")
            self.assertEqual(restored.db.execute("PRAGMA integrity_check").fetchone()[0], "ok")
        finally:
            restored.close()


class APITests(Harness):
    def test_real_loopback_transport_claim_write_and_receipt(self):
        class Quiet(WSGIRequestHandler):
            def log_message(self, *args):
                pass

        app = API(self.store, TOKENS)
        with make_server("127.0.0.1", 0, app, handler_class=Quiet) as server:
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                gateway = HTTPGateway(f"http://127.0.0.1:{server.server_port}", TOKENS["adapter"])
                # Gateway timestamps reflect the adapter clock, not cloud processing time.
                gateway.clock = lambda: self.now
                self.adapter.cloud = gateway
                op = self.proposal()
                self.store.decide(op["id"], op["revision"], True)
                self.adapter.run_once()
                self.assertEqual(self.store.operation("p1")["state"], "applied")
                self.assertEqual(self.things.writes, 1)
            finally:
                server.shutdown()
                thread.join(timeout=2)
                self.assertFalse(thread.is_alive())

    def test_transport_refuses_insecure_hosts_and_redirects(self):
        for origin in [
            "http://example.org",
            "https://secret@example.org",
            "https://example.org/redirect",
            "https://example.org?token=x",
        ]:
            with self.assertRaises(Invalid):
                HTTPGateway(origin, TOKENS["adapter"])
        with self.assertRaises(Invalid):
            NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://elsewhere.org")

    def call(self, method, path, role=None, body=None, headers=None):
        app = API(self.store, TOKENS)
        raw = json.dumps(body).encode() if body is not None else b""
        env = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw),
        }
        if role:
            env["HTTP_AUTHORIZATION"] = "Bearer " + TOKENS[role]
        env.update(headers or {})
        captured = []
        response = b"".join(app(env, lambda status, headers: captured.append((status, headers))))
        return int(captured[0][0].split()[0]), response

    def test_auth_role_separation_and_no_header_identity_spoofing(self):
        self.assertEqual(self.call("GET", "/state")[0], 401)
        self.assertEqual(self.call("GET", "/state", headers={"HTTP_OAI_AUTHENTICATED_USER_ID": "owner"})[0], 401)
        op = self.proposal()
        body = {"op_id": "p1", "revision": op["revision"]}
        self.assertEqual(self.call("POST", "/approve", "dot", body)[0], 403)
        self.assertEqual(self.call("POST", "/approve", "adapter", body)[0], 403)
        self.assertEqual(self.call("POST", "/approve", "reviewer", body)[0], 200)
        self.assertEqual(self.call("GET", "/adapter/pending", "adapter")[0], 200)

    def test_no_command_endpoint_no_demo_in_normal_api(self):
        for route in ["/exec", "/shell", "/demo/reconnect"]:
            self.assertEqual(self.call("POST", route, "reviewer", {"command": "echo"})[0], 404)

    def test_complete_inventory_required_and_invalid_json_is_contained(self):
        self.assertEqual(
            self.call("POST", "/adapter/snapshot", "adapter", {"sequence": 2, "observed_at": self.now, "items": []})[0],
            409,
        )
        self.assertFalse(self.store.state()["confirmed"][0]["deleted"])
        self.assertEqual(
            self.call(
                "POST",
                "/adapter/snapshot",
                "adapter",
                {"sequence": 2, "observed_at": self.now, "items": [], "complete": True},
            )[0],
            200,
        )
        self.assertEqual(self.call("POST", "/proposals", "dot", ["wrong"])[0], 409)

    def test_oversized_request_rejected(self):
        self.assertEqual(self.call("POST", "/proposals", "dot", headers={"CONTENT_LENGTH": "99999999"})[0], 413)


if __name__ == "__main__":
    unittest.main()
