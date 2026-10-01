from __future__ import annotations

import subprocess

import pytest
from fastmcp import Client
from pydantic import ValidationError
from starlette.testclient import TestClient

from lifeos import server
from lifeos.runtime import DEFAULT_HOST, DEFAULT_HTTP_PATH, DEFAULT_PORT, parse_runtime_config
from lifeos.server import create_mcp
from lifeos.ui import BrainDumpCanvasOutput


class FakeService:
    def read_things_list(self, list_name, *, limit, offset):
        return {"list": list_name, "limit": limit, "offset": offset, "items": []}

    def review_brain_dump_memory(self, capture_id):
        return {
            "capture_id": capture_id,
            "source_hash": "source-hash",
            "raw_text": "Avi said the date is still open.",
            "status": "done",
            "claims": [{"memory_id": "memory-1", "text": "The date is open.", "review_status": "unreviewed"}],
            "content_is_untrusted": True,
        }


@pytest.mark.asyncio
async def test_mcp_exposes_read_and_review_tools_but_no_raw_mutations():
    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools}
        proposal_tool = next(tool for tool in tools if tool.name == "propose_changes")
        semanticization_tool = next(
            tool for tool in tools if tool.name == "submit_brain_dump_semanticization"
        )
        memory_index_tool = next(tool for tool in tools if tool.name == "index_brain_dump_memory")
        recall_tool = next(tool for tool in tools if tool.name == "recall_memory")
        result = await client.call_tool(
            "read_things_list", {"list_name": "today", "limit": 25, "offset": 0}
        )

    assert {
        "read_things_list",
        "read_calendar_range",
        "plan_day",
        "plan_week",
        "render_day_plan",
        "render_week_plan",
        "render_brain_dump_canvas",
        "render_proposal_review",
        "capture_brain_dump",
        "submit_brain_dump_semanticization",
        "get_brain_dump",
        "list_brain_dumps",
        "search_brain_dumps",
        "index_brain_dump_memory",
        "get_brain_dump_memory_status",
        "recall_memory",
        "review_brain_dump_memory",
        "propose_changes",
        "approve_proposal",
        "apply_approved_proposal",
    } <= names
    assert "update_todo" not in names
    assert "create_linked_work_block" not in names
    item_properties = semanticization_tool.inputSchema["properties"]["items"]["items"]["properties"]
    assert "exact ISO-8601" in item_properties["suggested_when"]["description"]
    assert "University" in item_properties["area"]["description"]
    assert memory_index_tool.annotations.openWorldHint is True
    assert recall_tool.annotations.readOnlyHint is True
    assert recall_tool.inputSchema["properties"]["scope"]["default"] == "personal"
    calendar_change = proposal_tool.inputSchema["properties"]["calendar_changes"]
    item_schema = calendar_change["anyOf"][0]["items"]
    assert "operation" in item_schema["properties"]
    assert result.data["list"] == "today"


@pytest.mark.asyncio
async def test_memory_review_tool_has_source_comparison_widget():
    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        review_tool = next(tool for tool in tools if tool.name == "review_brain_dump_memory")
        resources = await client.list_resources()
        resource = next(item for item in resources if str(item.uri) == "ui://lifeos/memory-review-v1.html")
        contents = await client.read_resource(resource.uri)
        result = await client.call_tool("review_brain_dump_memory", {"capture_id": "capture-1"})
    assert review_tool.meta["ui"]["resourceUri"] == "ui://lifeos/memory-review-v1.html"
    assert review_tool.annotations.readOnlyHint is True
    assert resource.mimeType == "text/html;profile=mcp-app"
    assert "Extracted memories are suggestions" in contents[0].text
    assert "textContent" in contents[0].text
    assert '"openai:set_globals"' in contents[0].text
    assert result.structured_content["raw_text"] == "Avi said the date is still open."
    assert result.structured_content["claims"][0]["review_status"] == "unreviewed"


@pytest.mark.asyncio
async def test_day_plan_renderer_exposes_a_chatgpt_component():
    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        render_tool = next(tool for tool in tools if tool.name == "render_day_plan")
        resources = await client.list_resources()
        resource = next(
            item for item in resources if str(item.uri) == "ui://lifeos/day-plan-v3.html"
        )
        contents = await client.read_resource(resource.uri)
        result = await client.call_tool(
            "render_day_plan",
            {
                "day_start": "2026-09-22T08:00:00+10:00",
                "day_end": "2026-09-22T18:00:00+10:00",
                "blocks": [
                    {
                        "task_id": "task-1",
                        "title": "Write the project brief",
                        "start": "2026-09-22T09:00:00+10:00",
                        "end": "2026-09-22T10:00:00+10:00",
                        "duration_minutes": 60,
                        "calendar_id": "planned-tasks",
                    }
                ],
                "unscheduled": [],
            },
        )

    assert render_tool.meta["ui"]["resourceUri"] == "ui://lifeos/day-plan-v3.html"
    assert render_tool.meta["openai/outputTemplate"] == "ui://lifeos/day-plan-v3.html"
    assert render_tool.annotations.readOnlyHint is True
    assert render_tool.outputSchema["properties"]["mutates_external_systems"]["default"] is False
    assert resource.mimeType == "text/html;profile=mcp-app"
    assert "Prepare proposal" in contents[0].text
    assert '"openai:set_globals"' in contents[0].text
    assert '"pointerdown"' in contents[0].text
    assert "Done editing" in contents[0].text
    assert "resize-grip" in contents[0].text
    assert result.structured_content["blocks"][0]["task_id"] == "task-1"
    assert result.structured_content["mutates_external_systems"] is False


@pytest.mark.asyncio
async def test_week_plan_renderer_exposes_editable_chatgpt_component():
    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        render_tool = next(tool for tool in tools if tool.name == "render_week_plan")
        resources = await client.list_resources()
        resource = next(
            item for item in resources if str(item.uri) == "ui://lifeos/week-plan-v1.html"
        )
        contents = await client.read_resource(resource.uri)
        result = await client.call_tool(
            "render_week_plan",
            {
                "range_start": "2026-09-22T08:00:00+10:00",
                "range_end": "2026-09-23T18:00:00+10:00",
                "days": [
                    {
                        "day_start": "2026-09-22T08:00:00+10:00",
                        "day_end": "2026-09-22T18:00:00+10:00",
                        "blocks": [],
                    },
                    {
                        "day_start": "2026-09-23T08:00:00+10:00",
                        "day_end": "2026-09-23T18:00:00+10:00",
                        "blocks": [],
                    },
                ],
            },
        )

    assert render_tool.meta["ui"]["resourceUri"] == "ui://lifeos/week-plan-v1.html"
    assert render_tool.meta["openai/outputTemplate"] == "ui://lifeos/week-plan-v1.html"
    assert resource.mimeType == "text/html;profile=mcp-app"
    assert "Adjust week" in contents[0].text
    assert "pointerdown" in contents[0].text
    assert "handle" in contents[0].text
    assert len(result.structured_content["days"]) == 2


@pytest.mark.asyncio
async def test_widget_resources_publish_csp_and_live_domain(monkeypatch):
    monkeypatch.setenv("LIFEOS_PUBLIC_BASE_URL", "https://lifeos.example")
    mcp = create_mcp(FakeService())

    async with Client(mcp) as client:
        resources = await client.list_resources()

    by_uri = {str(resource.uri): resource for resource in resources}
    day_plan = by_uri["ui://lifeos/day-plan-v3.html"]
    proposal_review = by_uri["ui://lifeos/proposal-review-v1.html"]
    brain_dump = by_uri["ui://lifeos/brain-dump-canvas-v4.html"]
    week_plan = by_uri["ui://lifeos/week-plan-v1.html"]

    for resource in (day_plan, week_plan, proposal_review, brain_dump):
        assert resource.meta["ui"]["domain"] == "https://lifeos.example"
        assert resource.meta["ui"]["csp"]["connectDomains"] == []
    assert day_plan.meta["ui"]["csp"]["resourceDomains"] == []
    assert week_plan.meta["ui"]["csp"]["resourceDomains"] == []
    assert proposal_review.meta["ui"]["csp"]["resourceDomains"] == []
    assert brain_dump.meta["ui"]["csp"]["resourceDomains"] == [
        "https://cdn.jsdelivr.net"
    ]


@pytest.mark.asyncio
async def test_proposal_review_exposes_exact_revision_actions_to_chatgpt():
    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        render_tool = next(tool for tool in tools if tool.name == "render_proposal_review")
        approve_tool = next(tool for tool in tools if tool.name == "approve_proposal")
        reject_tool = next(tool for tool in tools if tool.name == "reject_proposal")
        resources = await client.list_resources()
        resource = next(
            item for item in resources if str(item.uri) == "ui://lifeos/proposal-review-v1.html"
        )
        contents = await client.read_resource(resource.uri)
        result = await client.call_tool(
            "render_proposal_review",
            {
                "proposal": {
                    "proposal_id": "meeting-follow-ups",
                    "revision_number": 1,
                    "revision_hash": "revision-1",
                    "state": "draft",
                    "source_snapshots": [
                        {
                            "system": "things",
                            "record_id": "inbox",
                            "version": "snapshot-1",
                            "data": {},
                        }
                    ],
                    "things_changes": [
                        {
                            "operation": "create",
                            "task_id": None,
                            "fields": {"title": "Sync with Middy", "area": "Paperless"},
                            "destructive": False,
                        }
                    ],
                    "calendar_changes": [],
                    "created_at": "2026-09-23T11:30:00+10:00",
                    "approved_revision_hash": None,
                    "failure_detail": None,
                }
            },
        )

    assert render_tool.meta["ui"]["resourceUri"] == "ui://lifeos/proposal-review-v1.html"
    assert render_tool.meta["openai/outputTemplate"] == "ui://lifeos/proposal-review-v1.html"
    assert render_tool.annotations.readOnlyHint is True
    assert approve_tool.meta["ui"]["visibility"] == ["model", "app"]
    assert reject_tool.meta["ui"]["visibility"] == ["model", "app"]
    assert resource.mimeType == "text/html;profile=mcp-app"
    assert "Approve revision" in contents[0].text
    assert 'transition("approve_proposal"' in contents[0].text
    assert 'transition("reject_proposal"' in contents[0].text
    assert 'method: "tools/call"' in contents[0].text
    assert "Approval is not application" in contents[0].text
    assert result.structured_content["proposal_id"] == "meeting-follow-ups"
    assert result.structured_content["revision_hash"] == "revision-1"


@pytest.mark.asyncio
async def test_brain_dump_canvas_exposes_a_safe_flexible_chatgpt_component():
    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        render_tool = next(tool for tool in tools if tool.name == "render_brain_dump_canvas")
        resources = await client.list_resources()
        resource = next(
            item for item in resources if str(item.uri) == "ui://lifeos/brain-dump-canvas-v4.html"
        )
        contents = await client.read_resource(resource.uri)
        result = await client.call_tool(
            "render_brain_dump_canvas",
            {
                "canvas": {
                    "title": "MCP launch meeting",
                    "capture_id": "capture-1",
                    "revision_hash": "revision-1",
                    "source_label": "Granola notes + transcript",
                    "meeting_date": "23 September 2026",
                    "participants": ["Avinaba", "Middy"],
                    "transcript_segments": [
                        {
                            "id": "segment-1",
                            "speaker": "Middy",
                            "timestamp": "12:41",
                            "text": "Avinaba, can you combine the testing findings?",
                            "is_user": False,
                        }
                    ],
                    "nodes": [
                        {
                            "id": "tasks",
                            "kind": "tasks",
                            "title": "Candidate tasks",
                            "accent": "blue",
                            "x": 1,
                            "y": 1,
                            "width": 7,
                            "min_height": 4,
                            "items": [
                                {
                                    "id": "task-1",
                                    "title": "Finish FIT3155 suffix-tree notes",
                                    "area": "University",
                                    "assignee": "Avinaba",
                                    "evidence_status": "confirmed",
                                }
                            ],
                        },
                        {
                            "id": "scene",
                            "kind": "custom_html",
                            "title": "Thought map",
                            "x": 8,
                            "y": 1,
                            "width": 5,
                            "min_height": 4,
                            "html": "<main>One isolated scene</main>",
                            "css": "main { padding: 1rem; }",
                            "javascript": "document.body.dataset.ready = 'true';",
                        },
                        {
                            "id": "relationships",
                            "kind": "mermaid",
                            "title": "How it connects",
                            "x": 1,
                            "y": 5,
                            "width": 12,
                            "min_height": 4,
                            "diagram": "flowchart LR\n  A[Brain dump] --> B[Task]",
                        },
                    ],
                }
            },
        )

    assert render_tool.meta["ui"]["resourceUri"] == ("ui://lifeos/brain-dump-canvas-v4.html")
    assert render_tool.annotations.readOnlyHint is True
    assert resource.mimeType == "text/html;profile=mcp-app"
    assert "Continue planning" in contents[0].text
    assert 'sandbox", "allow-scripts"' in contents[0].text
    assert "connect-src 'none'" in contents[0].text
    assert "frame.srcdoc = sandboxDocument(node)" in contents[0].text
    assert "window.requestAnimationFrame=()=>0" in contents[0].text
    assert "cdn.jsdelivr.net/npm/mermaid@11.17.2" in contents[0].text
    assert "mermaidApi.render" in contents[0].text
    assert "My tasks" in contents[0].text
    assert "Relations" in contents[0].text
    assert "Transcript" in contents[0].text
    assert 'const viewport = element("div", "map-viewport")' in contents[0].text
    assert 'addEventListener("pointerdown"' in contents[0].text
    assert "the renderer always expands the node" in (
        render_tool.inputSchema["properties"]["canvas"]["properties"]["nodes"]["items"]
        ["properties"]["min_height"]["description"]
    )
    assert result.structured_content["nodes"][0]["kind"] == "tasks"
    assert result.structured_content["nodes"][0]["items"][0]["assignee"] == "Avinaba"
    assert result.structured_content["transcript_segments"][0]["timestamp"] == "12:41"
    assert result.structured_content["mutates_external_systems"] is False


def test_brain_dump_canvas_rejects_invalid_custom_content_and_placement():
    with pytest.raises(ValidationError):
        BrainDumpCanvasOutput.model_validate(
            {
                "title": "Invalid",
                "nodes": [
                    {
                        "id": "bad",
                        "kind": "tasks",
                        "title": "Escapes the grid",
                        "x": 10,
                        "width": 5,
                        "html": "<script>alert(1)</script>",
                    }
                ],
            }
        )

    with pytest.raises(ValidationError):
        BrainDumpCanvasOutput.model_validate(
            {
                "title": "Invalid Mermaid",
                "nodes": [{"id": "bad-map", "kind": "mermaid", "title": "Missing source"}],
            }
        )


@pytest.mark.asyncio
async def test_day_plan_renderer_accepts_the_exact_plan_day_result():
    class FakePlannerService(FakeService):
        def plan_day_preview(self, **kwargs):
            return {
                "preview": {
                    "day_start": "2026-09-22T08:00:00+10:00",
                    "day_end": "2026-09-22T18:00:00+10:00",
                    "blocks": [
                        {
                            "task_id": "task-1",
                            "title": "Build the iOS feature",
                            "start": "2026-09-22T13:00:00+10:00",
                            "end": "2026-09-22T14:00:00+10:00",
                            "duration_minutes": 60,
                            "part": 1,
                            "calendar_id": kwargs["planner_calendar_id"],
                        }
                    ],
                    "unscheduled": [],
                },
                "blocks": [],
                "unscheduled": [],
                "things_changes": [],
                "calendar_changes": [],
                "proposal_ready": True,
                "mutates_external_systems": False,
            }

    mcp = create_mcp(FakePlannerService())
    async with Client(mcp) as client:
        plan = await client.call_tool(
            "plan_day",
            {
                "day_start": "2026-09-22T08:00:00+10:00",
                "day_end": "2026-09-22T18:00:00+10:00",
                "tasks": [
                    {
                        "task_id": "task-1",
                        "title": "Build the iOS feature",
                        "duration_minutes": 60,
                    }
                ],
            },
        )
        rendered = await client.call_tool("render_day_plan", plan.data)

    assert rendered.structured_content["blocks"][0]["task_id"] == "task-1"


def test_runtime_defaults_to_stdio_without_a_banner():
    config = parse_runtime_config([], environ={})

    assert config.transport == "stdio"
    assert config.host == DEFAULT_HOST
    assert config.port == DEFAULT_PORT
    assert config.path == DEFAULT_HTTP_PATH
    assert config.show_banner is False


def test_runtime_cli_overrides_environment(tmp_path):
    config = parse_runtime_config(
        [
            "--transport",
            "streamable-http",
            "--host",
            "::1",
            "--port",
            "9876",
            "--path",
            "/local-mcp",
            "--db-path",
            str(tmp_path / "state.sqlite3"),
            "--show-banner",
        ],
        environ={
            "LIFEOS_TRANSPORT": "stdio",
            "LIFEOS_PORT": "1111",
            "LIFEOS_HTTP_PATH": "/wrong",
        },
    )

    assert config.transport == "streamable-http"
    assert config.host == "::1"
    assert config.port == 9876
    assert config.path == "/local-mcp"
    assert config.database_path == tmp_path / "state.sqlite3"
    assert config.show_banner is True


def test_runtime_reads_streamable_http_environment(tmp_path):
    config = parse_runtime_config(
        [],
        environ={
            "LIFEOS_TRANSPORT": "streamable-http",
            "LIFEOS_HOST": "localhost",
            "LIFEOS_PORT": "8123",
            "LIFEOS_HTTP_PATH": "/local",
            "LIFEOS_DB_PATH": str(tmp_path / "state.sqlite3"),
            "LIFEOS_JOURNAL_DIR": str(tmp_path / "Journal"),
            "LIFEOS_LOG_LEVEL": "warning",
        },
    )

    assert config.transport == "streamable-http"
    assert config.host == "localhost"
    assert config.port == 8123
    assert config.path == "/local"
    assert config.database_path == tmp_path / "state.sqlite3"
    assert config.journal_dir == tmp_path / "Journal"
    assert config.log_level == "WARNING"


def test_runtime_reads_remote_oauth_secret_from_owner_file(tmp_path):
    secret_file = tmp_path / "github-oauth-secret"
    secret_file.write_text("secret-value\n")

    config = parse_runtime_config(
        [],
        environ={
            "LIFEOS_TRANSPORT": "streamable-http",
            "LIFEOS_PUBLIC_BASE_URL": "https://fixed-domain.ngrok-free.app",
            "LIFEOS_GITHUB_CLIENT_ID": "client-id",
            "LIFEOS_GITHUB_CLIENT_SECRET_FILE": str(secret_file),
            "LIFEOS_GITHUB_ALLOWED_LOGIN": "mars-s",
        },
    )

    assert config.oauth_enabled is True
    assert config.github_client_secret == "secret-value"
    assert "secret-value" not in repr(config)


def test_runtime_reads_remote_oauth_secret_from_keychain(monkeypatch):
    completed = subprocess.CompletedProcess([], 0, stdout="secret-value\n", stderr="")
    monkeypatch.setattr("lifeos.runtime.subprocess.run", lambda *args, **kwargs: completed)

    config = parse_runtime_config(
        [],
        environ={
            "LIFEOS_TRANSPORT": "streamable-http",
            "LIFEOS_PUBLIC_BASE_URL": "https://fixed-domain.ngrok-free.app",
            "LIFEOS_GITHUB_CLIENT_ID": "client-id",
            "LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_SERVICE": "LifeOS-GitHub-OAuth",
            "LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_ACCOUNT": "mars-s",
            "LIFEOS_GITHUB_ALLOWED_LOGIN": "mars-s",
        },
    )

    assert config.oauth_enabled is True
    assert config.github_client_secret == "secret-value"
    assert "secret-value" not in repr(config)


def test_runtime_rejects_partial_remote_oauth_configuration():
    with pytest.raises(SystemExit):
        parse_runtime_config(
            [],
            environ={
                "LIFEOS_TRANSPORT": "streamable-http",
                "LIFEOS_PUBLIC_BASE_URL": "https://fixed-domain.ngrok-free.app",
            },
        )


def test_runtime_rejects_non_loopback_http_bind():
    with pytest.raises(SystemExit):
        parse_runtime_config(["--transport", "streamable-http", "--host", "0.0.0.0"], environ={})


def test_health_route_reports_process_health():
    mcp = server.create_mcp(FakeService())

    with TestClient(mcp.http_app(path="/mcp", transport="streamable-http")) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "lifeos-mcp"}


def test_main_selects_stdio_transport(monkeypatch):
    calls = []

    class FakeMCP:
        def run(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr(server, "build_default_service", lambda config: object())
    monkeypatch.setattr(server, "create_mcp", lambda service: FakeMCP())

    server.main(["--transport", "stdio"])

    assert calls == [{"transport": "stdio", "show_banner": False, "log_level": None}]


def test_main_selects_loopback_streamable_http(monkeypatch):
    calls = []

    class FakeMCP:
        def run(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setattr(server, "build_default_service", lambda config: object())
    monkeypatch.setattr(server, "create_mcp", lambda service: FakeMCP())

    server.main(
        [
            "--transport",
            "streamable-http",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
            "--path",
            "/mcp",
        ]
    )

    assert calls == [
        {
            "transport": "streamable-http",
            "host": "127.0.0.1",
            "port": 8765,
            "path": "/mcp",
            "show_banner": False,
            "log_level": None,
        }
    ]
