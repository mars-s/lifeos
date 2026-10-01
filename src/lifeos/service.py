"""Application service joining proposal safety to Things and Calendar gateways."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from datetime import datetime
from enum import Enum
from typing import Any

from .brain_dump_store import BrainDumpConflict, BrainDumpStore
from .memory_gateway import MemoryGatewayError, SupermemoryGateway, UnknownMemoryDocument
from .models import (
    CalendarChange,
    ChangeOperation,
    ProposalRevision,
    ProposalState,
    SourceSnapshot,
    ThingsChange,
)
from .planner import BusyInterval, PlanningTask, PlanningWindow, plan_day, plan_range
from .proposal_store import ProposalStore


class ApplyError(RuntimeError):
    """A reviewed external change could not be verified."""


def _jsonable(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if is_dataclass(value) and not isinstance(value, type):
        return _jsonable(asdict(value))
    if isinstance(value, Mapping):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def proposal_to_dict(proposal: ProposalRevision) -> dict[str, Any]:
    return _jsonable(proposal)


class LifeOSService:
    """The only component allowed to call gateway mutation methods."""

    def __init__(
        self,
        store: ProposalStore,
        things: Any,
        calendar: Any,
        brain_dumps: BrainDumpStore | None = None,
        memory: SupermemoryGateway | None = None,
    ) -> None:
        self.store = store
        self.things = things
        self.calendar = calendar
        self.brain_dumps = brain_dumps
        self.memory = memory

    def capture_brain_dump(self, **fields: Any) -> dict[str, Any]:
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        return self.brain_dumps.capture(**fields)

    def submit_brain_dump_semanticization(self, **fields: Any) -> dict[str, Any]:
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        return self.brain_dumps.submit_semanticization(**fields)

    def get_brain_dump(self, capture_id: str) -> dict[str, Any]:
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        return self.brain_dumps.get(capture_id)

    def list_brain_dumps(self, *, limit: int = 20, offset: int = 0, include_tests: bool = False) -> dict[str, Any]:
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        return self.brain_dumps.list(limit=limit, offset=offset, include_tests=include_tests)

    def search_brain_dumps(self, query: str, *, limit: int = 20, include_tests: bool = False) -> dict[str, Any]:
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        return self.brain_dumps.search(query, limit=limit, include_tests=include_tests)

    def index_brain_dump_memory(self, capture_id: str, source_hash: str) -> dict[str, Any]:
        """Index one exact capture without changing its canonical LifeOS record."""
        if self.brain_dumps is None or self.memory is None:
            raise RuntimeError("local memory indexing is not configured")
        capture = self.brain_dumps.get(capture_id)
        if capture["source_hash"] != source_hash:
            raise BrainDumpConflict("source_hash does not match the stored raw capture")

        receipt = self.brain_dumps.get_memory_receipt(capture_id)
        container_tag = self._memory_container_tag(capture)
        custom_id = f"lifeos-capture-{capture_id}"
        if receipt is not None:
            document = self.memory.get_document(receipt["document_id"])
        else:
            try:
                document = self.memory.get_document(custom_id)
            except UnknownMemoryDocument:
                document = self.memory.add_document(
                    content=capture["raw_text"], custom_id=custom_id, container_tag=container_tag
                )
                document = self.memory.get_document(str(document["id"]))

        self._validate_memory_document(capture, document)
        if document.get("status") == "failed":
            self.memory.add_document(content=capture["raw_text"], custom_id=custom_id, container_tag=container_tag)
            document = self.memory.get_document(custom_id)

        document_id = str(document["id"])
        receipt = self.brain_dumps.record_memory_receipt(
            capture_id=capture_id, source_hash=source_hash, document_id=document_id
        )
        self._record_memory_sources(capture_id, document)
        return self._memory_status(capture_id, document, receipt)

    def get_brain_dump_memory_status(self, capture_id: str) -> dict[str, Any]:
        if self.brain_dumps is None or self.memory is None:
            raise RuntimeError("local memory indexing is not configured")
        receipt = self.brain_dumps.get_memory_receipt(capture_id)
        if receipt is None:
            return {"capture_id": capture_id, "status": "not_indexed"}
        try:
            document = self.memory.get_document(receipt["document_id"])
        except UnknownMemoryDocument as error:
            raise MemoryGatewayError("indexed memory document is missing") from error
        capture = self.brain_dumps.get(capture_id)
        if receipt["source_hash"] != capture["source_hash"]:
            raise BrainDumpConflict("memory receipt does not match the stored raw capture")
        self._validate_memory_document(capture, document)
        self._record_memory_sources(capture_id, document)
        return self._memory_status(capture_id, document, receipt)

    def recall_memory(self, query: str, *, limit: int = 10, scope: str = "personal") -> dict[str, Any]:
        if self.memory is None or self.brain_dumps is None:
            raise RuntimeError("local memory search is not configured")
        clean_query = query.strip()
        if not clean_query:
            raise ValueError("query must not be empty")
        if not 1 <= limit <= 20:
            raise ValueError("limit must be between 1 and 20")
        if scope not in {"personal", "test"}:
            raise ValueError("scope must be personal or test")
        response = self.memory.search(
            clean_query, limit=limit, container_tag="lifeos-test" if scope == "test" else "lifeos"
        )
        results = []
        for item in response.get("results", [])[:limit]:
            if not isinstance(item, dict):
                continue
            source_capture_ids = []
            for document in item.get("documents", []):
                document_id = document.get("id", "")
                if document_id.startswith("lifeos-capture-"):
                    source_capture_ids.append(document_id.removeprefix("lifeos-capture-"))
            if "memory" in item and item.get("id"):
                source_capture_ids.extend(
                    self.brain_dumps.capture_ids_for_memory(str(item["id"]))
                )
            source_capture_ids = sorted(set(source_capture_ids))
            results.append(
                {
                    "kind": "derived_memory" if "memory" in item else "source_chunk",
                    "text": item.get("memory", item.get("chunk", "")),
                    "similarity": item.get("similarity"),
                    "source_capture_ids": source_capture_ids,
                    "has_source_link": bool(source_capture_ids),
                }
            )
        return {
            "query": clean_query,
            "results": results,
            "count": len(results),
            "content_is_untrusted": True,
            "scope": scope,
        }

    def review_brain_dump_memory(self, capture_id: str) -> dict[str, Any]:
        """Show extracted claims next to their exact source, without promoting them to facts."""
        if self.brain_dumps is None or self.memory is None:
            raise RuntimeError("local memory indexing is not configured")
        capture = self.brain_dumps.get(capture_id)
        receipt = self.brain_dumps.get_memory_receipt(capture_id)
        if receipt is None:
            return {
                "capture_id": capture_id,
                "source_hash": capture["source_hash"],
                "raw_text": capture["raw_text"],
                "status": "not_indexed",
                "claims": [],
                "content_is_untrusted": True,
            }
        if receipt["source_hash"] != capture["source_hash"]:
            raise BrainDumpConflict("memory receipt does not match the stored raw capture")
        document = self.memory.get_document(receipt["document_id"])
        self._validate_memory_document(capture, document)
        claims = [
            {"memory_id": str(item["id"]), "text": str(item["memory"]), "review_status": "unreviewed"}
            for item in document.get("memories", [])
            if isinstance(item, dict) and item.get("id") and isinstance(item.get("memory"), str)
        ]
        return {
            "capture_id": capture_id,
            "source_hash": capture["source_hash"],
            "raw_text": capture["raw_text"],
            "status": document.get("status", "unknown"),
            "claims": claims,
            "content_is_untrusted": True,
        }

    @staticmethod
    def _memory_container_tag(capture: Mapping[str, Any]) -> str:
        return "lifeos-test" if capture["source"] == "synthetic_test" else "lifeos"

    def _record_memory_sources(self, capture_id: str, document: Mapping[str, Any]) -> None:
        if self.brain_dumps is None or document.get("status") != "done":
            return
        memory_ids = [
            str(memory["id"])
            for memory in document.get("memories", [])
            if isinstance(memory, dict) and memory.get("id")
        ]
        self.brain_dumps.record_memory_sources(capture_id, memory_ids)

    @staticmethod
    def _validate_memory_document(
        capture: Mapping[str, Any], document: Mapping[str, Any]
    ) -> None:
        if document.get("content") != capture["raw_text"]:
            raise BrainDumpConflict("memory document content differs from the raw capture")
        if document.get("customId") != f"lifeos-capture-{capture['capture_id']}" or LifeOSService._memory_container_tag(capture) not in document.get(
            "containerTags", []
        ):
            raise BrainDumpConflict("memory document does not belong to this LifeOS capture")

    @staticmethod
    def _memory_status(
        capture_id: str, document: Mapping[str, Any], receipt: Mapping[str, str]
    ) -> dict[str, Any]:
        return {
            "capture_id": capture_id,
            "source_hash": receipt["source_hash"],
            "document_id": receipt["document_id"],
            "status": document.get("status"),
            "memory_count": len(document.get("memories") or []),
            "indexed_at": receipt["indexed_at"],
        }

    def read_things_list(
        self, list_name: str, *, limit: int | None = 100, offset: int = 0
    ) -> dict[str, Any]:
        page = self.things.read_list(list_name, limit=limit, offset=offset)
        return self._add_things_snapshots(page)

    def search_things(
        self, query: str, *, limit: int | None = 100, offset: int = 0
    ) -> dict[str, Any]:
        page = self.things.search_todos(query, limit=limit, offset=offset)
        return self._add_things_snapshots(page)

    def read_projects(self, *, limit: int | None = 100, offset: int = 0) -> dict[str, Any]:
        page = self.things.read_projects(limit=limit, offset=offset)
        return self._add_things_snapshots(page)

    def read_areas(self, *, limit: int | None = 100, offset: int = 0) -> dict[str, Any]:
        page = self.things.read_areas(limit=limit, offset=offset)
        return self._add_things_snapshots(page)

    def read_tags(self, *, limit: int | None = 100, offset: int = 0) -> dict[str, Any]:
        page = self.things.read_tags(limit=limit, offset=offset)
        return self._add_things_snapshots(page)

    def things_deep_link(self, item_id: str) -> dict[str, str]:
        return {"url": self.things.deep_link(item_id)}

    def read_calendar(
        self, start: str, end: str, calendar_ids: Sequence[str] | None = None
    ) -> dict[str, Any]:
        result = self.calendar.list_event_occurrences(start, end, calendar_ids)
        query = {
            "start": start,
            "end": end,
            "calendar_ids": list(calendar_ids) if calendar_ids else None,
            "event_ids": [event["event_identifier"] for event in result.events],
        }
        record_id = f"{start}|{end}|{','.join(calendar_ids or ())}"
        return {
            "events": list(result.events),
            "source_hash": result.source_hash,
            "snapshot": SourceSnapshot(
                system="calendar_range",
                record_id=record_id,
                version=result.source_hash,
                data=query,
            ).to_dict(),
            "content_is_untrusted": True,
        }

    def plan_day_preview(
        self,
        *,
        day_start: str | datetime,
        day_end: str | datetime,
        tasks: Sequence[Mapping[str, Any]],
        busy_intervals: Sequence[Mapping[str, Any]] = (),
        planner_calendar_id: str = "planned-tasks",
    ) -> dict[str, Any]:
        """Build a deterministic, proposal-ready preview without external writes."""
        if not planner_calendar_id:
            raise ValueError("planner_calendar_id must not be empty")
        start = self._planning_datetime(day_start, "day_start")
        end = self._planning_datetime(day_end, "day_end")
        planning_tasks = tuple(self._planning_task(item) for item in tasks)
        busy = tuple(self._busy_interval(item) for item in busy_intervals)
        result = plan_day(day_start=start, day_end=end, tasks=planning_tasks, busy_intervals=busy)

        blocks = [
            {
                "task_id": block.task_id,
                "title": block.title,
                "start": block.start.isoformat(),
                "end": block.end.isoformat(),
                "duration_minutes": block.duration_minutes,
                "part": block.part,
                "calendar_id": planner_calendar_id,
            }
            for block in result.blocks
        ]
        calendar_changes = [
            {
                "operation": "create",
                "calendar_id": planner_calendar_id,
                "event_id": None,
                "fields": {
                    "things_id": block["task_id"],
                    "title": block["title"],
                    "start": block["start"],
                    "end": block["end"],
                },
                "destructive": False,
            }
            for block in blocks
        ]
        unscheduled = [
            {
                "task_id": item.task_id,
                "title": item.title,
                "reason": item.reason,
                "remaining_minutes": item.remaining_minutes,
            }
            for item in result.unscheduled
        ]
        preview = {
            "day_start": start.isoformat(),
            "day_end": end.isoformat(),
            "blocks": blocks,
            "unscheduled": unscheduled,
        }
        return {
            "preview": preview,
            "blocks": blocks,
            "unscheduled": unscheduled,
            "things_changes": [],
            "calendar_changes": calendar_changes,
            "proposal_ready": True,
            "mutates_external_systems": False,
        }

    def plan_range_preview(
        self,
        *,
        days: Sequence[Mapping[str, Any]],
        tasks: Sequence[Mapping[str, Any]],
        busy_intervals: Sequence[Mapping[str, Any]] = (),
        planner_calendar_id: str = "planned-tasks",
    ) -> dict[str, Any]:
        """Build a deterministic multi-day preview without external writes."""
        if not planner_calendar_id:
            raise ValueError("planner_calendar_id must not be empty")
        windows = tuple(
            PlanningWindow(
                self._planning_datetime(day["day_start"], "day_start"),
                self._planning_datetime(day["day_end"], "day_end"),
            )
            for day in days
        )
        planning_tasks = tuple(self._planning_task(item) for item in tasks)
        busy = tuple(self._busy_interval(item) for item in busy_intervals)
        result = plan_range(windows=windows, tasks=planning_tasks, busy_intervals=busy)

        blocks = [
            {
                "task_id": block.task_id,
                "title": block.title,
                "start": block.start.isoformat(),
                "end": block.end.isoformat(),
                "duration_minutes": block.duration_minutes,
                "part": block.part,
                "calendar_id": planner_calendar_id,
            }
            for block in result.blocks
        ]
        rendered_days = [
            {
                "day_start": window.start.isoformat(),
                "day_end": window.end.isoformat(),
                "blocks": [
                    block
                    for block in blocks
                    if window.start <= self._planning_datetime(block["start"], "start") < window.end
                ],
            }
            for window in result.windows
        ]
        unscheduled = [
            {
                "task_id": item.task_id,
                "title": item.title,
                "reason": item.reason,
                "remaining_minutes": item.remaining_minutes,
            }
            for item in result.unscheduled
        ]
        calendar_changes = [
            {
                "operation": "create",
                "calendar_id": planner_calendar_id,
                "event_id": None,
                "fields": {
                    "things_id": block["task_id"],
                    "title": block["title"],
                    "start": block["start"],
                    "end": block["end"],
                },
                "destructive": False,
            }
            for block in blocks
        ]
        preview = {
            "range_start": result.windows[0].start.isoformat(),
            "range_end": result.windows[-1].end.isoformat(),
            "days": rendered_days,
            "unscheduled": unscheduled,
        }
        return {
            "preview": preview,
            "days": rendered_days,
            "unscheduled": unscheduled,
            "things_changes": [],
            "calendar_changes": calendar_changes,
            "proposal_ready": True,
            "mutates_external_systems": False,
        }

    @staticmethod
    def _planning_datetime(value: str | datetime, field: str) -> datetime:
        if isinstance(value, datetime):
            return value
        if not isinstance(value, str) or not value:
            raise ValueError(f"{field} must be an ISO-8601 datetime")
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError(f"{field} must be an ISO-8601 datetime") from error

    @classmethod
    def _planning_task(cls, value: Mapping[str, Any]) -> PlanningTask:
        task_id = value.get("task_id") or value.get("things_id")
        duration = value.get("duration_minutes")
        if duration is None:
            duration = value.get("estimated_duration")
        minimum = value.get("minimum_block_minutes")
        if minimum is None:
            minimum = value.get("minimum_block")
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("each planning task needs task_id")
        if not isinstance(value.get("title"), str) or not value["title"]:
            raise ValueError("each planning task needs title")
        if not isinstance(duration, int) or isinstance(duration, bool):
            raise ValueError("each planning task needs duration_minutes")
        if minimum is not None and (not isinstance(minimum, int) or isinstance(minimum, bool)):
            raise ValueError("minimum_block_minutes must be an integer")
        priority = value.get("importance")
        if priority is None:
            priority = value.get("priority", 0)
        if not isinstance(priority, int) or isinstance(priority, bool):
            raise ValueError("priority must be an integer")
        preferred = value.get("preferred_time")
        if preferred not in {None, "morning", "afternoon", "evening"}:
            raise ValueError("preferred_time must be morning, afternoon, or evening")
        return PlanningTask(
            task_id=task_id,
            title=value["title"],
            duration_minutes=duration,
            minimum_block_minutes=minimum,
            splittable=bool(value.get("splittable", False)),
            earliest_start=(
                cls._planning_datetime(value["earliest_start"], "earliest_start")
                if value.get("earliest_start") is not None
                else None
            ),
            deadline=(
                cls._planning_datetime(value["deadline"], "deadline")
                if value.get("deadline") is not None
                else None
            ),
            priority=priority,
            preferred_time=preferred,
        )

    @classmethod
    def _busy_interval(cls, value: Mapping[str, Any]) -> BusyInterval:
        return BusyInterval(
            start=cls._planning_datetime(value.get("start"), "busy interval start"),
            end=cls._planning_datetime(value.get("end"), "busy interval end"),
            label=value.get("label", value.get("title")),
        )

    def list_calendars(self) -> dict[str, Any]:
        result = self.calendar.list_calendars()
        return {"calendars": list(result.calendars), "source_hash": result.source_hash}

    def calendar_authorization_status(self) -> dict[str, str]:
        return {"status": self.calendar.authorization_status()}

    def request_calendar_authorization(self) -> dict[str, Any]:
        return self.calendar.request_authorization()

    def create_planner_calendar(
        self, title: str = "Planned Tasks", source_id: str | None = None
    ) -> dict[str, Any]:
        if title != "Planned Tasks":
            raise ValueError("V1 only creates the dedicated Planned Tasks calendar")
        return self.calendar.create_planner_calendar(title, source_id)

    @staticmethod
    def _add_things_snapshots(page: Mapping[str, Any]) -> dict[str, Any]:
        copied = dict(page)
        items: list[dict[str, Any]] = []
        for item in page.get("items", []):
            enriched = dict(item)
            record = enriched.get("record", {})
            record_id = record.get("uuid") or record.get("id")
            if not isinstance(record_id, str) or not record_id:
                raise ValueError("Things returned a record without an ID")
            enriched["snapshot"] = SourceSnapshot(
                system="things",
                record_id=record_id,
                version=str(enriched["source_hash"]),
                data={"kind": str(record.get("type", "to-do"))},
            ).to_dict()
            items.append(enriched)
        copied["items"] = items
        return copied

    def create_proposal(
        self,
        *,
        proposal_id: str,
        idempotency_key: str,
        source_snapshots: Sequence[Mapping[str, Any]],
        things_changes: Sequence[Mapping[str, Any]] = (),
        calendar_changes: Sequence[Mapping[str, Any]] = (),
    ) -> dict[str, Any]:
        snapshots = tuple(SourceSnapshot.from_dict(item) for item in source_snapshots)
        things = tuple(ThingsChange.from_dict(item) for item in things_changes)
        calendar = tuple(CalendarChange.from_dict(item) for item in calendar_changes)
        self._validate_proposal(snapshots, things, calendar)
        revision = self.store.create_draft(
            proposal_id,
            idempotency_key=idempotency_key,
            source_snapshots=snapshots,
            things_changes=things,
            calendar_changes=calendar,
        )
        return proposal_to_dict(revision)

    @staticmethod
    def _validate_proposal(
        snapshots: Sequence[SourceSnapshot],
        things: Sequence[ThingsChange],
        calendar: Sequence[CalendarChange],
    ) -> None:
        if not things and not calendar:
            raise ValueError("a proposal needs at least one change")
        if len(things) + len(calendar) > 100:
            raise ValueError("a proposal may contain at most 100 changes")
        things_snapshots = {item.record_id: item for item in snapshots if item.system == "things"}
        calendar_snapshots = [item for item in snapshots if item.system == "calendar_range"]
        reviewed_event_ids = {
            str(event_id)
            for snapshot in calendar_snapshots
            for event_id in snapshot.data.get("event_ids", [])
        }
        for change in things:
            if change.operation is ChangeOperation.DELETE:
                raise ValueError("Things deletion is not supported")
            if change.operation is ChangeOperation.CREATE:
                title = change.fields.get("title")
                if not isinstance(title, str) or not title:
                    raise ValueError("a new Things to-do needs a title")
                continue
            if change.task_id not in things_snapshots:
                raise ValueError("each existing Things item needs a reviewed source snapshot")
            reviewed_kind = str(things_snapshots[change.task_id].data.get("kind", "to-do"))
            requested_kind = str(change.fields.get("item_kind", "todo"))
            if (reviewed_kind == "project") != (requested_kind == "project"):
                raise ValueError("Things item kind must match its reviewed snapshot")
        if calendar and not calendar_snapshots:
            raise ValueError("Calendar changes need a reviewed calendar-range snapshot")
        for change in calendar:
            if (
                change.operation in {ChangeOperation.UPDATE, ChangeOperation.DELETE}
                and change.event_id not in reviewed_event_ids
            ):
                raise ValueError("Calendar event must appear in a reviewed range snapshot")
            if change.operation is ChangeOperation.CREATE:
                required = ("title", "start", "end")
                missing = [field for field in required if not change.fields.get(field)]
                if missing:
                    raise ValueError("a calendar event needs title, start, and end")

    def get_proposal(self, proposal_id: str) -> dict[str, Any]:
        return proposal_to_dict(self.store.get_current(proposal_id))

    def approve_proposal(self, proposal_id: str, revision_hash: str) -> dict[str, Any]:
        return proposal_to_dict(self.store.approve(proposal_id, revision_hash))

    def reject_proposal(self, proposal_id: str, revision_hash: str) -> dict[str, Any]:
        return proposal_to_dict(self.store.reject(proposal_id, revision_hash))

    def apply_proposal(self, proposal_id: str, revision_hash: str) -> dict[str, Any]:
        revision = self.store.get_revision(proposal_id, revision_hash)
        if revision.state is ProposalState.APPLIED:
            return proposal_to_dict(revision)
        if revision.state is ProposalState.APPROVED:
            observed = tuple(self._observe(snapshot) for snapshot in revision.source_snapshots)
            revision = self.store.check_freshness(proposal_id, revision_hash, observed)
            if revision.state is ProposalState.STALE:
                return proposal_to_dict(revision)
        revision = self.store.begin_apply(proposal_id, revision_hash)
        try:
            for index, change in enumerate(revision.things_changes):
                self._apply_once(
                    proposal_id,
                    revision_hash,
                    "things",
                    index,
                    lambda change=change: self._apply_things(change),
                )
            for index, change in enumerate(revision.calendar_changes):
                self._apply_once(
                    proposal_id,
                    revision_hash,
                    "calendar",
                    index,
                    lambda index=index, change=change: self._apply_calendar(
                        proposal_id, index, change
                    ),
                )
        except Exception as error:
            failed = self.store.finish_apply(
                proposal_id,
                revision_hash,
                partial_failure=f"{type(error).__name__}: {error}",
            )
            return proposal_to_dict(failed)
        return proposal_to_dict(self.store.finish_apply(proposal_id, revision_hash))

    def _apply_once(
        self, proposal_id: str, revision_hash: str, domain: str, index: int, action: Any
    ) -> None:
        if self.store.get_operation_result(proposal_id, revision_hash, domain, index) is not None:
            return
        result = _jsonable(action())
        if not isinstance(result, dict):
            raise ApplyError("gateway did not return an object result")
        self.store.record_operation_result(proposal_id, revision_hash, domain, index, result)

    def _observe(self, snapshot: SourceSnapshot) -> SourceSnapshot:
        if snapshot.system == "things":
            kind = str(snapshot.data.get("kind", "to-do"))
            if kind == "project":
                observed = self.things.read_project(snapshot.record_id)
            elif kind == "area":
                observed = self.things.read_area(snapshot.record_id)
            elif kind in {"to-do", "todo"}:
                observed = self.things.read_todo(snapshot.record_id)
            else:
                raise ValueError(f"unsupported Things snapshot kind: {kind}")
            version = observed["source_hash"] if observed else "missing"
            return SourceSnapshot(snapshot.system, snapshot.record_id, version, snapshot.data)
        if snapshot.system == "calendar_range":
            start = str(snapshot.data["start"])
            end = str(snapshot.data["end"])
            calendar_ids = snapshot.data.get("calendar_ids")
            observed = self.calendar.list_event_occurrences(start, end, calendar_ids)
            return SourceSnapshot(
                snapshot.system, snapshot.record_id, observed.source_hash, snapshot.data
            )
        raise ValueError(f"unsupported snapshot system: {snapshot.system}")

    def _apply_things(self, change: ThingsChange) -> dict[str, Any]:
        fields = dict(change.fields)
        item_kind = fields.pop("item_kind", "todo")
        if change.operation is ChangeOperation.CREATE:
            if item_kind != "todo":
                raise ApplyError("V1 can only create Things to-dos")
            result = self.things.create_todo(**fields)
        elif item_kind == "project":
            if change.operation is not ChangeOperation.UPDATE:
                raise ApplyError("V1 can only update Things projects")
            result = self.things.update_project(change.task_id, **fields)
        else:
            if change.operation is ChangeOperation.COMPLETE:
                fields["completed"] = True
            elif change.operation is ChangeOperation.CANCEL:
                fields["canceled"] = True
            elif change.operation is not ChangeOperation.UPDATE:
                raise ApplyError(f"unsupported Things operation: {change.operation.value}")
            result = self.things.update_todo(change.task_id, **fields)
        if not result.applied:
            raise ApplyError(result.error or f"Things write was not verified ({result.status})")
        return _jsonable(result)

    def _apply_calendar(
        self, proposal_id: str, index: int, change: CalendarChange
    ) -> dict[str, Any]:
        fields = dict(change.fields)
        if change.operation is ChangeOperation.CREATE:
            fields.setdefault("link_id", f"{proposal_id}-calendar-{index}")
            if fields.get("things_id"):
                return self.calendar.create_linked_work_block(
                    calendar_id=change.calendar_id, **fields
                )
            return self.calendar.create_calendar_event(calendar_id=change.calendar_id, **fields)
        if change.operation is ChangeOperation.UPDATE:
            return self.calendar.update_linked_work_block(
                event_identifier=change.event_id, **fields
            )
        if change.operation is ChangeOperation.DELETE:
            deleted = self.calendar.delete_linked_work_block(event_identifier=change.event_id)
            return {"deleted_event_identifier": deleted}
        raise ApplyError(f"unsupported Calendar operation: {change.operation.value}")
