"""One bounded local tool invocation for the signed Mac agent.

This has no listening socket and accepts only the shipped tool allowlist.
Raw arguments and results travel through pipes, never diagnostic logs.
"""

from __future__ import annotations

import asyncio
import json
import os
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
    # Anytype notes. The Worker lists these only for grants with the notes / notes:write scopes.
    "notes_search", "notes_read", "notes_today", "notes_list_types", "notes_add", "notes_tag", "notes_set_field",
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
    # Anytype writes: captures still land in the ledger and report anytype "not permitted".
    arguments = dict(request["arguments"])
    grant = arguments.pop(GRANT_KEY, None)
    notes_write = isinstance(grant, dict) and grant.get("notes_write") is True
    server = server or create_mcp(build_default_service(notes_writes=notes_write))
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


FAILURE = {"isError": True, "content": [{"type": "text", "text": "Local tool could not complete. Check its saved state before retrying a write."}]}
WORKER_READY = '{"worker":1,"ready":"lifeos-cloud-bridge"}'


async def serve() -> None:
    """Warm worker for the persistent local service: one JSON request per stdin line.

    Each line gets exactly one JSON reply line. Invocation semantics are identical to main().
    Replies use a private copy of fd 1; fd 1 itself then points at stderr, so nothing a library,
    native extension or child process prints can reach the reply channel. WORKER_READY is
    written once the LifeOS modules have imported, before any request is read.
    """
    loop = asyncio.get_running_loop()
    sys.stdout.flush()
    replies = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    replies.write(WORKER_READY + "\n")
    replies.flush()
    while True:
        raw = await loop.run_in_executor(None, sys.stdin.buffer.readline, MAX_BYTES + 2)
        if not raw:
            return
        try:
            if not raw.endswith(b"\n"):
                # Oversized: discard the rest of this line so the next request stays framed.
                while raw and not raw.endswith(b"\n"):
                    raw = await loop.run_in_executor(None, sys.stdin.buffer.readline, MAX_BYTES)
                raise ValueError("request too large")
            if len(raw) - 1 > MAX_BYTES:
                raise ValueError("request too large")
            result = await invoke(json.loads(raw))
        except Exception:
            result = FAILURE
        replies.write(json.dumps(result, ensure_ascii=False) + "\n")
        replies.flush()


def main() -> None:
    if sys.argv[1:] == ["--serve"]:
        asyncio.run(serve())
        return
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("request too large")
        result = asyncio.run(invoke(json.loads(raw)))
    except Exception:
        # Framework/gateway errors may contain private content. Never print them.
        result = FAILURE
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
