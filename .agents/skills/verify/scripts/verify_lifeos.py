#!/usr/bin/env python3
"""Drive one LifeOS MCP capture through an isolated HTTP process."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import socket
import sqlite3
import subprocess
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import urlopen

from fastmcp import Client

ROOT = Path(__file__).resolve().parents[4]
ARTIFACTS = ROOT / "artifacts" / "verification"
RAW_TEXT = "Verification capture: review the Paperless integration tomorrow."


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def doctor(port: int) -> dict:
    with urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
        health = json.load(response)
    if health != {"status": "ok", "service": "lifeos-mcp"}:
        raise RuntimeError(f"unexpected LifeOS health response: {health}")
    return health


async def drive(port: int) -> dict:
    async with Client(f"http://127.0.0.1:{port}/mcp") as client:
        tools = {tool.name for tool in await client.list_tools()}
        required = {"capture_brain_dump", "get_brain_dump", "search_brain_dumps"}
        if not required <= tools:
            raise RuntimeError(f"missing MCP tools: {sorted(required - tools)}")
        captured = await client.call_tool(
            "capture_brain_dump",
            {
                "raw_text": RAW_TEXT,
                "idempotency_key": "verification-capture-1",
                "source": "synthetic_test",
            },
        )
        capture = captured.structured_content or captured.data
        capture_id = capture["capture_id"]
        retrieved = await client.call_tool("get_brain_dump", {"capture_id": capture_id})
        search = await client.call_tool(
            "search_brain_dumps", {"query": "Paperless integration", "include_tests": True}
        )
        stored = retrieved.structured_content or retrieved.data
        matches = search.structured_content or search.data
        if stored["raw_text"] != RAW_TEXT:
            raise RuntimeError("retrieved capture differs from submitted text")
        if capture_id not in json.dumps(matches):
            raise RuntimeError("capture missing from user-facing search")
        return {
            "tool_names": sorted(required),
            "capture_request": {"raw_text": RAW_TEXT, "source": "synthetic_test"},
            "capture_response": capture,
            "get_response": stored,
            "search_response": matches,
        }


def run() -> Path:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    evidence_dir = ARTIFACTS / datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    evidence_dir.mkdir()
    port = free_port()
    with tempfile.TemporaryDirectory(prefix="lifeos-verify-") as scratch:
        scratch_path = Path(scratch)
        db_path = scratch_path / "lifeos.sqlite3"
        log_path = evidence_dir / "server.log"
        env = {key: value for key, value in os.environ.items() if not key.startswith("LIFEOS_")}
        command = [
            str(ROOT / ".venv/bin/lifeos-mcp"),
            "--transport", "streamable-http",
            "--host", "127.0.0.1",
            "--port", str(port),
            "--db-path", str(db_path),
            "--journal-dir", str(scratch_path / "journal"),
        ]
        with log_path.open("w") as log:
            process = subprocess.Popen(command, cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                health = None
                for _ in range(80):
                    if process.poll() is not None:
                        raise RuntimeError(f"LifeOS exited during launch: {process.returncode}")
                    try:
                        health = doctor(port)
                        break
                    except OSError:
                        time.sleep(0.1)
                if health is None:
                    raise RuntimeError("LifeOS did not become healthy")
                evidence = asyncio.run(drive(port))
                with sqlite3.connect(db_path) as connection:
                    rows = connection.execute(
                        "SELECT capture_id, raw_text, source FROM brain_dump_captures"
                    ).fetchall()
                    proposal_count = connection.execute(
                        "SELECT COUNT(*) FROM proposals"
                    ).fetchone()[0]
                if len(rows) != 1 or rows[0][1:] != (RAW_TEXT, "synthetic_test"):
                    raise RuntimeError("scratch SQLite capture was not persisted exactly")
                if proposal_count:
                    raise RuntimeError("verification unexpectedly created a proposal")
                evidence["health"] = health
                evidence["scratch_db_rows"] = [list(row) for row in rows]
                evidence["proposal_count"] = proposal_count
                evidence["server_pid"] = process.pid
                (evidence_dir / "capture.json").write_text(
                    json.dumps(evidence, indent=2, default=str) + "\n"
                )
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
        stopped = process.poll() is not None
    (evidence_dir / "cleanup.json").write_text(
        json.dumps({"server_stopped": stopped, "scratch_removed": not scratch_path.exists()})
        + "\n"
    )
    if not (evidence_dir / "capture.json").is_file():
        raise RuntimeError("capture evidence did not survive cleanup")
    return evidence_dir


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("run", "doctor"))
    parser.add_argument("--port", type=int)
    args = parser.parse_args()
    if args.action == "doctor":
        if args.port is None:
            parser.error("doctor requires --port")
        print(json.dumps(doctor(args.port)))
    else:
        if not (ROOT / ".venv/bin/lifeos-mcp").is_file():
            raise SystemExit("install dependencies first: uv sync --extra test")
        print(run())


if __name__ == "__main__":
    main()
