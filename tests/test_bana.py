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

import pytest
from fastmcp import Client

from lifeos.bana_gateway import (
    ALLOWED_COMMANDS,
    NEVER_COMMANDS,
    NEVER_PREFIXES,
    BanaGateway,
    BanaUnavailable,
)
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
    return LifeOSService(ProposalStore(tmp_path / "lifeos.sqlite3"), things or NoThings(), None, bana=gateway)


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
    assert node["fields"]["By"] == "chatgpt" and node["fields"]["Request ID"] == "add-1"
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
