"""A fake `codex` for the chat agent tests. Never the real Codex.

It records its argv and whether stdin was /dev/null to $HOME/codex-calls.jsonl, starts the
LifeOS MCP named by its `-c mcp_servers.lifeos.*` options exactly as Codex would, calls a tool,
and writes a short answer to --output-last-message.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import stat
import sys
import time
import tomllib
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports import StdioTransport


def options(argv: list[str]) -> tuple[dict[str, str], Path, str]:
    config, output = {}, None
    for flag, value in zip(argv, argv[1:], strict=False):
        if flag == "-c":
            key, _, raw = value.partition("=")
            config[key] = raw
        if flag == "--output-last-message":
            output = Path(value)
    return config, output, argv[-1]


async def use_mcp(config: dict[str, str], message: str, record: dict) -> str:
    command = json.loads(config["mcp_servers.lifeos.command"])
    args = json.loads(config["mcp_servers.lifeos.args"])
    env = tomllib.loads("env = " + config["mcp_servers.lifeos.env"])["env"]
    transport = StdioTransport(command, args, env={**os.environ, **env})
    async with Client(transport) as client:
        tools = sorted(tool.name for tool in await client.list_tools())
        record["tools"] = tools
        if "delete" in message.lower():
            # A hostile request: try what an obedient model would try. Each must fail.
            attempts = {}
            for name, arguments in (
                ("trash_requested_task", {"request_id": "x", "task_id": "x", "expected_source_hash": "x"}),
                ("apply_approved_proposal", {"proposal_id": "x", "revision_hash": "x"}),
                ("approve_proposal", {"proposal_id": "x", "revision_hash": "x", "approval_ticket": "x"}),
            ):
                try:
                    result = await client.call_tool(name, arguments, raise_on_error=False)
                    attempts[name] = "error" if result.is_error else "ran"
                except Exception:
                    attempts[name] = "error"
            record["attempts"] = attempts
            return "I cannot delete anything. You can archive notes yourself in Anytype."
        word = message.split()[-1]
        found = await client.call_tool("notes_search", {"query": word})
        record["called"] = "notes_search"
        return f"Found {found.structured_content['count']} notes about {word}."


def main() -> int:
    argv = sys.argv[1:]
    config, output, prompt = options(argv)
    message = re.search(r"<<<MESSAGE\n(.*)\nMESSAGE>>>", prompt, re.S).group(1)
    null = os.stat("/dev/null")
    mine = os.fstat(0)
    record = {
        "argv": argv, "message": message,
        "stdin_is_devnull": stat.S_ISCHR(mine.st_mode) and mine.st_rdev == null.st_rdev,
        "env_keys": sorted(os.environ),
    }
    try:
        if "sleep" in message:
            time.sleep(60)
        if "crash" in message:
            return 3
        answer = "word " * 700 if "long" in message else asyncio.run(use_mcp(config, message, record))
        output.write_text(answer)
        return 0
    finally:
        with (Path(os.environ["HOME"]) / "codex-calls.jsonl").open("a") as log:
            log.write(json.dumps(record) + "\n")


if __name__ == "__main__":
    raise SystemExit(main())
