"""One bounded local tool invocation for the signed Mac agent.

This has no listening socket and accepts only the shipped tool allowlist.
Raw arguments and results travel through pipes, never diagnostic logs.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from fastmcp import Client

from .server import build_default_service, create_mcp

LOCAL_TOOLS = frozenset({
    "capture_brain_dump", "submit_brain_dump_semanticization", "get_brain_dump",
    "list_brain_dumps", "search_brain_dumps", "index_brain_dump_memory",
    "get_brain_dump_memory_status", "recall_memory", "review_brain_dump_memory",
    "search_things", "read_things_list", "read_things_projects", "read_things_areas",
    "read_things_tags", "things_deep_link", "list_calendars",
    "calendar_authorization_status", "read_calendar_range", "plan_day", "plan_week",
    "propose_changes", "get_proposal", "render_proposal_review",
    "approve_proposal", "reject_proposal", "apply_approved_proposal", "create_requested_task",
    "read_requested_task", "update_requested_task", "trash_requested_task",
    # Bana notes. The Worker lists these only for grants with the notes / notes:write scopes.
    "notes_search", "notes_read", "notes_today", "notes_add", "notes_tag", "notes_set_field",
    "notes_move", "notes_link_task", "promote_notes_to_things",
})
MAX_BYTES = 256 * 1024
GRANT_KEY = "_lifeos_grant"


async def invoke(request: dict[str, Any], server: Any = None) -> dict[str, Any]:
    if set(request) != {"tool", "arguments"} or request["tool"] not in LOCAL_TOOLS:
        raise ValueError("unsupported local tool")
    if not isinstance(request["arguments"], dict):
        raise ValueError("tool arguments must be an object")
    # The Worker states what the grant allows (it overwrites any client value). Missing means no
    # Bana writes: captures still land in the ledger and report bana "not permitted".
    arguments = dict(request["arguments"])
    grant = arguments.pop(GRANT_KEY, None)
    notes_write = isinstance(grant, dict) and grant.get("notes_write") is True
    server = server or create_mcp(build_default_service(bana_writes=notes_write))
    async with Client(server) as client:
        result = await client.call_tool(request["tool"], arguments, raise_on_error=False)
    output: dict[str, Any] = {
        "content": [item.model_dump(mode="json", exclude_none=True) for item in result.content],
        "isError": result.is_error,
    }
    if result.structured_content is not None:
        output["structuredContent"] = result.structured_content
    if result.meta:
        output["_meta"] = result.meta  # the review card's approval ticket; hosts keep it from the model
    if len(json.dumps(output, ensure_ascii=False).encode()) > MAX_BYTES:
        return {"isError": True, "content": [{"type": "text", "text": "Local result exceeds the response budget. Use a smaller range or page."}]}
    return output


def main() -> None:
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("request too large")
        result = asyncio.run(invoke(json.loads(raw)))
    except Exception:
        # Framework/gateway errors may contain private content. Never print them.
        result = {"isError": True, "content": [{"type": "text", "text": "Local tool could not complete. Check its saved state before retrying a write."}]}
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
