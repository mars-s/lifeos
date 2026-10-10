"""Application service joining proposal safety to Things and Calendar gateways."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from contextlib import suppress
from dataclasses import asdict, is_dataclass
from datetime import UTC, date, datetime
from enum import Enum
from hashlib import sha256
from typing import Any

from .bana_gateway import LIFEOS_TAGS, BanaGateway, BanaUnavailable
from .brain_dump_store import BrainDumpConflict, BrainDumpStore
from .memory_gateway import MemoryGatewayError, SupermemoryGateway, UnknownMemoryDocument
from .models import (
    BanaChange,
    CalendarChange,
    ChangeOperation,
    ProposalRevision,
    ProposalState,
    SourceSnapshot,
    ThingsChange,
)
from .planner import BusyInterval, PlanningTask, PlanningWindow, plan_day, plan_range
from .proposal_store import IdempotencyConflict, InvalidTransition, ProposalStore, UnknownProposal


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
        bana: BanaGateway | None = None,
    ) -> None:
        self.store = store
        self.things = things
        self.calendar = calendar
        self.brain_dumps = brain_dumps
        self.memory = memory
        self.bana = bana

    def capture_brain_dump(self, **fields: Any) -> dict[str, Any]:
        """The ledger row first (authoritative), then a copy in Bana with the same sha256."""
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        capture = self.brain_dumps.capture(**fields)
        return {**capture, "bana": self._capture_to_bana(capture)}

    def submit_brain_dump_semanticization(
        self, *, meeting_title: str | None = None, **fields: Any,
    ) -> dict[str, Any]:
        """Store the interpretation; write it into Bana, journal prose on the day page.

        With Bana closed the ledger still records it and the prose falls back to Markdown.
        """
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        capture = self.brain_dumps.get(fields["capture_id"])
        bana_ready = (
            self.bana is not None and capture["source"] != "synthetic_test" and self.bana.available()
        )
        revision = self.brain_dumps.submit_semanticization(**fields, write_journal=not bana_ready)
        if not bana_ready:
            revision["bana"] = {"status": "unavailable" if self.bana else "not_configured"}
            return revision
        try:
            revision["bana"] = self._interpretation_to_bana(capture, revision, meeting_title)
        except BanaUnavailable:
            revision["bana"] = {"status": "unavailable"}
        return revision

    def _capture_to_bana(self, capture: Mapping[str, Any]) -> dict[str, Any]:
        if self.bana is None:
            return {"status": "not_configured"}
        if capture["source"] == "synthetic_test":
            return {"status": "skipped_test_capture"}
        first_line = capture["raw_text"].strip().splitlines()[0][:80]
        change = BanaChange("add", None, {
            "name": f"Capture: {first_line}",
            "parent": capture["captured_at"][:10],
            "tags": ["capture"],
            "description": capture["raw_text"],
            "fields": {
                "Capture ID": capture["capture_id"], "Source hash": capture["source_hash"],
                "By": "lifeos", "Request ID": f"capture-{capture['capture_id']}",
            },
        })
        try:
            result = self._direct_notes(f"capture-{capture['capture_id']}", (), (change,))
        except BanaUnavailable:
            return {"status": "unavailable"}
        node_id = result["node_id"]
        if not result["saved"] or node_id is None:
            return {"status": result["state"], "node_id": node_id}
        return {"status": "saved", "node_id": node_id, **self._bana_capture_check(capture, node_id)}

    def _bana_capture_check(self, capture: Mapping[str, Any], node_id: str) -> dict[str, Any]:
        """The ledger wins: a Bana copy whose text no longer hashes the same is flagged."""
        node = self._notes().inspect(node_id)
        matches = sha256(str(node.get("description", "")).encode()).hexdigest() == capture["source_hash"]
        return {"source_hash_matches": matches, "locked": bool(node.get("locked", False))}

    def _capture_node(self, capture: Mapping[str, Any]) -> str:
        """The capture's Bana node, written now if Bana was closed when it was captured."""
        proposal_id = "note-request-" + sha256(f"capture-{capture['capture_id']}".encode()).hexdigest()
        with suppress(UnknownProposal):
            revision = self.store.get_current(proposal_id)
            receipt = self.store.get_operation_result(proposal_id, revision.revision_hash, "bana", 0)
            if receipt:
                return str(receipt["node"])
        written = self._capture_to_bana(capture)
        if written.get("status") != "saved":
            raise BanaUnavailable("the capture could not be written to Bana")
        return str(written["node_id"])

    def _interpretation_to_bana(
        self, capture: Mapping[str, Any], revision: Mapping[str, Any], meeting_title: str | None,
    ) -> dict[str, Any]:
        """One new node per interpretation (old ones are never rewritten), children per item."""
        parent = self._capture_node(capture)
        by = str(revision["interpreted_by"])
        common = {"Capture ID": capture["capture_id"], "Source hash": capture["source_hash"], "By": by}
        changes = [BanaChange("add", None, {
            "name": meeting_title or f"Interpretation {revision['revision_number']} by {by}",
            "parent": parent,
            "tags": ["interpretation", *(["meeting"] if meeting_title else [])],
            "fields": {**common, "Request ID": f"interp-{revision['revision_hash'][:40]}"},
            **({"description": revision["summary"]} if revision.get("summary") else {}),
        })]
        tag_for = {"task": "suggested-action", "project": "suggested-action", "question": "question"}
        for item in revision["items"]:
            details = [item.get("detail")] + [
                f"{label}: {item[key]}" for key, label in
                (("area", "Area"), ("project", "Project"), ("time_expression", "When"))
                if item.get(key)
            ]
            fields = dict(common)
            if item.get("source_excerpt"):
                fields["Evidence"] = item["source_excerpt"]
            changes.append(BanaChange("add", None, {
                "name": item["title"], "parent_change_index": 0,
                "tags": [tag_for[item["kind"]]] if item["kind"] in tag_for else [],
                "fields": fields,
                **({"description": "\n".join(d for d in details if d)} if any(details) else {}),
            }))
        for question in revision["unresolved"]:
            changes.append(BanaChange("add", None, {
                "name": question, "parent_change_index": 0, "tags": ["question"], "fields": common,
            }))
        if revision.get("journal_entry"):
            changes.append(BanaChange("add", None, {
                "name": f"Journal {capture['captured_at'][11:16]}",
                "parent": capture["captured_at"][:10],
                "description": revision["journal_entry"],
                "fields": common,
            }))
        result = self._direct_notes(f"interp-{revision['revision_hash'][:40]}", (), tuple(changes))
        nodes = [str(receipt["node"]) for receipt in result["receipts"] if receipt]
        return {
            "status": "saved" if result["saved"] else result["state"],
            "node_id": nodes[0] if nodes else None,
            "item_node_ids": nodes[1:],
            "journal": "bana_day_page" if revision.get("journal_entry") else None,
        }

    def export_journal(self, day: str | None = None) -> dict[str, Any]:
        """Write one Bana day page to the journal folder as Markdown (an export, not a source).

        A file there that LifeOS did not export (hand-written, or a fallback written while Bana
        was closed) is never overwritten; the export goes beside it as <day>.bana.md.
        """
        if self.brain_dumps is None:
            raise RuntimeError("brain-dump storage is not configured")
        page = self.notes_today(day)
        marker = f"<!-- lifeos:bana-export {page['date']} -->"
        folder = self.brain_dumps.journal_dir
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{page['date']}.md"
        if path.exists() and not path.read_text(encoding="utf-8").startswith(marker):
            path = folder / f"{page['date']}.bana.md"
        path.write_text(f"{marker}\n{page['markdown']}", encoding="utf-8")
        return {"date": page["date"], "path": str(path), "node_id": page["node_id"]}

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

    def create_requested_task(
        self, *, request_id: str, title: str, notes: str = "",
        when: str | None = None, area_id: str | None = None,
    ) -> dict[str, Any]:
        """Create one explicitly requested task, retaining an immutable audit and receipt."""
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ValueError("request_id must be a stable 1-128 character identifier")
        if not isinstance(title, str) or not title.strip() or len(title) > 1000:
            raise ValueError("title must be non-empty and at most 1000 characters")
        if not isinstance(notes, str) or len(notes) > 10000:
            raise ValueError("notes must be at most 10000 characters")
        if when is not None:
            if not isinstance(when, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", when):
                raise ValueError("when must be an absolute local YYYY-MM-DD; put time constraints in notes")
            datetime.strptime(when, "%Y-%m-%d")
        if area_id is not None and (
            not isinstance(area_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", area_id)
        ):
            raise ValueError("area_id must be a Things identifier")
        proposal_id = "requested-task-" + sha256(request_id.encode()).hexdigest()
        fields = {"title": title, "notes": notes}
        if when is not None:
            fields["when"] = when
        try:
            revision = self.store.get_current(proposal_id)
        except UnknownProposal:
            if area_id is None:
                page = self.things.read_areas(limit=500, offset=0)
                matches = [
                    item["record"]["uuid"] for item in page["items"]
                    if item["record"].get("title", "").casefold() == "personal"
                ]
                if len(matches) != 1:
                    raise ValueError("Personal area must resolve uniquely; read areas and supply area_id") from None
                area_id = matches[0]
            area = self.things.read_area(area_id)
            snapshot = SourceSnapshot(
                system="things", record_id=area_id, version=area["source_hash"],
                data={"kind": "area"},
            )
            fields["area_id"] = area_id
            revision = self.store.create_draft(
                proposal_id, idempotency_key=f"requested-task:{request_id}",
                source_snapshots=(snapshot,),
                things_changes=(ThingsChange(ChangeOperation.CREATE, None, fields),),
            )
        else:
            # Compare intent before replaying. Destination/source snapshots stay
            # immutable even if Personal is renamed after the original write.
            if (
                revision.revision_number != 1 or len(revision.things_changes) != 1
                or revision.calendar_changes
                or revision.things_changes[0].operation is not ChangeOperation.CREATE
                or revision.things_changes[0].task_id is not None
                or revision.things_changes[0].destructive
                or len(revision.source_snapshots) != 1
                or revision.source_snapshots[0].system != "things"
                or revision.source_snapshots[0].data.get("kind") != "area"
                or revision.source_snapshots[0].record_id != revision.things_changes[0].fields.get("area_id")
            ):
                raise IdempotencyConflict("request_id no longer refers to the original single-task creation")
            expected = dict(fields)
            if area_id is not None:
                expected["area_id"] = area_id
            actual = dict(revision.things_changes[0].fields)
            if area_id is None:
                actual.pop("area_id", None)
            if actual != expected:
                raise IdempotencyConflict("request_id was already used for different task content")
        if revision.state is ProposalState.DRAFT:
            try:
                revision = self.store.approve(proposal_id, revision.revision_hash)
            except InvalidTransition:
                revision = self.store.get_current(proposal_id)
        if revision.state is ProposalState.APPROVED:
            # Another caller may have claimed this request. Never issue a
            # second gateway write while its result is still uncertain.
            with suppress(InvalidTransition):
                self.apply_proposal(proposal_id, revision.revision_hash, allow_resume=False)
        revision = self.store.get_current(proposal_id)
        receipt = self.store.get_operation_result(proposal_id, revision.revision_hash, "things", 0)
        return {
            **proposal_to_dict(revision),
            "saved": revision.state is ProposalState.APPLIED,
            "receipt": receipt,
            "requires_lifeos_approval": False,
            "retry_policy": "Reuse request_id unchanged. Never automatically retry a partial_failure or applying state.",
        }

    def change_requested_task(
        self, *, request_id: str, task_id: str, expected_source_hash: str,
        fields: Mapping[str, Any] | None = None, trash: bool = False,
    ) -> dict[str, Any]:
        """Apply one explicit edit or recoverable deletion with a local freshness check."""
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ValueError("request_id must be a stable identifier")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", task_id):
            raise ValueError("task_id must be an opaque Things identifier")
        if not expected_source_hash:
            raise ValueError("read the local task and supply its source_hash")
        changes = dict(fields or {})
        allowed = {"title", "notes", "when", "deadline", "tags", "checklist",
                   "completed", "canceled", "area_id", "project_id"}
        if trash and changes:
            raise ValueError("Trash cannot be combined with an edit")
        if not trash and (not changes or set(changes) - allowed):
            raise ValueError("provide supported task fields only")
        when = changes.get("when")
        if when is not None:
            if not isinstance(when, str):
                raise ValueError("when must be a day or an absolute date")
            if when not in {"today", "tomorrow", "anytime", "someday"}:
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", when):
                    raise ValueError("when must not contain an unverified alarm time")
                datetime.strptime(when, "%Y-%m-%d")
        # Validate edits before storing or approving them. No gateway write occurs.
        if not trash:
            self.things.build_update_todo_command(task_id, **changes)
        operation = ChangeOperation.DELETE if trash else ChangeOperation.UPDATE
        proposal_id = "requested-change-" + sha256(request_id.encode()).hexdigest()
        snapshot = SourceSnapshot("things", task_id, expected_source_hash, {"kind": "to-do"})
        change = ThingsChange(operation, task_id, changes, destructive=trash)
        try:
            revision = self.store.get_current(proposal_id)
        except UnknownProposal:
            observed = self.things.read_todo(task_id)
            if observed is None or observed["source_hash"] != expected_source_hash:
                raise ValueError("task is missing or changed; read it again before making a new request") from None
            revision = self.store.create_draft(
                proposal_id, idempotency_key=f"requested-change:{request_id}",
                source_snapshots=(snapshot,), things_changes=(change,),
            )
        else:
            if (revision.revision_number != 1 or revision.calendar_changes
                    or revision.source_snapshots != (snapshot,)
                    or revision.things_changes != (change,)):
                raise IdempotencyConflict("request_id was already used for a different task change")
        if revision.state is ProposalState.DRAFT:
            with suppress(InvalidTransition):
                self.store.approve(proposal_id, revision.revision_hash)
            revision = self.store.get_current(proposal_id)
        if revision.state is ProposalState.APPROVED:
            with suppress(InvalidTransition):
                self.apply_proposal(proposal_id, revision.revision_hash, allow_resume=False)
        revision = self.store.get_current(proposal_id)
        return {
            **proposal_to_dict(revision),
            "saved": revision.state is ProposalState.APPLIED,
            "receipt": self.store.get_operation_result(proposal_id, revision.revision_hash, "things", 0),
            "requires_lifeos_approval": False,
            "retry_policy": "Reuse request_id and arguments unchanged. Never automatically resume uncertain writes.",
        }

    def create_proposal(
        self,
        *,
        proposal_id: str,
        idempotency_key: str,
        source_snapshots: Sequence[Mapping[str, Any]],
        things_changes: Sequence[Mapping[str, Any]] = (),
        calendar_changes: Sequence[Mapping[str, Any]] = (),
        bana_changes: Sequence[Mapping[str, Any]] = (),
    ) -> dict[str, Any]:
        snapshots = tuple(SourceSnapshot.from_dict(item) for item in source_snapshots)
        things = tuple(ThingsChange.from_dict(item) for item in things_changes)
        calendar = tuple(CalendarChange.from_dict(item) for item in calendar_changes)
        bana = tuple(BanaChange.from_dict(item) for item in bana_changes)
        self._validate_proposal(snapshots, things, calendar, bana)
        revision = self.store.create_draft(
            proposal_id,
            idempotency_key=idempotency_key,
            source_snapshots=snapshots,
            things_changes=things,
            calendar_changes=calendar,
            bana_changes=bana,
        )
        return proposal_to_dict(revision)

    @staticmethod
    def _validate_proposal(
        snapshots: Sequence[SourceSnapshot],
        things: Sequence[ThingsChange],
        calendar: Sequence[CalendarChange],
        bana: Sequence[BanaChange] = (),
    ) -> None:
        if not things and not calendar and not bana:
            raise ValueError("a proposal needs at least one change")
        if len(things) + len(calendar) + len(bana) > 100:
            raise ValueError("a proposal may contain at most 100 changes")
        bana_nodes = {item.record_id for item in snapshots if item.system == "bana"}
        for change in bana:
            if change.operation == "add":
                if not str(change.fields.get("name", "")).strip():
                    raise ValueError("a new Bana node needs a name")
            elif change.node_id not in bana_nodes:
                raise ValueError("each edited Bana node needs a reviewed source snapshot")
            if change.operation == "link_task" and "things_id" not in change.fields:
                index = change.fields.get("things_change_index")
                if not isinstance(index, int) or not 0 <= index < len(things) or (
                    things[index].operation is not ChangeOperation.CREATE
                ):
                    raise ValueError("link_task needs things_id or the index of a Things create")
        things_snapshots = {item.record_id: item for item in snapshots if item.system == "things"}
        calendar_snapshots = [item for item in snapshots if item.system == "calendar_range"]
        reviewed_event_ids = {
            str(event_id)
            for snapshot in calendar_snapshots
            for event_id in snapshot.data.get("event_ids", [])
        }
        for change in things:
            if change.operation is ChangeOperation.DELETE and (
                change.fields or not change.destructive
            ):
                raise ValueError("Things deletion must be an explicit recoverable Trash operation")
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

    def apply_proposal(
        self, proposal_id: str, revision_hash: str, *, allow_resume: bool = True,
    ) -> dict[str, Any]:
        revision = self.store.get_revision(proposal_id, revision_hash)
        if not allow_resume and revision.state is not ProposalState.APPROVED:
            return proposal_to_dict(revision)
        if revision.state is ProposalState.APPLIED:
            return proposal_to_dict(revision)
        if revision.state is ProposalState.APPROVED:
            observed = tuple(self._observe(snapshot) for snapshot in revision.source_snapshots)
            revision = self.store.check_freshness(proposal_id, revision_hash, observed)
            if revision.state is ProposalState.STALE:
                return proposal_to_dict(revision)
        revision = self.store.begin_apply(proposal_id, revision_hash, allow_resume=allow_resume)
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
            for index, change in enumerate(revision.bana_changes):
                self._apply_once(
                    proposal_id, revision_hash, "bana", index,
                    lambda change=change: self._apply_bana(proposal_id, revision_hash, change),
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
        if snapshot.system == "bana":
            observed = self._notes().snapshot(snapshot.record_id)
            version = observed["hash"] if observed else "missing"
            return SourceSnapshot(snapshot.system, snapshot.record_id, version, snapshot.data)
        raise ValueError(f"unsupported snapshot system: {snapshot.system}")

    def _apply_things(self, change: ThingsChange) -> dict[str, Any]:
        fields = dict(change.fields)
        item_kind = fields.pop("item_kind", "todo")
        if change.operation is ChangeOperation.CREATE:
            if item_kind != "todo":
                raise ApplyError("V1 can only create Things to-dos")
            result = self.things.create_todo(**fields)
        elif change.operation is ChangeOperation.DELETE:
            if item_kind != "todo" or fields:
                raise ApplyError("Only a single Things to-do can be moved to Trash")
            result = self.things.trash_todo(change.task_id)
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

    # Notes in Bana. Reads are tier 0. Appends (tier 1) and one explicit edit with the node's
    # fresh hash (tier 2) run as auto-approved proposals, so they share request_id retries,
    # receipts and the stale check. Anything inferred or multi-node goes through
    # propose_changes and waits for the person.

    def _notes(self) -> BanaGateway:
        if self.bana is None:
            raise BanaUnavailable("Bana is not configured for this LifeOS service.")
        return self.bana

    def notes_search(self, query: str, *, limit: int = 20) -> dict[str, Any]:
        clean = query.strip()
        if not clean or not 1 <= limit <= 200:
            raise ValueError("query must not be empty and limit must be 1 to 200")
        hits = self._notes().search(clean, limit)
        return {"query": clean, "results": hits, "count": len(hits), "content_is_untrusted": True}

    def notes_read(self, node_id: str) -> dict[str, Any]:
        bana = self._notes()
        snapshot = bana.snapshot(_node_id(node_id))
        if snapshot is None:
            raise ValueError("no Bana node with that id")
        return {
            "node_id": str(node_id), "hash": snapshot["hash"], "node": snapshot["node"],
            "markdown": bana.markdown(node_id),
            "snapshot": SourceSnapshot("bana", str(node_id), snapshot["hash"], {"kind": "node"}).to_dict(),
            "content_is_untrusted": True,
        }

    def notes_today(self, day: str | None = None) -> dict[str, Any]:
        day = day or date.today().isoformat()
        datetime.strptime(day, "%Y-%m-%d")
        return {"date": day, **self.notes_read(str(self._notes().day(day)))}

    def notes_add(
        self, *, request_id: str, name: str, by: str, parent: str = "today",
        tag: str | None = None, description: str | None = None,
    ) -> dict[str, Any]:
        if not name.strip() or len(name) > 10_000:
            raise ValueError("name must be non-empty and at most 10000 characters")
        if not (parent in {"today", "tomorrow"} or re.fullmatch(r"\d+|\d{4}-\d{2}-\d{2}", parent)):
            raise ValueError("parent must be today, tomorrow, YYYY-MM-DD or a node id")
        tags = [self._existing_tag(tag)] if tag else []
        fields: dict[str, Any] = {
            "name": name, "parent": parent, "tags": tags,
            "fields": {"By": by, "Request ID": request_id},
        }
        if description:
            fields["description"] = description
        return self._direct_notes(request_id, (), (BanaChange("add", None, fields),))

    def notes_edit(
        self, *, request_id: str, node_id: str, expected_hash: str, by: str,
        operation: str, fields: Mapping[str, Any],
    ) -> dict[str, Any]:
        node_id = _node_id(node_id)
        if not expected_hash:
            raise ValueError("read the node with notes_read and pass its hash")
        if operation == "tag":
            fields = {"tag": self._existing_tag(str(fields["tag"]))}
        if operation == "link_task":
            things_id = str(fields["things_id"])
            if self.things.read_todo(things_id) is None:
                raise ValueError("no Things to-do with that id")
        snapshot = SourceSnapshot("bana", node_id, expected_hash, {"kind": "node"})
        change = BanaChange(operation, node_id, {**fields, "by": by})
        return self._direct_notes(request_id, (snapshot,), (change,))

    def promote_notes_to_things(
        self, *, proposal_id: str, items: Sequence[Mapping[str, Any]], by: str,
    ) -> dict[str, Any]:
        """A draft proposal: one Things to-do per note, then link each note back (#in-things).

        Each note's hash is recorded, so editing it before apply makes the proposal stale.
        """
        if not items:
            raise ValueError("promote at least one note")
        snapshots, things, links = [], [], []
        for index, item in enumerate(items):
            node_id = _node_id(str(item["node_id"]))
            observed = self._notes().snapshot(node_id)
            if observed is None or observed["hash"] != item["expected_hash"]:
                raise ValueError(f"note {node_id} changed or is gone; read it again with notes_read")
            fields = {
                "title": item.get("title") or observed["node"]["name"],
                "notes": item.get("notes") or f"From Bana note {node_id}.",
            }
            fields.update({key: item[key] for key in ("when", "area_id") if item.get(key)})
            snapshots.append(SourceSnapshot("bana", node_id, observed["hash"], {"kind": "node"}).to_dict())
            things.append(ThingsChange(ChangeOperation.CREATE, None, fields).to_dict())
            links.append(BanaChange("link_task", node_id, {"things_change_index": index, "by": by}).to_dict())
        return self.create_proposal(
            proposal_id=proposal_id, idempotency_key=f"promote-notes:{proposal_id}",
            source_snapshots=snapshots, things_changes=things, bana_changes=links,
        )

    def _existing_tag(self, tag: str) -> str:
        """Agents may use a supertag that exists or a LifeOS one, never invent one."""
        clean = tag.strip().lstrip("#")
        if clean not in LIFEOS_TAGS and clean not in self._notes().tags():
            raise ValueError(f"no supertag #{clean} in Bana; ask the person to create it")
        return clean

    def _direct_notes(
        self, request_id: str, snapshots: tuple[SourceSnapshot, ...], changes: tuple[BanaChange, ...],
    ) -> dict[str, Any]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ValueError("request_id must be a stable 1-128 character identifier")
        proposal_id = "note-request-" + sha256(request_id.encode()).hexdigest()
        try:
            revision = self.store.get_current(proposal_id)
        except UnknownProposal:
            # Bana closed: say so now and record nothing, so a later retry can still write.
            if not self._notes().available():
                raise BanaUnavailable("Bana is not reachable. Open Bana on this Mac and try again.") from None
            for snapshot in snapshots:
                if self._observe(snapshot).version != snapshot.version:
                    raise ValueError("the node changed or is gone; read it again with notes_read") from None
            revision = self.store.create_draft(
                proposal_id, idempotency_key=f"note-request:{request_id}",
                source_snapshots=snapshots, bana_changes=changes,
            )
        else:
            if (revision.revision_number != 1 or revision.things_changes or revision.calendar_changes
                    or revision.source_snapshots != snapshots or revision.bana_changes != changes):
                raise IdempotencyConflict("request_id was already used for a different note change")
        if revision.state is ProposalState.DRAFT:
            with suppress(InvalidTransition):
                self.store.approve(proposal_id, revision.revision_hash)
            revision = self.store.get_current(proposal_id)
        if revision.state is ProposalState.APPROVED:
            with suppress(InvalidTransition):
                self.apply_proposal(proposal_id, revision.revision_hash, allow_resume=False)
        revision = self.store.get_current(proposal_id)
        receipts = [
            self.store.get_operation_result(proposal_id, revision.revision_hash, "bana", index)
            for index in range(len(revision.bana_changes))
        ]
        return {
            **proposal_to_dict(revision),
            "saved": revision.state is ProposalState.APPLIED,
            "node_id": str(receipts[0]["node"]) if receipts and receipts[0] else None,
            "receipts": receipts,
            "requires_lifeos_approval": False,
            "retry_policy": "Reuse request_id and arguments unchanged. Uncertain writes are never replayed.",
        }

    def _apply_bana(self, proposal_id: str, revision_hash: str, change: BanaChange) -> dict[str, Any]:
        bana = self._notes()
        fields = dict(change.fields)
        by = fields.pop("by", None)
        if change.operation == "add":
            parent = fields.get("parent", "today")
            if "parent_change_index" in fields:  # a node made earlier in this same proposal
                receipt = self.store.get_operation_result(
                    proposal_id, revision_hash, "bana", int(fields["parent_change_index"])
                ) or {}
                parent = receipt["node"]
            node = bana.add(
                name=str(fields["name"]), parent=parent,
                tags=tuple(fields.get("tags", ())), fields=fields.get("fields"),
                description=fields.get("description"),
            )
            tree = bana.inspect(node)
            if tree.get("name") != fields["name"] or not set(fields.get("tags", ())) <= set(tree.get("tags", [])):
                raise ApplyError("Bana node did not read back as written")
            return {"node": node, "operation": "add", "by": by}
        node = _node_id(str(change.node_id))
        expected: dict[str, Any] = {}
        if change.operation == "tag":
            bana.tag(node, str(fields["tag"]))
        elif change.operation == "set_field":
            bana.set_field(node, str(fields["field"]), str(fields["value"]))
            expected[str(fields["field"])] = str(fields["value"])
        elif change.operation == "move":
            bana.move(node, _node_id(str(fields["parent"])))
        elif change.operation == "link_task":
            things_id = fields.get("things_id")
            if things_id is None:
                receipt = self.store.get_operation_result(
                    proposal_id, revision_hash, "things", int(fields["things_change_index"])
                ) or {}
                record = receipt.get("record") or {}
                things_id = (record.get("record") or record).get("uuid")
            if not things_id:
                raise ApplyError("the Things to-do to link has no id")
            expected = {"Things ID": str(things_id), "Things link": f"things:///show?id={things_id}"}
            for field, value in {**expected, "Synced at": datetime.now(UTC).isoformat()}.items():
                bana.set_field(node, field, value)
            bana.tag(node, "in-things")
        tree = bana.inspect(node)
        ok = all(tree.get("fields", {}).get(key) == value for key, value in expected.items())
        if change.operation in {"tag", "link_task"}:
            ok = ok and (fields.get("tag", "in-things") in tree.get("tags", []))
        if change.operation == "move":
            ok = ok and str((tree.get("breadcrumbs") or [{}])[-1].get("id")) == str(fields["parent"])
        if not ok:
            raise ApplyError("Bana node did not read back as written")
        return {"node": int(node), "operation": change.operation, "by": by,
                **({"things_id": expected["Things ID"]} if "Things ID" in expected else {})}


def _node_id(value: str) -> str:
    if not re.fullmatch(r"\d{1,18}", str(value)):
        raise ValueError("a Bana node id is a number from notes_search or notes_read")
    return str(value)
