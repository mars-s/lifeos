from __future__ import annotations

from datetime import datetime

import pytest
from fastmcp import Client

from lifeos.planner import BusyInterval, PlanningTask, PlanningWindow, plan_day, plan_range
from lifeos.server import create_mcp
from lifeos.service import LifeOSService

DAY_START = datetime(2026, 9, 22, 9, 0)
DAY_END = datetime(2026, 9, 22, 17, 0)


def test_priority_and_busy_intervals_produce_stable_non_overlapping_blocks():
    result = plan_day(
        day_start=DAY_START,
        day_end=DAY_END,
        busy_intervals=[BusyInterval(datetime(2026, 9, 22, 10), datetime(2026, 9, 22, 11))],
        tasks=[
            PlanningTask("low", "Low priority", 60, priority=1),
            PlanningTask("high", "High priority", 60, priority=2),
        ],
    )

    assert [(block.task_id, block.start.hour, block.end.hour) for block in result.blocks] == [
        ("high", 9, 10),
        ("low", 11, 12),
    ]
    assert result.unscheduled == ()


def test_splittable_task_uses_minimum_blocks_and_explains_remainder():
    result = plan_day(
        day_start=DAY_START,
        day_end=datetime(2026, 9, 22, 12),
        tasks=[PlanningTask("task", "Split me", 150, minimum_block_minutes=30, splittable=True)],
        busy_intervals=[BusyInterval(datetime(2026, 9, 22, 10), datetime(2026, 9, 22, 11))],
    )

    assert [(block.start.hour, block.end.hour) for block in result.blocks] == [(9, 10), (11, 12)]
    assert result.unscheduled[0].remaining_minutes == 30
    assert "only 120 of 150 minutes fit" in result.unscheduled[0].reason


def test_unsplittable_task_reports_missing_contiguous_window():
    result = plan_day(
        day_start=DAY_START,
        day_end=datetime(2026, 9, 22, 12),
        tasks=[PlanningTask("task", "Long task", 90)],
        busy_intervals=[
            BusyInterval(datetime(2026, 9, 22, 9, 30), datetime(2026, 9, 22, 10)),
            BusyInterval(datetime(2026, 9, 22, 11), datetime(2026, 9, 22, 12)),
        ],
    )

    assert result.blocks == ()
    assert result.unscheduled[0].remaining_minutes == 90
    assert "contiguous" in result.unscheduled[0].reason


def test_unsplittable_task_skips_shorter_window_for_later_fit():
    result = plan_day(
        day_start=DAY_START,
        day_end=datetime(2026, 9, 22, 14),
        tasks=[PlanningTask("task", "Long task", 90, minimum_block_minutes=30)],
        busy_intervals=[BusyInterval(datetime(2026, 9, 22, 10), datetime(2026, 9, 22, 12, 30))],
    )

    assert [(block.start.hour, block.end.hour) for block in result.blocks] == [(12, 14)]


def test_range_planner_uses_separate_days_without_scheduling_overnight():
    result = plan_range(
        windows=[
            PlanningWindow(datetime(2026, 9, 22, 9), datetime(2026, 9, 22, 10)),
            PlanningWindow(datetime(2026, 9, 23, 9), datetime(2026, 9, 23, 11)),
        ],
        tasks=[
            PlanningTask("first", "First", 60, priority=2),
            PlanningTask("second", "Second", 90, priority=1),
        ],
    )

    assert [(block.task_id, block.start.day, block.start.hour) for block in result.blocks] == [
        ("first", 22, 9),
        ("second", 23, 9),
    ]
    assert result.unscheduled == ()


def test_range_planner_can_split_work_across_days_and_preserves_part_numbers():
    result = plan_range(
        windows=[
            PlanningWindow(datetime(2026, 9, 22, 9), datetime(2026, 9, 22, 10)),
            PlanningWindow(datetime(2026, 9, 23, 9), datetime(2026, 9, 23, 10)),
        ],
        tasks=[PlanningTask("split", "Split", 120, minimum_block_minutes=30, splittable=True)],
    )

    assert [(block.start.day, block.part) for block in result.blocks] == [(22, 1), (23, 2)]
    assert result.unscheduled == ()


def test_range_planner_rejects_overlapping_day_windows():
    with pytest.raises(ValueError, match="must not overlap"):
        plan_range(
            windows=[
                PlanningWindow(datetime(2026, 9, 22, 9), datetime(2026, 9, 22, 12)),
                PlanningWindow(datetime(2026, 9, 22, 11), datetime(2026, 9, 22, 14)),
            ],
            tasks=[],
        )


def test_service_preview_does_not_call_external_gateways(tmp_path):
    class NoGatewayCalls:
        def __getattr__(self, name):
            raise AssertionError(f"dry-run called gateway method {name}")

    service = LifeOSService(
        store=object(),
        things=NoGatewayCalls(),
        calendar=NoGatewayCalls(),
    )
    result = service.plan_day_preview(
        day_start="2026-09-22T09:00:00",
        day_end="2026-09-22T10:00:00",
        tasks=[{"task_id": "task", "title": "Task", "duration_minutes": 30}],
    )

    assert result["mutates_external_systems"] is False
    assert result["calendar_changes"][0]["fields"]["things_id"] == "task"


def test_service_accepts_spec_metadata_aliases():
    service = LifeOSService(store=object(), things=object(), calendar=object())
    result = service.plan_day_preview(
        day_start="2026-09-22T09:00:00",
        day_end="2026-09-22T10:00:00",
        tasks=[
            {
                "things_id": "task",
                "title": "Task",
                "estimated_duration": 30,
                "importance": 2,
            }
        ],
    )

    assert result["blocks"][0]["task_id"] == "task"


@pytest.mark.asyncio
async def test_plan_day_mcp_tool_is_read_only_and_returns_proposal_shape():
    class FakeService:
        def plan_day_preview(self, **kwargs):
            assert kwargs["planner_calendar_id"] == "planned-tasks"
            return {
                "preview": {"blocks": [], "unscheduled": []},
                "blocks": [],
                "unscheduled": [],
                "things_changes": [],
                "calendar_changes": [],
                "proposal_ready": True,
                "mutates_external_systems": False,
            }

    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        tool = next(item for item in tools if item.name == "plan_day")
        result = await client.call_tool(
            "plan_day",
            {
                "day_start": "2026-09-22T09:00:00",
                "day_end": "2026-09-22T17:00:00",
                "tasks": [{"task_id": "task", "title": "Task", "duration_minutes": 30}],
            },
        )

    assert tool.annotations.readOnlyHint is True
    assert result.data["proposal_ready"] is True
    assert result.data["mutates_external_systems"] is False


@pytest.mark.asyncio
async def test_plan_week_mcp_tool_is_read_only_and_groups_days():
    class FakeService:
        def plan_range_preview(self, **kwargs):
            assert len(kwargs["days"]) == 2
            return {
                "preview": {
                    "range_start": "2026-09-22T09:00:00",
                    "range_end": "2026-09-23T17:00:00",
                    "days": [],
                    "unscheduled": [],
                },
                "days": [],
                "unscheduled": [],
                "things_changes": [],
                "calendar_changes": [],
                "proposal_ready": True,
                "mutates_external_systems": False,
            }

    mcp = create_mcp(FakeService())
    async with Client(mcp) as client:
        tools = await client.list_tools()
        tool = next(item for item in tools if item.name == "plan_week")
        result = await client.call_tool(
            "plan_week",
            {
                "days": [
                    {"day_start": "2026-09-22T09:00:00", "day_end": "2026-09-22T17:00:00"},
                    {"day_start": "2026-09-23T09:00:00", "day_end": "2026-09-23T17:00:00"},
                ],
                "tasks": [{"task_id": "task", "title": "Task", "duration_minutes": 30}],
            },
        )

    assert tool.annotations.readOnlyHint is True
    assert result.data["proposal_ready"] is True
