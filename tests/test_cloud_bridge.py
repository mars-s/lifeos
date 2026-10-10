from __future__ import annotations

import pytest
from fastmcp import FastMCP

from lifeos.cloud_bridge import invoke
from lifeos.server import create_mcp


@pytest.mark.asyncio
async def test_requested_crud_uses_actual_mcp_and_no_review_widget():
    calls = []
    class Things:
        def read_todo(self, task_id):
            return {"record": {"uuid": task_id, "title": "Synthetic"}, "source_hash": "local-v1"}
    class Service:
        things = Things()
        def change_requested_task(self, **args):
            calls.append(args)
            return {"saved": True, "receipt": {"synthetic": True}, "requires_lifeos_approval": False}
    server = create_mcp(Service())
    read = await invoke({"tool": "read_requested_task", "arguments": {"task_id": "fixture"}}, server)
    assert read["structuredContent"]["task"]["source_hash"] == "local-v1"
    for tool in ("update_requested_task", "trash_requested_task"):
        args = {"request_id": tool, "task_id": "fixture", "expected_source_hash": "local-v1"}
        if tool == "update_requested_task":
            args["fields"] = {"title": "Synthetic edit"}
        result = await invoke({"tool": tool, "arguments": args}, server)
        assert result["isError"] is False
        assert result["structuredContent"]["saved"] is True
    assert calls[0]["fields"] == {"title": "Synthetic edit"}
    assert calls[1]["trash"] is True


@pytest.mark.asyncio
async def test_bridge_uses_actual_mcp_validation_and_preserves_result():
    server = FastMCP("synthetic local bridge")

    @server.tool()
    def get_brain_dump(capture_id: str) -> dict:
        return {"capture_id": capture_id, "raw_text": "Synthetic local evidence"}

    result = await invoke({"tool": "get_brain_dump", "arguments": {"capture_id": "fixture"}}, server)
    assert result["isError"] is False
    assert result["structuredContent"]["raw_text"] == "Synthetic local evidence"
    invalid = await invoke({"tool": "get_brain_dump", "arguments": {}}, server)
    assert invalid["isError"] is True


@pytest.mark.asyncio
async def test_bridge_rejects_arbitrary_tools_before_service_initialisation():
    for request in (
        {"tool": "execute", "arguments": {"script": "anything"}},
        {"tool": "get_brain_dump", "arguments": {}, "owner": "other"},
        {"tool": "get_brain_dump", "arguments": []},
    ):
        with pytest.raises(ValueError):
            await invoke(request)


@pytest.mark.asyncio
async def test_bridge_does_not_repeat_an_apply_or_expand_revision():
    server = FastMCP("synthetic apply boundary")
    calls = []

    @server.tool()
    def apply_approved_proposal(proposal_id: str, revision_hash: str) -> dict:
        calls.append((proposal_id, revision_hash))
        return {"state": "partial_failure", "revision_hash": revision_hash}

    result = await invoke({"tool": "apply_approved_proposal", "arguments": {
        "proposal_id": "fixture", "revision_hash": "exact-revision",
    }}, server)
    assert result["structuredContent"]["state"] == "partial_failure"
    assert calls == [("fixture", "exact-revision")]


@pytest.mark.asyncio
async def test_requested_task_exposed_without_widget_and_validated():
    from fastmcp import Client
    class Service:
        calls = []
        def create_requested_task(self, **fields):
            self.calls.append(fields)
            return {"saved": True, "state": "applied", "receipt": {"synthetic": True}}
    service = Service()
    server = create_mcp(service)
    async with Client(server) as client:
        tool = next(t for t in await client.list_tools() if t.name == "create_requested_task")
        assert tool.annotations.readOnlyHint is False
        assert tool.annotations.destructiveHint is False
        assert tool.annotations.idempotentHint is True
        assert not (tool.meta or {}).get("ui")
    request = {"tool": "create_requested_task", "arguments": {
        "request_id": "synthetic", "title": "Call James", "when": "2026-10-09",
    }}
    result = await invoke(request, server)
    assert result["isError"] is False
    assert result["structuredContent"]["saved"] is True
    invalid = await invoke({**request, "arguments": {**request["arguments"], "canceled": True}}, server)
    assert invalid["isError"] is True
    assert len(service.calls) == 1
