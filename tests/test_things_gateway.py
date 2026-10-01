import pathlib
import sys
from datetime import date

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "src"))

from lifeos.things_gateway import ThingsGateway, source_hash, things_deep_link

TODO_ID = "11111111-1111-4111-8111-111111111111"
PROJECT_ID = "22222222-2222-4222-8222-222222222222"
AREA_ID = "33333333-3333-4333-8333-333333333333"
HOSTILE_ID = '11111111-1111-4111-8111-111111111111"; rm -rf /'


class FakeThings:
    def __init__(self):
        self.records = {
            TODO_ID: {
                "uuid": TODO_ID,
                "type": "to-do",
                "title": "Old title",
                "notes": "Old note",
                "tags": ["home"],
                "items": [{"title": "Old checkbox"}],
                "status": "open",
            },
            PROJECT_ID: {
                "uuid": PROJECT_ID,
                "type": "project",
                "title": "Old project",
                "status": "open",
            },
            AREA_ID: {"uuid": AREA_ID, "type": "area", "title": "Work"},
        }
        self.auth_token = "very-secret-token"

    def token(self):
        return self.auth_token

    def get(self, item_id):
        return self.records.get(item_id)

    def inbox(self, include_items=True):
        return [self.records[TODO_ID]]

    def today(self, include_items=True):
        return [self.records[TODO_ID]]

    upcoming = anytime = someday = logbook = trash = inbox

    def todos(self, **kwargs):
        return [self.records[TODO_ID]]

    def projects(self):
        return [self.records[PROJECT_ID]]

    def areas(self):
        return [self.records[AREA_ID]]

    def tags(self):
        return [{"uuid": "tag-1", "type": "tag", "title": "urgent"}]

    def search(self, query, include_items=True):
        return [
            record
            for record in self.records.values()
            if query.lower() in record.get("title", "").lower()
        ]


def test_read_list_is_structured_hashed_and_marks_content_untrusted():
    gateway = ThingsGateway(FakeThings(), sleeper=lambda _: None)

    result = gateway.read_list("inbox")

    assert result["count"] == 1
    item = result["items"][0]
    assert item["content_is_untrusted"] is True
    assert item["source_hash"] == source_hash(item["record"])
    assert len(item["source_hash"]) == 64


def test_source_hash_is_order_independent():
    assert source_hash({"b": [2, 1], "a": "x"}) == source_hash({"a": "x", "b": [2, 1]})


def test_areas_and_tags_are_read_as_structured_pages():
    gateway = ThingsGateway(FakeThings())

    areas = gateway.read_areas()
    tags = gateway.read_tags()

    assert areas["items"][0]["record"]["title"] == "Work"
    assert areas["items"][0]["record"]["type"] == "area"
    assert tags["items"][0]["record"]["title"] == "urgent"
    assert all(item["content_is_untrusted"] for item in areas["items"] + tags["items"])


def test_area_snapshot_can_be_reread_by_id():
    gateway = ThingsGateway(FakeThings())
    listed_area = gateway.read_areas()["items"][0]

    assert gateway.read_area(AREA_ID) == listed_area


def test_deep_links_are_token_free_and_support_built_in_lists():
    assert things_deep_link(TODO_ID) == f"things:///show?id={TODO_ID}"
    assert things_deep_link("today") == "things:///show?id=today"


def test_task_move_uses_official_list_id_and_project_move_uses_area_id():
    gateway = ThingsGateway(FakeThings())

    todo = gateway.build_update_todo_command(TODO_ID, project_id=PROJECT_ID)
    project = gateway.build_update_project_command(PROJECT_ID, area_id=AREA_ID)

    assert "list-id=" + PROJECT_ID in todo.safe_url
    assert "area-id=" + AREA_ID in project.safe_url
    assert "auth-token" not in todo.safe_url
    assert "auth-token" not in project.safe_url


def test_project_update_supports_deadline_replacement_and_add_tags():
    gateway = ThingsGateway(FakeThings())

    command = gateway.build_update_project_command(
        PROJECT_ID, deadline="2026-10-01", add_tags=["urgent"], area_title="Work"
    )

    assert "deadline=2026-10-01" in command.safe_url
    assert "add-tags=urgent" in command.safe_url
    assert "area=Work" in command.safe_url


def test_organization_write_is_verified_after_things_re_read():
    things = FakeThings()

    def run(*_args, **_kwargs):
        things.records[TODO_ID].update({"project": PROJECT_ID, "deadline": "2026-10-01"})
        things.records[PROJECT_ID].update({"area": AREA_ID, "deadline": "2026-10-02"})

    gateway = ThingsGateway(things, run=run, sleeper=lambda _: None)

    todo = gateway.update_todo(TODO_ID, project_id=PROJECT_ID, deadline="2026-10-01")
    project = gateway.update_project(PROJECT_ID, area_id=AREA_ID, deadline="2026-10-02")

    assert todo.applied
    assert project.applied


def test_update_launches_open_without_shell_and_verifies_effect():
    things = FakeThings()
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        things.records[TODO_ID].update(
            {
                "title": "A/B & C",
                "notes": "new note",
                "tags": ["work", "urgent"],
                "status": "completed",
            }
        )
        things.records[TODO_ID]["items"] = [{"title": "first"}, {"title": "second"}]

    gateway = ThingsGateway(things, run=run, clock=lambda: 123.0, sleeper=lambda _: None)
    result = gateway.update_todo(
        TODO_ID,
        title="A/B & C",
        notes="new note",
        tags=["work", "urgent"],
        checklist=["first", "second"],
        completed=True,
    )

    assert result.applied
    assert result.checked_at == 123.0
    args, kwargs = calls[0]
    assert args[:4] == [
        "/usr/bin/open",
        "-g",
        "-b",
        "com.culturedcode.ThingsMac",
    ]
    assert "A%2FB%20%26%20C" in args[4]
    assert "auth-token=very-secret-token" in args[4]
    assert kwargs == {"check": True, "capture_output": True, "text": True}
    assert "very-secret-token" not in repr(result)


def test_noop_write_reports_mismatch_instead_of_success():
    things = FakeThings()
    gateway = ThingsGateway(things, run=lambda *args, **kwargs: None, sleeper=lambda _: None)

    result = gateway.update_todo(TODO_ID, title="Expected but ignored")

    assert result.status == "mismatch"
    assert result.mismatches["title"] == {"expected": "Expected but ignored", "actual": "Old title"}


def test_hostile_ids_are_rejected_before_url_or_subprocess():
    calls = []
    gateway = ThingsGateway(
        FakeThings(), run=lambda *args, **kwargs: calls.append(args), sleeper=lambda _: None
    )

    with pytest.raises(ValueError, match="opaque Things ID"):
        gateway.update_todo(HOSTILE_ID, title="ignore & auth-token=stolen")

    assert calls == []


def test_native_22_character_things_ids_are_accepted():
    gateway = ThingsGateway(FakeThings(), sleeper=lambda _: None)

    assert gateway.read_todo("AbCdEfGhIjKlMnOpQrSt12") is None


def test_today_write_verifies_against_things_start_date():
    things = FakeThings()

    def run(*_args, **_kwargs):
        things.records[TODO_ID]["start_date"] = date.today()

    result = ThingsGateway(things, run=run, sleeper=lambda _: None).update_todo(
        TODO_ID, when="today"
    )

    assert result.applied


def test_hostile_text_is_percent_encoded_and_token_is_absent_from_safe_command():
    text = 'a&auth-token=steal?x="$(bad)" + %20 /'
    gateway = ThingsGateway(FakeThings(), sleeper=lambda _: None)

    command = gateway.build_update_todo_command(TODO_ID, title=text)

    assert "&auth-token=" not in command.safe_url
    assert "&auth-token=steal" not in command.safe_url
    assert "%26auth-token%3Dsteal%3Fx%3D%22%24%28bad%29%22%20%2B%20%2520%20%2F" in command.safe_url
    assert "very-secret-token" not in repr(command)


def test_create_requires_unique_readback_match():
    things = FakeThings()
    created = {"done": False}

    def run(*args, **kwargs):
        things.records["33333333-3333-4333-8333-333333333333"] = {
            "uuid": "33333333-3333-4333-8333-333333333333",
            "type": "to-do",
            "title": "New task",
            "notes": "Context",
            "tags": ["work"],
            "status": "open",
            "items": [],
        }
        created["done"] = True

    result = ThingsGateway(things, run=run, sleeper=lambda _: None).create_todo(
        title="New task", notes="Context", tags=["work"]
    )

    assert created["done"] and result.applied


def test_create_ambiguity_is_not_false_success():
    things = FakeThings()
    first = dict(things.records[TODO_ID], title="Duplicate")
    second = dict(first, uuid="44444444-4444-4444-8444-444444444444")
    things.records = {first["uuid"]: first, second["uuid"]: second}

    result = ThingsGateway(
        things, run=lambda *args, **kwargs: None, sleeper=lambda _: None
    ).create_todo(title="Duplicate")

    assert result.status == "mismatch"
    assert "unambiguously" in result.error
