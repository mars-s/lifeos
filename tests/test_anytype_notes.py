"""The note tools, captures, interpretations, journal and promotions against the fake Anytype
Local API. The person's real Anytype is never touched."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fake_anytype import KEY, SPACE, FakeAnytype
from fastmcp import Client

from lifeos.anytype_gateway import (
    AnytypeGateway,
    AnytypeSettings,
    NotesNotPermitted,
    NotesUnavailable,
)
from lifeos.brain_dump_store import BrainDumpStore
from lifeos.proposal_store import IdempotencyConflict, ProposalStore
from lifeos.server import create_mcp
from lifeos.service import LifeOSService


class NoThings:
    def read_todo(self, _todo_id):
        return None


class FakeThings:
    """Records create_todo calls; never touches real Things."""

    def __init__(self):
        self.created = []

    def read_todo(self, todo_id):
        return {"uuid": todo_id} if todo_id.startswith("TODO-") else None

    def create_todo(self, **fields):
        from lifeos.things_gateway import WriteResult

        self.created.append(fields)
        uuid = f"TODO-{len(self.created)}"
        return WriteResult(status="verified", command="create", record={"record": {"uuid": uuid, **fields}})


@pytest.fixture
def fake():
    with FakeAnytype() as server:
        yield server


def gateway(fake_or_url, *, writes=True, key=KEY):
    url = fake_or_url if isinstance(fake_or_url, str) else fake_or_url.url
    return AnytypeGateway(AnytypeSettings(url, SPACE), key_source=lambda: key, writes=writes)


CLOSED = "http://127.0.0.1:9"


def service_for(tmp_path, notes, things=None):
    db = tmp_path / "lifeos.sqlite3"
    return LifeOSService(
        ProposalStore(db), things or NoThings(), None,
        BrainDumpStore(db, tmp_path / "journal"), anytype=notes,
    )


RAW = (
    "Need to email Sam about the water rota before Friday.\n"
    "Not sure if the build day is the 18th or the 25th.\n"
    "Felt calmer after the garden today."
)


def interpret(service, capture, key, by):
    return service.submit_brain_dump_semanticization(
        capture_id=capture["capture_id"], source_hash=capture["source_hash"], idempotency_key=key,
        interpreted_by=by, summary="Garden admin.",
        items=[
            {"kind": "task", "title": "Email Sam about the water rota", "confidence": 0.9,
             "source_excerpt": "email Sam about the water rota", "time_expression": "before Friday"},
            {"kind": "question", "title": "Which date is the build day?", "confidence": 0.6,
             "source_excerpt": "the 18th or the 25th"},
        ],
        unresolved=["Is the rota weekly?"],
        journal_entry="Felt calmer after the garden today.",
    )


def count(service, table):
    return service.store._connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def test_anytype_closed_is_unavailable_and_nothing_is_recorded(tmp_path):
    service = service_for(tmp_path, gateway(CLOSED))
    with pytest.raises(NotesUnavailable):
        service.notes_add(request_id="r1", name="Hello", by="claude")
    with pytest.raises(NotesUnavailable):
        service.notes_search("anything")
    assert count(service, "proposals") == 0
    (tmp_path / "x").mkdir()
    unset = service_for(tmp_path / "x", None)
    with pytest.raises(NotesUnavailable, match="lifeos anytype connect"):
        unset.notes_search("anything")


def test_without_notes_write_every_write_is_refused_and_the_ledger_keeps_the_capture(tmp_path, fake):
    service = service_for(tmp_path, gateway(fake, writes=False))
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="c", source="chat")
    assert capture["anytype"] == {"status": "not permitted"}
    assert service.get_brain_dump(capture["capture_id"])["raw_text"] == RAW
    with pytest.raises(NotesNotPermitted):
        service.notes_add(request_id="r", name="x", by="chatgpt")
    assert [r for r in fake.requests if r[0] != "GET"] == []


def test_wrong_key_fails_closed_and_never_echoes_the_key(tmp_path, fake):
    wrong = "w" * 40
    service = service_for(tmp_path, gateway(fake, key=wrong))
    with pytest.raises(NotesUnavailable) as refused:
        service.notes_add(request_id="r1", name="Never written", by="codex")
    assert wrong not in str(refused.value) and KEY not in str(refused.value)
    assert fake.objects == {} and count(service, "proposals") == 0


def test_notes_add_twice_with_one_request_id_makes_one_object(tmp_path, fake):
    service = service_for(tmp_path, gateway(fake))
    first = service.notes_add(request_id="add-1", name="Buy bean seeds", by="chatgpt", tag="Ask agent",
                              body="From the **garden** list.")
    again = service.notes_add(request_id="add-1", name="Buy bean seeds", by="chatgpt", tag="Ask agent",
                              body="From the **garden** list.")
    assert first["saved"] and again["saved"] and first["object_id"] == again["object_id"]
    assert [hit["id"] for hit in service.notes_search("Buy bean seeds")["results"]] == [first["object_id"]]
    note = service.notes_read(first["object_id"])["object"]
    assert note["properties"]["tag"] == ["ask_agent"]
    assert note["properties"]["made_by"] == "chatgpt"
    assert note["properties"]["lifeos_request_id"] == "add-1"
    with pytest.raises(IdempotencyConflict):
        service.notes_add(request_id="add-1", name="Something else", by="chatgpt")
    # An invented tag, type or a LifeOS-owned property is refused; LifeOS never makes them for an agent.
    with pytest.raises(ValueError):
        service.notes_add(request_id="add-2", name="x", by="claude", tag="made-up-tag")
    with pytest.raises(ValueError):
        service.notes_add(request_id="add-3", name="x", by="claude", type_key="no_such_type")
    with pytest.raises(ValueError):
        service.notes_add(request_id="add-4", name="x", by="claude", properties={"lifeos_source_hash": "x"})
    assert KEY not in json.dumps(first) and KEY not in json.dumps(service.notes_read(first["object_id"]))
    assert fake.deletes() == []


def test_tier_two_edit_needs_the_fresh_hash(tmp_path, fake):
    service = service_for(tmp_path, gateway(fake))
    object_id = service.notes_add(request_id="n", name="Water rota", by="claude")["object_id"]
    fresh = service.notes_read(object_id)["hash"]
    done = service.notes_edit(
        request_id="f1", object_id=object_id, expected_hash=fresh, by="claude",
        operation="tag", fields={"tag": "ask_agent"},
    )
    assert done["saved"]
    # The old hash no longer matches: refused, nothing written.
    with pytest.raises(ValueError):
        service.notes_edit(
            request_id="f2", object_id=object_id, expected_hash=fresh, by="claude",
            operation="move", fields={"collection_id": "obj-1"},
        )
    with pytest.raises(ValueError):  # LifeOS-owned properties are not for agents
        service.notes_edit(
            request_id="f3", object_id=object_id, expected_hash=service.notes_read(object_id)["hash"],
            by="claude", operation="set_field", fields={"field": "lifeos_things_id", "value": "x"},
        )
    collection = service.notes_add(request_id="c", name="Garden", by="claude")["object_id"]
    moved = service.notes_edit(
        request_id="m1", object_id=object_id, expected_hash=service.notes_read(object_id)["hash"],
        by="claude", operation="move", fields={"collection_id": collection},
    )
    assert moved["saved"] and fake.lists[collection] == [object_id]


@pytest.mark.asyncio
async def test_note_tools_over_mcp(tmp_path, fake):
    async with Client(create_mcp(service_for(tmp_path, gateway(fake)))) as client:
        tools = {tool.name: tool for tool in await client.list_tools()}
        added = await client.call_tool("notes_add", {"request_id": "mcp-1", "name": "From MCP", "by": "claude"})
        found = await client.call_tool("notes_search", {"query": "From MCP"})
        types = await client.call_tool("notes_list_types", {})
    assert {"notes_search", "notes_read", "notes_today", "notes_list_types", "notes_add", "notes_tag",
            "notes_set_field", "notes_move", "notes_link_task"} <= set(tools)
    assert tools["notes_search"].annotations.readOnlyHint is True
    assert tools["notes_add"].annotations.readOnlyHint is False
    assert tools["notes_add"].annotations.destructiveHint is False
    assert added.structured_content["saved"] is True
    assert found.structured_content["results"][0]["id"] == added.structured_content["object_id"]
    assert "lifeos_capture" in {t["key"] for t in types.structured_content["types"]}


def test_capture_then_interpret_twice(tmp_path, fake):
    service = service_for(tmp_path, gateway(fake))
    capture = service.capture_brain_dump(
        raw_text=RAW, idempotency_key="cap-1", source="chat", captured_at="2026-10-10T09:30:00+11:00",
    )
    assert capture["anytype"]["status"] == "saved" and capture["anytype"]["source_hash_matches"]
    assert service.capture_brain_dump(
        raw_text=RAW, idempotency_key="cap-1", source="chat", captured_at="2026-10-10T09:30:00+11:00",
    )["anytype"]["object_id"] == capture["anytype"]["object_id"]
    first = interpret(service, capture, "i-1", "chatgpt")
    second = interpret(service, capture, "i-2", "claude")
    assert first["anytype"]["status"] == second["anytype"]["status"] == "saved"
    assert first["anytype"]["object_id"] != second["anytype"]["object_id"]
    assert first["journal_written"] is False  # the journal's home is the Anytype journal day

    raw = fake.objects[capture["anytype"]["object_id"]]
    assert raw["type"] == "lifeos_capture" and raw["markdown"] == RAW
    assert raw["properties"]["lifeos_source_hash"]["text"] == capture["source_hash"]
    assert len([o for o in fake.objects.values() if o["type"] == "lifeos_capture"]) == 1
    interpretations = [o for o in fake.objects.values() if o["type"] == "lifeos_interpretation"]
    assert len(interpretations) == 2
    assert all(o["properties"]["lifeos_source"]["objects"] == [raw["id"]] for o in interpretations)
    assert "Is the rota weekly?" in interpretations[0]["markdown"]
    actions = [o for o in fake.objects.values() if o["type"] == "lifeos_suggested_action"]
    assert len(actions) == 2
    assert all(o["properties"]["lifeos_evidence"]["text"] in RAW for o in actions)
    assert {o["properties"]["lifeos_source"]["objects"][0] for o in actions} == {o["id"] for o in interpretations}
    assert first["anytype"]["suggested_action_ids"][0] in fake.objects

    day = service.notes_today("2026-10-10")
    assert day["markdown"].count("Felt calmer after the garden today.") == 2  # one per interpretation
    exported = service.export_journal("2026-10-10")
    assert exported["path"].endswith("2026-10-10.md") and "Felt calmer" in Path(exported["path"]).read_text()
    hand = tmp_path / "journal" / "2026-10-11.md"
    hand.write_text("# my own words\n")
    assert service.export_journal("2026-10-11")["path"] is None  # no journal day yet
    assert hand.read_text() == "# my own words\n"
    assert fake.deletes() == []


def test_meeting_debrief_is_a_meeting_object(tmp_path, fake):
    service = service_for(tmp_path, gateway(fake))
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="m", source="import")
    result = service.submit_brain_dump_semanticization(
        capture_id=capture["capture_id"], source_hash=capture["source_hash"], idempotency_key="mi",
        interpreted_by="claude", items=[], meeting_title="Garden committee",
    )
    meeting = service.notes_read(result["anytype"]["object_id"])["object"]
    assert meeting["name"] == "Garden committee" and meeting["type"] == "lifeos_meeting"


def test_capture_succeeds_with_anytype_closed_and_journal_falls_back(tmp_path):
    service = service_for(tmp_path, gateway(CLOSED))
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="c", source="chat",
                                         captured_at="2026-10-10T09:30:00+11:00")
    assert capture["anytype"] == {"status": "unavailable"}
    revision = interpret(service, capture, "i", "codex")
    assert revision["anytype"] == {"status": "unavailable", "journal": "queued"}
    assert revision["journal_written"] is True  # Markdown keeps the prose until Anytype is back


def test_journal_prose_written_while_anytype_is_closed_reaches_the_journal_day_once(tmp_path, fake):
    prose = "Felt calmer after the garden today."
    closed = service_for(tmp_path, gateway(CLOSED))
    capture = closed.capture_brain_dump(raw_text=RAW, idempotency_key="j", source="chat",
                                        captured_at="2026-10-10T09:30:00+11:00")
    assert interpret(closed, capture, "j-1", "claude")["anytype"]["journal"] == "queued"
    assert closed.flush_journal_outbox() == {"written": 0}
    service = service_for(tmp_path, gateway(fake))  # Anytype is open again; same LifeOS database
    assert service.flush_journal_outbox() == {"written": 1}
    assert service.flush_journal_outbox() == {"written": 0}
    assert service.notes_today("2026-10-10")["markdown"].count(prose) == 1
    assert service.brain_dumps.queued_journal() == []
    assert len([o for o in fake.objects.values() if o["type"] == "lifeos_journal_day"]) == 1


def test_export_journal_cli(tmp_path, fake, monkeypatch, capsys):
    from lifeos import cli
    from lifeos.anytype_gateway import save_settings

    db = tmp_path / "lifeos.sqlite3"
    service = service_for(tmp_path, gateway(fake))
    capture = service.capture_brain_dump(raw_text=RAW, idempotency_key="e", source="chat",
                                         captured_at="2026-10-10T09:30:00+11:00")
    interpret(service, capture, "e-1", "claude")
    save_settings(tmp_path / "anytype.json", AnytypeSettings(fake.url, SPACE))
    monkeypatch.setenv("LIFEOS_ANYTYPE_CONFIG", str(tmp_path / "anytype.json"))
    monkeypatch.setenv("LIFEOS_ANYTYPE_API_KEY", KEY)
    monkeypatch.setenv("LIFEOS_DB_PATH", str(db))
    monkeypatch.setenv("LIFEOS_JOURNAL_DIR", str(tmp_path / "journal"))
    assert cli.main(["export-journal", "--date", "2026-10-10"]) == 0
    written = json.loads(capsys.readouterr().out)
    assert "Felt calmer" in Path(written["path"]).read_text()


def promote(service, object_id):
    return service.promote_notes_to_things(
        proposal_id=f"promote-{object_id}", by="claude",
        items=[{"object_id": object_id, "expected_hash": service.notes_read(object_id)["hash"]}],
    )


def test_promote_note_to_things_links_the_object(tmp_path, fake):
    things = FakeThings()
    service = service_for(tmp_path, gateway(fake), things)
    object_id = service.notes_add(request_id="p", name="Order compost", by="claude")["object_id"]
    draft = promote(service, object_id)
    assert draft["state"] == "draft" and things.created == []
    from lifeos.ui import ProposalReviewOutput

    assert ProposalReviewOutput.model_validate(draft).note_changes[0].operation == "link_task"
    service.approve_proposal(draft["proposal_id"], draft["revision_hash"])  # the card does this
    applied = service.apply_proposal(draft["proposal_id"], draft["revision_hash"])
    assert applied["state"] == "applied"
    assert things.created == [{"title": "Order compost", "notes": f"From Anytype note {object_id}."}]
    linked = service.notes_read(object_id)["object"]["properties"]
    assert linked["lifeos_things_id"] == "TODO-1"
    assert linked["lifeos_things_link"] == "things:///show?id=TODO-1"
    assert linked["lifeos_status"] == "in_things"


def test_editing_the_note_after_approval_makes_apply_stale(tmp_path, fake):
    things = FakeThings()
    notes = gateway(fake)
    service = service_for(tmp_path, notes, things)
    object_id = service.notes_add(request_id="s", name="Fix the gate", by="codex")["object_id"]
    draft = promote(service, object_id)
    service.approve_proposal(draft["proposal_id"], draft["revision_hash"])
    notes.update(object_id, markdown="Changed my mind", agent="person")  # the person edits it
    result = service.apply_proposal(draft["proposal_id"], draft["revision_hash"])
    assert result["state"] == "stale"
    assert things.created == []
    assert "lifeos_things_id" not in service.notes_read(object_id)["object"]["properties"]


@pytest.mark.asyncio
async def test_without_notes_write_nothing_reaches_anytype_but_the_ledger_keeps_it(tmp_path, fake, monkeypatch):
    from lifeos import cloud_bridge

    things = FakeThings()
    monkeypatch.setattr(
        cloud_bridge, "build_default_service",
        lambda *, notes_writes: service_for(tmp_path, gateway(fake, writes=notes_writes), things),
    )

    async def call(tool, arguments, notes_write=None):
        grant = {} if notes_write is None else {"_lifeos_grant": {"notes_write": notes_write}}
        return await cloud_bridge.invoke({"tool": tool, "arguments": {**arguments, **grant}})

    for notes_write in (False, None):
        key = f"local-only-{notes_write}"
        capture = (await call("capture_brain_dump", {"raw_text": RAW, "idempotency_key": key}, notes_write))["structuredContent"]
        assert capture["anytype"] == {"status": "not permitted"}
        interpreted = (await call("submit_brain_dump_semanticization", {
            "capture_id": capture["capture_id"], "source_hash": capture["source_hash"],
            "idempotency_key": key, "items": [], "journal_entry": "Felt calmer after the garden today.",
        }, notes_write))["structuredContent"]
        assert interpreted["anytype"] == {"status": "not permitted"}
        assert interpreted["journal_written"] is True  # the prose stays in Markdown, not queued
        added = await call("notes_add", {"request_id": key, "name": "Sneaky note", "by": "chatgpt"}, notes_write)
        assert added["isError"] is True and "not permitted" in added["content"][0]["text"]
    assert fake.objects == {}
    ledger = service_for(tmp_path, gateway(fake))
    assert ledger.list_brain_dumps()["total"] == 2
    assert count(ledger, "proposals") == 0

    writer = service_for(tmp_path, gateway(fake), things)
    object_id = writer.notes_add(request_id="promo", name="Order compost", by="claude")["object_id"]
    draft = promote(writer, object_id)
    writer.approve_proposal(draft["proposal_id"], draft["revision_hash"])
    applied = await call("apply_approved_proposal", {
        "proposal_id": draft["proposal_id"], "revision_hash": draft["revision_hash"],
    }, False)
    assert applied["isError"] is True and things.created == []
    assert writer.get_proposal(draft["proposal_id"])["state"] == "approved"

    granted = await call("capture_brain_dump", {"raw_text": RAW, "idempotency_key": "granted"}, True)
    assert granted["structuredContent"]["anytype"]["status"] == "saved"
