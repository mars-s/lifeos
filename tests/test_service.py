from __future__ import annotations

from dataclasses import dataclass

import pytest

from lifeos.models import ProposalState
from lifeos.proposal_store import ProposalStore, RevisionMismatch
from lifeos.service import LifeOSService
from lifeos.things_gateway import WriteResult

TODO_ID = "11111111-1111-4111-8111-111111111111"
AREA_ID = "33333333-3333-4333-8333-333333333333"


@dataclass
class Snapshot:
    events: tuple[dict, ...]
    source_hash: str


class FakeThings:
    def __init__(self) -> None:
        self.title = "Old title"
        self.area_version = "area-v1"
        self.writes = 0

    def read_list(self, _name, *, limit, offset):
        return {
            "items": [self.read_todo(TODO_ID)],
            "count": 1,
            "total": 1,
            "limit": limit,
            "offset": offset,
        }

    def read_todo(self, todo_id):
        record = {"uuid": todo_id, "type": "to-do", "title": self.title}
        version = "v1" if self.title == "Old title" else "v2"
        return {"record": record, "source_hash": version, "content_is_untrusted": True}

    def read_project(self, project_id):
        return self.read_todo(project_id)

    def read_area(self, area_id):
        return {
            "record": {"uuid": area_id, "type": "area", "title": "Paperless"},
            "source_hash": self.area_version,
            "content_is_untrusted": True,
        }

    def search_todos(self, query, *, limit, offset):
        return self.read_list("search", limit=limit, offset=offset)

    def read_projects(self, *, limit, offset):
        return {"items": [], "count": 0, "total": 0, "limit": limit, "offset": offset}

    def read_areas(self, *, limit, offset):
        return {"items": [], "count": 0, "total": 0, "limit": limit, "offset": offset}

    def read_tags(self, *, limit, offset):
        return {"items": [], "count": 0, "total": 0, "limit": limit, "offset": offset}

    def deep_link(self, item_id):
        return f"things:///show?id={item_id}"

    def update_todo(self, todo_id, **fields):
        self.writes += 1
        self.title = fields.get("title", self.title)
        return WriteResult(
            status="verified",
            command="update",
            record=self.read_todo(todo_id),
            checked_at=1.0,
        )

    def create_todo(self, **fields):
        self.writes += 1
        return WriteResult(
            status="verified",
            command="create",
            record={"record": {"uuid": TODO_ID, "type": "to-do", **fields}},
            checked_at=1.0,
        )


class FakeCalendar:
    def __init__(self) -> None:
        self.version = "cal-v1"
        self.writes = 0
        self.last_fields = None

    def list_event_occurrences(self, _start, _end, _calendar_ids=None):
        return Snapshot((), self.version)

    def list_calendars(self):
        return type("Calendars", (), {"calendars": (), "source_hash": "cals-v1"})()

    def create_linked_work_block(self, **fields):
        self.writes += 1
        self.last_fields = fields
        return {
            "event_identifier": "event-1",
            "calendar_id": fields["calendar_id"],
            "title": fields["title"],
            "planner_owned": True,
        }

    def create_calendar_event(self, **fields):
        self.writes += 1
        self.last_fields = fields
        return {
            "event_identifier": "event-standalone-1",
            "calendar_id": fields["calendar_id"],
            "title": fields["title"],
            "planner_owned": True,
        }


def build_service(tmp_path):
    things = FakeThings()
    calendar = FakeCalendar()
    return (
        LifeOSService(ProposalStore(tmp_path / "lifeos.sqlite3"), things, calendar),
        things,
        calendar,
    )


def proposal_inputs(service):
    things_page = service.read_things_list("today")
    calendar_page = service.read_calendar("2026-09-22T00:00:00+10:00", "2026-09-23T00:00:00+10:00")
    return [things_page["items"][0]["snapshot"], calendar_page["snapshot"]]


def create_plan(service):
    return service.create_proposal(
        proposal_id="tomorrow",
        idempotency_key="request-1",
        source_snapshots=proposal_inputs(service),
        things_changes=[
            {"operation": "update", "task_id": TODO_ID, "fields": {"title": "Draft report"}}
        ],
        calendar_changes=[
            {
                "operation": "create",
                "calendar_id": "planned-tasks",
                "event_id": None,
                "fields": {
                    "things_id": TODO_ID,
                    "title": "Draft report",
                    "start": "2026-09-22T09:00:00+10:00",
                    "end": "2026-09-22T10:00:00+10:00",
                },
            }
        ],
    )


def test_exact_approved_revision_applies_and_records_both_writes(tmp_path):
    service, things, calendar = build_service(tmp_path)
    draft = create_plan(service)

    service.approve_proposal("tomorrow", draft["revision_hash"])
    result = service.apply_proposal("tomorrow", draft["revision_hash"])

    assert result["state"] == ProposalState.APPLIED.value
    assert things.writes == 1
    assert calendar.writes == 1
    assert service.store.get_operation_result("tomorrow", draft["revision_hash"], "things", 0)
    assert service.store.get_operation_result("tomorrow", draft["revision_hash"], "calendar", 0)


def test_approved_create_rechecks_area_snapshot_before_writing(tmp_path):
    service, things, calendar = build_service(tmp_path)
    area = things.read_area(AREA_ID)
    draft = service.create_proposal(
        proposal_id="paperless-task",
        idempotency_key="paperless-task-1",
        source_snapshots=[
            {
                "system": "things",
                "record_id": AREA_ID,
                "version": area["source_hash"],
                "data": {"kind": "area"},
            }
        ],
        things_changes=[
            {"operation": "create", "task_id": None, "fields": {"title": "Check MCP", "area_id": AREA_ID}}
        ],
    )

    service.approve_proposal("paperless-task", draft["revision_hash"])
    result = service.apply_proposal("paperless-task", draft["revision_hash"])

    assert result["state"] == ProposalState.APPLIED.value
    assert things.writes == 1
    assert calendar.writes == 0
    assert service.store.get_operation_result("paperless-task", draft["revision_hash"], "things", 0)


def test_changed_area_snapshot_blocks_approved_create(tmp_path):
    service, things, _ = build_service(tmp_path)
    draft = service.create_proposal(
        proposal_id="paperless-stale",
        idempotency_key="paperless-stale-1",
        source_snapshots=[
            {
                "system": "things",
                "record_id": AREA_ID,
                "version": things.read_area(AREA_ID)["source_hash"],
                "data": {"kind": "area"},
            }
        ],
        things_changes=[
            {"operation": "create", "task_id": None, "fields": {"title": "Check MCP", "area_id": AREA_ID}}
        ],
    )
    service.approve_proposal("paperless-stale", draft["revision_hash"])
    things.area_version = "area-v2"

    result = service.apply_proposal("paperless-stale", draft["revision_hash"])

    assert result["state"] == ProposalState.STALE.value
    assert things.writes == 0
    assert service.store.get_operation_result("paperless-stale", draft["revision_hash"], "things", 0) is None


def test_organization_reads_and_deep_links_stay_read_only(tmp_path):
    service, things, _ = build_service(tmp_path)

    assert service.read_areas()["items"] == []
    assert service.read_tags()["items"] == []
    assert service.things_deep_link(TODO_ID)["url"] == f"things:///show?id={TODO_ID}"
    assert things.writes == 0


def test_standalone_calendar_event_does_not_require_a_things_task(tmp_path):
    service, things, calendar = build_service(tmp_path)
    calendar_page = service.read_calendar(
        "2026-09-23T00:00:00+10:00", "2026-09-24T00:00:00+10:00"
    )
    draft = service.create_proposal(
        proposal_id="amazon-delivery",
        idempotency_key="amazon-delivery-2026-09-23",
        source_snapshots=[calendar_page["snapshot"]],
        calendar_changes=[
            {
                "operation": "create",
                "calendar_id": "home-calendar",
                "event_id": None,
                "fields": {
                    "title": "Amazon delivery — HOTO screwdriver",
                    "start": "2026-09-23T17:00:00+10:00",
                    "end": "2026-09-23T22:00:00+10:00",
                    "location": "Front door",
                },
            }
        ],
    )

    service.approve_proposal("amazon-delivery", draft["revision_hash"])
    result = service.apply_proposal("amazon-delivery", draft["revision_hash"])

    assert result["state"] == ProposalState.APPLIED.value
    assert things.writes == 0
    assert calendar.writes == 1
    assert calendar.last_fields["location"] == "Front door"


def test_retry_resumes_exact_approved_revision_after_calendar_gateway_failure(tmp_path):
    service, _, calendar = build_service(tmp_path)
    calendar_page = service.read_calendar(
        "2026-09-24T00:00:00+10:00", "2026-09-25T00:00:00+10:00"
    )
    draft = service.create_proposal(
        proposal_id="tennis-booking",
        idempotency_key="tennis-booking-2026-09-24",
        source_snapshots=[calendar_page["snapshot"]],
        calendar_changes=[
            {
                "operation": "create",
                "calendar_id": "home-calendar",
                "event_id": None,
                "fields": {
                    "title": "Play tennis",
                    "start": "2026-09-24T10:00:00+10:00",
                    "end": "2026-09-24T11:00:00+10:00",
                    "location": "Carlson Reserve free public tennis court",
                },
            }
        ],
    )
    service.approve_proposal("tennis-booking", draft["revision_hash"])
    working_create = calendar.create_calendar_event
    calendar.create_calendar_event = lambda **_fields: (_ for _ in ()).throw(
        TypeError("unexpected keyword argument 'location'")
    )

    failed = service.apply_proposal("tennis-booking", draft["revision_hash"])
    assert failed["state"] == ProposalState.PARTIAL_FAILURE.value

    calendar.create_calendar_event = working_create
    retried = service.apply_proposal("tennis-booking", draft["revision_hash"])

    assert retried["state"] == ProposalState.APPLIED.value
    assert calendar.writes == 1


def test_changed_source_marks_proposal_stale_without_writes(tmp_path):
    service, things, calendar = build_service(tmp_path)
    draft = create_plan(service)
    service.approve_proposal("tomorrow", draft["revision_hash"])
    calendar.version = "cal-v2"

    result = service.apply_proposal("tomorrow", draft["revision_hash"])

    assert result["state"] == ProposalState.STALE.value
    assert things.writes == 0
    assert calendar.writes == 0


def test_wrong_revision_hash_never_applies(tmp_path):
    service, things, calendar = build_service(tmp_path)
    create_plan(service)

    with pytest.raises(RevisionMismatch):
        service.approve_proposal("tomorrow", "not-the-reviewed-hash")
    assert things.writes == 0
    assert calendar.writes == 0


def test_existing_item_change_requires_reviewed_snapshot(tmp_path):
    service, _, _ = build_service(tmp_path)
    with pytest.raises(ValueError, match="reviewed source snapshot"):
        service.create_proposal(
            proposal_id="unsafe",
            idempotency_key="unsafe-1",
            source_snapshots=[],
            things_changes=[
                {"operation": "update", "task_id": TODO_ID, "fields": {"title": "Surprise"}}
            ],
        )


def test_resume_skips_operation_with_durable_receipt(tmp_path):
    service, things, calendar = build_service(tmp_path)
    draft = create_plan(service)
    service.approve_proposal("tomorrow", draft["revision_hash"])
    service.store.begin_apply("tomorrow", draft["revision_hash"])
    service.store.record_operation_result(
        "tomorrow", draft["revision_hash"], "things", 0, {"status": "verified"}
    )

    result = service.apply_proposal("tomorrow", draft["revision_hash"])

    assert result["state"] == ProposalState.APPLIED.value
    assert things.writes == 0
    assert calendar.writes == 1
