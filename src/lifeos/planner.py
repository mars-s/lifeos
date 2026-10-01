"""Deterministic day planning over typed tasks and busy intervals.

This module deliberately has no Things, Calendar, MCP, or LLM dependencies.  It
turns already-read planning context into a stable schedule proposal.  The
caller owns the preview and confirmation boundary.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

PreferredTime = Literal["morning", "afternoon", "evening"]


@dataclass(frozen=True, slots=True)
class PlanningTask:
    """A Things task's local scheduling metadata."""

    task_id: str
    title: str
    duration_minutes: int
    minimum_block_minutes: int | None = None
    splittable: bool = False
    earliest_start: datetime | None = None
    deadline: datetime | None = None
    priority: int = 0
    preferred_time: PreferredTime | None = None

    def __post_init__(self) -> None:
        if not self.task_id or not self.title:
            raise ValueError("a planning task needs a task_id and title")
        if self.duration_minutes < 1:
            raise ValueError("duration_minutes must be positive")
        minimum = self.minimum_block_minutes or self.duration_minutes
        if minimum < 1 or minimum > self.duration_minutes:
            raise ValueError("minimum_block_minutes must be between 1 and duration_minutes")
        if self.earliest_start and self.deadline and self.earliest_start >= self.deadline:
            raise ValueError("earliest_start must be before deadline")

    @property
    def minimum_block(self) -> int:
        return self.minimum_block_minutes or self.duration_minutes


@dataclass(frozen=True, slots=True)
class BusyInterval:
    """An interval that the planner cannot use."""

    start: datetime
    end: datetime
    label: str | None = None

    def __post_init__(self) -> None:
        if self.start >= self.end:
            raise ValueError("busy interval start must be before end")


@dataclass(frozen=True, slots=True)
class PlannedBlock:
    task_id: str
    title: str
    start: datetime
    end: datetime
    part: int = 1

    @property
    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


@dataclass(frozen=True, slots=True)
class UnscheduledTask:
    task_id: str
    title: str
    reason: str
    remaining_minutes: int


@dataclass(frozen=True, slots=True)
class DayPlan:
    day_start: datetime
    day_end: datetime
    blocks: tuple[PlannedBlock, ...]
    unscheduled: tuple[UnscheduledTask, ...]


@dataclass(frozen=True, slots=True)
class PlanningWindow:
    """One usable day inside a multi-day planning range."""

    start: datetime
    end: datetime

    def __post_init__(self) -> None:
        if self.start >= self.end:
            raise ValueError("planning window start must be before end")


@dataclass(frozen=True, slots=True)
class RangePlan:
    """A schedule preview spanning multiple distinct day windows."""

    windows: tuple[PlanningWindow, ...]
    blocks: tuple[PlannedBlock, ...]
    unscheduled: tuple[UnscheduledTask, ...]


def plan_day(
    *,
    day_start: datetime,
    day_end: datetime,
    tasks: tuple[PlanningTask, ...] | list[PlanningTask],
    busy_intervals: tuple[BusyInterval, ...] | list[BusyInterval] = (),
) -> DayPlan:
    """Place tasks deterministically and return a non-mutating schedule preview.

    Higher-priority tasks win first.  Deadline and task ID break ties.  Within
    each task, candidate windows are chronological unless a preferred period
    has a matching window.  Existing busy intervals and previously placed
    blocks are treated as one occupied set.
    """

    _validate_clock(day_start, day_end, busy_intervals, tasks)
    occupied = _clip_and_sort_busy(busy_intervals, day_start, day_end)
    blocks: list[PlannedBlock] = []
    unscheduled: list[UnscheduledTask] = []

    ordered_tasks = sorted(tasks, key=_task_order)
    for task in ordered_tasks:
        remaining = task.duration_minutes
        task_blocks: list[PlannedBlock] = []
        part = 1
        while remaining:
            windows = _free_windows(day_start, day_end, occupied)
            lower = max(day_start, task.earliest_start or day_start)
            upper = min(day_end, task.deadline or day_end)
            candidate = _choose_window(
                windows,
                lower=lower,
                upper=upper,
                minutes=min(remaining, task.duration_minutes),
                task=task,
            )
            if candidate is None:
                break

            start, available = candidate
            if not task.splittable and available < remaining:
                break
            chunk = remaining if not task.splittable else min(remaining, available)
            if chunk < task.minimum_block:
                break
            end = start + timedelta(minutes=chunk)
            block = PlannedBlock(task.task_id, task.title, start, end, part)
            task_blocks.append(block)
            occupied.append(BusyInterval(start, end, f"planned:{task.task_id}"))
            remaining -= chunk
            part += 1
            if not task.splittable:
                break

        blocks.extend(task_blocks)
        if remaining:
            if task_blocks:
                reason = (
                    f"only {task.duration_minutes - remaining} of "
                    f"{task.duration_minutes} minutes fit before the deadline or in free time"
                )
            elif task.deadline and task.deadline <= day_start:
                reason = "deadline has passed at the start of the planning window"
            elif task.earliest_start and task.earliest_start >= day_end:
                reason = "earliest start is after the planning window"
            elif task.splittable:
                reason = f"no free block is at least {task.minimum_block} minutes"
            else:
                reason = f"no contiguous free block is at least {task.duration_minutes} minutes"
            unscheduled.append(UnscheduledTask(task.task_id, task.title, reason, remaining))

    ordered_blocks = sorted(blocks, key=lambda block: (block.start, block.end, block.task_id))
    return DayPlan(day_start, day_end, tuple(ordered_blocks), tuple(unscheduled))


def plan_range(
    *,
    windows: tuple[PlanningWindow, ...] | list[PlanningWindow],
    tasks: tuple[PlanningTask, ...] | list[PlanningTask],
    busy_intervals: tuple[BusyInterval, ...] | list[BusyInterval] = (),
) -> RangePlan:
    """Place tasks across separate day windows without filling overnight gaps."""

    ordered_windows = tuple(sorted(windows, key=lambda window: (window.start, window.end)))
    if not ordered_windows:
        raise ValueError("at least one planning window is required")
    for previous, current in zip(ordered_windows, ordered_windows[1:], strict=False):
        if previous.end > current.start:
            raise ValueError("planning windows must not overlap")
    _validate_clock(
        ordered_windows[0].start,
        ordered_windows[-1].end,
        busy_intervals,
        tasks,
    )

    occupied = [
        clipped
        for window in ordered_windows
        for clipped in _clip_and_sort_busy(busy_intervals, window.start, window.end)
    ]
    blocks: list[PlannedBlock] = []
    unscheduled: list[UnscheduledTask] = []

    for task in sorted(tasks, key=_task_order):
        remaining = task.duration_minutes
        task_blocks: list[PlannedBlock] = []
        part = 1
        while remaining:
            free_windows = [
                free
                for window in ordered_windows
                for free in _free_windows(window.start, window.end, occupied)
            ]
            lower = max(ordered_windows[0].start, task.earliest_start or ordered_windows[0].start)
            upper = min(ordered_windows[-1].end, task.deadline or ordered_windows[-1].end)
            candidate = _choose_window(
                free_windows,
                lower=lower,
                upper=upper,
                minutes=min(remaining, task.duration_minutes),
                task=task,
            )
            if candidate is None:
                break
            start, available = candidate
            if not task.splittable and available < remaining:
                break
            chunk = remaining if not task.splittable else min(remaining, available)
            if chunk < task.minimum_block:
                break
            end = start + timedelta(minutes=chunk)
            block = PlannedBlock(task.task_id, task.title, start, end, part)
            task_blocks.append(block)
            occupied.append(BusyInterval(start, end, f"planned:{task.task_id}"))
            remaining -= chunk
            part += 1
            if not task.splittable:
                break

        blocks.extend(task_blocks)
        if remaining:
            if task_blocks:
                reason = (
                    f"only {task.duration_minutes - remaining} of "
                    f"{task.duration_minutes} minutes fit across the planning range"
                )
            elif task.deadline and task.deadline <= ordered_windows[0].start:
                reason = "deadline has passed at the start of the planning range"
            elif task.earliest_start and task.earliest_start >= ordered_windows[-1].end:
                reason = "earliest start is after the planning range"
            elif task.splittable:
                reason = f"no free block is at least {task.minimum_block} minutes"
            else:
                reason = f"no contiguous free block is at least {task.duration_minutes} minutes"
            unscheduled.append(UnscheduledTask(task.task_id, task.title, reason, remaining))

    ordered_blocks = tuple(sorted(blocks, key=lambda block: (block.start, block.end, block.task_id)))
    return RangePlan(ordered_windows, ordered_blocks, tuple(unscheduled))


def _task_order(task: PlanningTask) -> tuple[int, bool, datetime, str]:
    return (-task.priority, task.deadline is None, task.deadline or datetime.max, task.task_id)


def _validate_clock(
    day_start: datetime,
    day_end: datetime,
    busy_intervals: tuple[BusyInterval, ...] | list[BusyInterval],
    tasks: tuple[PlanningTask, ...] | list[PlanningTask],
) -> None:
    if day_start >= day_end:
        raise ValueError("day_start must be before day_end")
    all_values = [day_start, day_end]
    all_values.extend(
        value for interval in busy_intervals for value in (interval.start, interval.end)
    )
    all_values.extend(
        value
        for task in tasks
        for value in (task.earliest_start, task.deadline)
        if value is not None
    )
    aware = {value.tzinfo is not None for value in all_values}
    if len(aware) > 1:
        raise ValueError("planning datetimes must all be timezone-aware or all be naive")


def _clip_and_sort_busy(
    intervals: tuple[BusyInterval, ...] | list[BusyInterval],
    day_start: datetime,
    day_end: datetime,
) -> list[BusyInterval]:
    clipped: list[BusyInterval] = []
    for interval in intervals:
        start = max(interval.start, day_start)
        end = min(interval.end, day_end)
        if start < end:
            clipped.append(BusyInterval(start, end, interval.label))
    return sorted(clipped, key=lambda interval: (interval.start, interval.end))


def _free_windows(
    day_start: datetime,
    day_end: datetime,
    occupied: list[BusyInterval],
) -> list[tuple[datetime, datetime]]:
    windows: list[tuple[datetime, datetime]] = []
    cursor = day_start
    for interval in sorted(occupied, key=lambda value: (value.start, value.end)):
        if interval.start > cursor:
            windows.append((cursor, interval.start))
        cursor = max(cursor, interval.end)
    if cursor < day_end:
        windows.append((cursor, day_end))
    return windows


def _choose_window(
    windows: list[tuple[datetime, datetime]],
    *,
    lower: datetime,
    upper: datetime,
    minutes: int,
    task: PlanningTask,
) -> tuple[datetime, int] | None:
    candidates: list[tuple[bool, datetime, int]] = []
    required = minutes if not task.splittable else task.minimum_block
    for window_start, window_end in windows:
        start = max(window_start, lower)
        end = min(window_end, upper)
        available = int((end - start).total_seconds() // 60)
        if available >= required:
            candidates.append((_preferred_period_mismatch(task, start), start, available))
    if not candidates:
        return None
    _mismatch, start, available = min(candidates, key=lambda value: (value[0], value[1]))
    return start, min(available, minutes if task.splittable else available)


def _preferred_period_mismatch(task: PlanningTask, start: datetime) -> bool:
    if task.preferred_time is None:
        return False
    hour = start.hour
    period = "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"
    return period != task.preferred_time
