"""BanaGateway and the note tools against a disposable `bana serve --sample`.

Set BANA_BIN to a built `bana` CLI (cargo build -p bana-cli). Each test gets its own BANA_HOME,
graph file and port, so the real ~/Bana is never touched. Without BANA_BIN only the tests that
need no running app run.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
from pathlib import Path

import pytest
from fastmcp import Client

from lifeos.bana_gateway import (
    ALLOWED_COMMANDS,
    NEVER_COMMANDS,
    NEVER_PREFIXES,
    BanaGateway,
    BanaNotPermitted,
    BanaUnavailable,
)
from lifeos.brain_dump_store import BrainDumpStore
from lifeos.proposal_store import IdempotencyConflict, ProposalStore
from lifeos.server import create_mcp
from lifeos.service import LifeOSService

BANA_BIN = os.environ.get("BANA_BIN")
needs_bana = pytest.mark.skipif(not BANA_BIN, reason="set BANA_BIN to a built bana CLI")


class NoThings:
    def read_todo(self, _todo_id):
        return None


@pytest.fixture
def bana(tmp_path):
    home = tmp_path / "bana-home"
    home.mkdir()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        [BANA_BIN, "--file", str(home / "graph.bana"), "serve", "--sample", "--port", str(port),
         "--today", "2026-10-10"],
        env={**os.environ, "BANA_HOME": str(home)},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    gateway = BanaGateway(home)
    for _ in range(100):
        if gateway.available():
            break
        time.sleep(0.05)
    else:
        process.kill()
        pytest.fail("bana serve did not start")
    yield gateway, home
    process.terminate()
    process.wait(5)


def service_for(tmp_path, gateway, things=None):
    db = tmp_path / "lifeos.sqlite3"
    return LifeOSService(
        ProposalStore(db), things or NoThings(), None,
        BrainDumpStore(db, tmp_path / "journal"), bana=gateway,
    )


def test_never_commands_are_not_reachable_and_fail_before_any_request(tmp_path):
    assert not ALLOWED_COMMANDS & NEVER_COMMANDS
    # No home at all: a Never command must fail on the allowlist, not on discovery.
    gateway = BanaGateway(tmp_path / "missing")
    for command in [*NEVER_COMMANDS, "workspace.create", "settings.set", "file.save", "commandNode.on"]:
        assert command not in ALLOWED_COMMANDS
        with pytest.raises(PermissionError):
            gateway.run(command, {})
    assert all(not command.startswith(NEVER_PREFIXES) for command in ALLOWED_COMMANDS)


def test_bana_closed_is_unavailable_and_nothing_is_recorded(tmp_path):
    service = service_for(tmp_path, BanaGateway(tmp_path / "missing"))
    with pytest.raises(BanaUnavailable):
        service.notes_add(request_id="r1", name="Hello", by="claude")
    with pytest.raises(BanaUnavailable):
        service.notes_search("anything")
    assert service.store._connection.execute("SELECT COUNT(*) FROM proposals").fetchone()[0] == 0


def test_without_notes_write_every_write_is_refused_before_any_request(tmp_path):
    gateway = BanaGateway(tmp_path / "missing", writes=False)
    for command in ("node.add", "node.setDescription", "tag.add", "field.set", "node.move"):
        with pytest.raises(BanaNotPermitted):
            gateway.run(command, {})
    service = service_for(tmp_path, gateway)
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="c", source="chat")
    assert capture["bana"] == {"status": "not permitted"}
    assert service.get_brain_dump(capture["capture_id"])["raw_text"] == RAW


@needs_bana
def test_wrong_token_fails_closed_and_never_echoes_the_token(bana, tmp_path):
    gateway, home = bana
    real = (home / "token").read_text()
    (home / "token").write_text("f" * 32)
    try:
        with pytest.raises(BanaUnavailable) as refused:
            gateway.run("graph.search", {"query": "garden"})
        assert "f" * 32 not in str(refused.value) and real not in str(refused.value)
        service = service_for(tmp_path, gateway)
        with pytest.raises(BanaUnavailable):
            service.notes_add(request_id="r1", name="Never written", by="codex")
    finally:
        (home / "token").write_text(real)
    assert gateway.search("Never written") == []


@needs_bana
def test_notes_add_twice_with_one_request_id_makes_one_node(bana, tmp_path):
    gateway, home = bana
    service = service_for(tmp_path, gateway)
    first = service.notes_add(request_id="add-1", name="Buy bean seeds", by="chatgpt", tag="task")
    again = service.notes_add(request_id="add-1", name="Buy bean seeds", by="chatgpt", tag="task")
    assert first["saved"] and again["saved"]
    assert first["node_id"] == again["node_id"]
    assert [hit["id"] for hit in gateway.search("Buy bean seeds")] == [int(first["node_id"])]
    node = service.notes_read(first["node_id"])["node"]
    assert node["tags"] == ["task"]
    # Bana records the author itself, from the X-Bana-Agent header.
    assert node["by"] == "chatgpt" and node["fields"]["Request ID"] == "add-1"
    with pytest.raises(IdempotencyConflict):
        service.notes_add(request_id="add-1", name="Something else", by="chatgpt")
    # An invented supertag is refused; LifeOS never makes tags for an agent.
    with pytest.raises(ValueError):
        service.notes_add(request_id="add-2", name="x", by="claude", tag="made-up-tag")
    token = (home / "token").read_text().strip()
    assert token not in json.dumps(first) and token not in json.dumps(service.notes_read(first["node_id"]))


@needs_bana
def test_tier_two_edit_needs_the_fresh_hash(bana, tmp_path):
    gateway, _ = bana
    service = service_for(tmp_path, gateway)
    node = service.notes_add(request_id="n", name="Water rota", by="claude")["node_id"]
    fresh = service.notes_read(node)["hash"]
    done = service.notes_edit(
        request_id="f1", node_id=node, expected_hash=fresh, by="claude",
        operation="set_field", fields={"field": "Status", "value": "Draft"},
    )
    assert done["saved"]
    assert service.notes_read(node)["node"]["fields"]["Status"] == "Draft"
    # The old hash no longer matches: refused, nothing written.
    with pytest.raises(ValueError):
        service.notes_edit(
            request_id="f2", node_id=node, expected_hash=fresh, by="claude",
            operation="tag", fields={"tag": "task"},
        )
    assert "tags" not in service.notes_read(node)["node"]
    today = service.notes_today("2026-10-10")
    moved = service.notes_edit(
        request_id="m1", node_id=node, expected_hash=service.notes_read(node)["hash"], by="claude",
        operation="move", fields={"parent": today["node_id"]},
    )
    assert moved["saved"]


@needs_bana
@pytest.mark.asyncio
async def test_note_tools_over_mcp(bana, tmp_path):
    gateway, _ = bana
    async with Client(create_mcp(service_for(tmp_path, gateway))) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}
        added = await client.call_tool("notes_add", {"request_id": "mcp-1", "name": "From MCP", "by": "claude"})
        found = await client.call_tool("notes_search", {"query": "From MCP"})
        today = await client.call_tool("notes_today", {"date": "2026-10-10"})
    assert {"notes_search", "notes_read", "notes_today", "notes_add", "notes_tag",
            "notes_set_field", "notes_move", "notes_link_task"} <= set(tools)
    assert tools["notes_search"].annotations.readOnlyHint is True
    assert tools["notes_add"].annotations.readOnlyHint is False
    assert tools["notes_add"].annotations.destructiveHint is False
    assert added.structured_content["saved"] is True
    assert found.structured_content["results"][0]["id"] == int(added.structured_content["node_id"])
    assert "From MCP" in today.structured_content["markdown"]


RAW = (
    "Need to email Sam about the water rota before Friday.\n"
    "Not sure if the build day is the 18th or the 25th.\n"
    "Felt calmer after the garden today."
)


def interpret(service, capture, key, by):
    return service.submit_brain_dump_semanticization(
        capture_id=capture["capture_id"], source_hash=capture["source_hash"], idempotency_key=key,
        interpreted_by=by, summary="Garden admin.",
        items=[
            {"kind": "task", "title": "Email Sam about the water rota", "confidence": 0.9,
             "source_excerpt": "email Sam about the water rota", "time_expression": "before Friday"},
            {"kind": "question", "title": "Which date is the build day?", "confidence": 0.6,
             "source_excerpt": "the 18th or the 25th"},
        ],
        unresolved=["Is the rota weekly?"],
        journal_entry="Felt calmer after the garden today.",
    )


@needs_bana
def test_capture_then_interpret_twice(bana, tmp_path):
    gateway, _ = bana
    service = service_for(tmp_path, gateway)
    capture = service.capture_brain_dump(
        raw_text=RAW, idempotency_key="cap-1", source="chat", captured_at="2026-10-10T09:30:00+11:00",
    )
    assert capture["bana"]["status"] == "saved" and capture["bana"]["source_hash_matches"]
    # Retrying the capture makes no second node.
    assert service.capture_brain_dump(
        raw_text=RAW, idempotency_key="cap-1", source="chat", captured_at="2026-10-10T09:30:00+11:00",
    )["bana"]["node_id"] == capture["bana"]["node_id"]
    first = interpret(service, capture, "i-1", "chatgpt")
    second = interpret(service, capture, "i-2", "claude")
    assert first["bana"]["status"] == second["bana"]["status"] == "saved"
    assert first["bana"]["node_id"] != second["bana"]["node_id"]
    assert first["journal_written"] is False  # the journal's home is the Bana day page

    raw_node = service.notes_read(capture["bana"]["node_id"])["node"]
    assert raw_node["tags"] == ["capture"]
    assert raw_node["fields"]["Source hash"] == capture["source_hash"]
    raw_hits = [hit for hit in gateway.search("Capture:") if "#capture" in hit["line"]]
    assert len(raw_hits) == 1
    interpretations = [child for child in raw_node["children"] if "interpretation" in child.get("tags", [])]
    assert len(interpretations) == 2
    evidence = [
        item["fields"]["Evidence"]
        for node in interpretations for item in node.get("children", [])
        if item.get("fields", {}).get("Evidence")  # template fields can be empty
    ]
    assert len(evidence) == 4 and all(quote in RAW for quote in evidence)
    kinds = {tag for item in interpretations[0]["children"] for tag in item.get("tags", [])}
    assert kinds == {"suggested-action", "question"}

    day = service.notes_today("2026-10-10")
    assert "Felt calmer after the garden today." in day["markdown"]
    exported = service.export_journal("2026-10-10")
    text = Path(exported["path"]).read_text()
    assert exported["path"].endswith("2026-10-10.md") and "Felt calmer" in text
    # A file LifeOS did not export is never overwritten.
    hand = tmp_path / "journal" / "2026-10-11.md"
    hand.write_text("# my own words\n")
    assert service.export_journal("2026-10-11")["path"].endswith("2026-10-11.bana.md")
    assert hand.read_text() == "# my own words\n"


@needs_bana
def test_meeting_debrief_is_a_meeting_node(bana, tmp_path):
    gateway, _ = bana
    service = service_for(tmp_path, gateway)
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="m", source="import")
    result = service.submit_brain_dump_semanticization(
        capture_id=capture["capture_id"], source_hash=capture["source_hash"], idempotency_key="mi",
        interpreted_by="claude", items=[], meeting_title="Garden committee",
    )
    node = service.notes_read(result["bana"]["node_id"])["node"]
    assert node["name"] == "Garden committee" and set(node["tags"]) == {"interpretation", "meeting"}


def test_capture_succeeds_with_bana_closed_and_journal_falls_back(tmp_path):
    service = service_for(tmp_path, BanaGateway(tmp_path / "closed"))
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="c", source="chat", captured_at="2026-10-10T09:30:00+11:00")
    assert capture["bana"] == {"status": "unavailable"}
    assert service.get_brain_dump(capture["capture_id"])["raw_text"] == RAW
    revision = interpret(service, capture, "i", "codex")
    assert revision["bana"] == {"status": "unavailable"}
    assert revision["journal_written"] is True  # Markdown keeps the prose until Bana is back


@needs_bana
def test_export_journal_cli(bana, tmp_path, monkeypatch, capsys):
    from lifeos import cli

    _, home = bana
    monkeypatch.setenv("BANA_HOME", str(home))
    monkeypatch.setenv("LIFEOS_DB_PATH", str(tmp_path / "lifeos.sqlite3"))
    monkeypatch.setenv("LIFEOS_JOURNAL_DIR", str(tmp_path / "journal"))
    assert cli.main(["export-journal", "--date", "2026-10-10"]) == 0
    written = json.loads(capsys.readouterr().out)
    assert "Seed swap at the library" in Path(written["path"]).read_text()


class FakeThings:
    """Records create_todo calls; never touches real Things."""

    def __init__(self):
        self.created = []

    def create_todo(self, **fields):
        from lifeos.things_gateway import WriteResult

        self.created.append(fields)
        uuid = f"TODO-{len(self.created)}"
        return WriteResult(status="verified", command="create", record={"record": {"uuid": uuid, **fields}})


def promote(service, node):
    return service.promote_notes_to_things(
        proposal_id=f"promote-{node}", by="claude",
        items=[{"node_id": node, "expected_hash": service.notes_read(node)["hash"]}],
    )


@needs_bana
def test_promote_note_to_things_links_the_node(bana, tmp_path):
    gateway, _ = bana
    things = FakeThings()
    service = service_for(tmp_path, gateway, things)
    node = service.notes_add(request_id="p", name="Order compost", by="claude", tag="task")["node_id"]
    draft = promote(service, node)
    assert draft["state"] == "draft" and things.created == []
    from lifeos.ui import ProposalReviewOutput

    assert ProposalReviewOutput.model_validate(draft).bana_changes[0].operation == "link_task"
    # The card (or `lifeos approve`) approves; the model cannot.
    service.approve_proposal(draft["proposal_id"], draft["revision_hash"])
    applied = service.apply_proposal(draft["proposal_id"], draft["revision_hash"])
    assert applied["state"] == "applied"
    assert things.created == [{"title": "Order compost", "notes": f"From Bana note {node}."}]
    linked = service.notes_read(node)["node"]
    assert set(linked["tags"]) == {"task", "in-things"}
    assert linked["fields"]["Things ID"] == "TODO-1"
    assert linked["fields"]["Things link"] == "things:///show?id=TODO-1"
    assert linked["fields"]["Synced at"]


@needs_bana
def test_editing_the_note_after_approval_makes_apply_stale(bana, tmp_path):
    gateway, _ = bana
    things = FakeThings()
    service = service_for(tmp_path, gateway, things)
    node = service.notes_add(request_id="s", name="Fix the gate", by="codex")["node_id"]
    draft = promote(service, node)
    service.approve_proposal(draft["proposal_id"], draft["revision_hash"])
    gateway.set_field(node, "Status", "Changed my mind")  # the person edits the note
    result = service.apply_proposal(draft["proposal_id"], draft["revision_hash"])
    assert result["state"] == "stale"
    assert things.created == []
    assert "in-things" not in service.notes_read(node)["node"].get("tags", [])


@needs_bana
def test_agent_notebook_template_is_installed_once(bana, tmp_path):
    gateway, home = bana
    first = service_for(tmp_path, gateway)
    first.notes_add(request_id="t1", name="One", by="claude")
    # A fresh gateway (a new LifeOS process) finds the supertags and does not install again.
    (tmp_path / "other").mkdir()
    second = service_for(tmp_path / "other", BanaGateway(home))
    two = second.notes_add(request_id="t2", name="Two", by="codex")["node_id"]
    assert {"capture", "suggested-action", "in-things", "ask-agent"} <= gateway.tags()
    pages = [hit for hit in gateway.search("Agent notebook") if hit["line"].startswith("Agent notebook")]
    assert len(pages) == 1
    assert gateway.inspect(two)["by"] == "codex"


@needs_bana
@pytest.mark.asyncio
async def test_without_notes_write_nothing_reaches_bana_but_the_ledger_keeps_it(bana, tmp_path, monkeypatch):
    from lifeos import cloud_bridge

    gateway, home = bana
    things = FakeThings()
    monkeypatch.setattr(
        cloud_bridge, "build_default_service",
        lambda *, bana_writes: service_for(tmp_path, BanaGateway(home, writes=bana_writes), things),
    )

    async def call(tool, arguments, notes_write=None):
        grant = {} if notes_write is None else {"_lifeos_grant": {"notes_write": notes_write}}
        return await cloud_bridge.invoke({"tool": tool, "arguments": {**arguments, **grant}})

    # A lifeos:local-only grant (the Worker sends notes_write false; an old Worker sends nothing).
    for notes_write in (False, None):
        key = f"local-only-{notes_write}"
        captured = (await call("capture_brain_dump", {"raw_text": RAW, "idempotency_key": key}, notes_write))
        capture = captured["structuredContent"]
        assert capture["bana"] == {"status": "not permitted"}
        interpreted = (await call("submit_brain_dump_semanticization", {
            "capture_id": capture["capture_id"], "source_hash": capture["source_hash"],
            "idempotency_key": key, "items": [], "journal_entry": "Felt calmer after the garden today.",
        }, notes_write))["structuredContent"]
        assert interpreted["bana"] == {"status": "not permitted"}
        assert interpreted["journal_written"] is True  # the prose stays in Markdown, not queued
        added = await call("notes_add", {"request_id": key, "name": "Sneaky note", "by": "chatgpt"}, notes_write)
        assert added["isError"] is True and "not permitted" in added["content"][0]["text"]
    assert gateway.search("Capture:") == [] and gateway.search("Sneaky note") == []
    assert gateway.search("Felt calmer after the garden") == []
    ledger = service_for(tmp_path, gateway)
    assert ledger.list_brain_dumps()["total"] == 2
    assert ledger.store._connection.execute("SELECT COUNT(*) FROM proposals").fetchone()[0] == 0

    # A promotion drafted and approved by the person still cannot be applied over that grant.
    writer = service_for(tmp_path, gateway, things)
    node = writer.notes_add(request_id="promo", name="Order compost", by="claude")["node_id"]
    draft = promote(writer, node)
    writer.approve_proposal(draft["proposal_id"], draft["revision_hash"])
    applied = await call("apply_approved_proposal", {
        "proposal_id": draft["proposal_id"], "revision_hash": draft["revision_hash"],
    }, False)
    assert applied["isError"] is True and things.created == []
    assert writer.get_proposal(draft["proposal_id"])["state"] == "approved"

    # With notes:write the same capture path writes to Bana.
    granted = (await call("capture_brain_dump", {"raw_text": RAW, "idempotency_key": "granted"}, True))
    assert granted["structuredContent"]["bana"]["status"] == "saved"
