"""AnytypeGateway against the fake Local API. The real Anytype is never touched."""

from __future__ import annotations

import os
import stat

import pytest
from fake_anytype import KEY, SPACE, FakeAnytype

from lifeos.anytype_gateway import (
    ALLOWED_ROUTES,
    NEVER_ROUTES,
    PROPERTIES,
    TYPES,
    AnytypeGateway,
    AnytypeSettings,
    NotesNotPermitted,
    NotesUnavailable,
    load_settings,
    pair_api_key,
    read_api_key,
    save_settings,
    store_api_key,
)


@pytest.fixture
def fake():
    with FakeAnytype() as server:
        yield server


def gateway(fake, *, key=KEY, writes=True):
    return AnytypeGateway(AnytypeSettings(fake.url, SPACE), key_source=lambda: key, writes=writes)


def test_never_routes_are_unreachable_and_fail_before_any_request(fake):
    assert not ALLOWED_ROUTES & NEVER_ROUTES
    assert all(method != "DELETE" for method, _ in ALLOWED_ROUTES)
    any_gateway = gateway(fake)
    for method, route in NEVER_ROUTES:
        with pytest.raises(PermissionError):
            any_gateway._request(method, route, "x", "y", "z")
    assert fake.requests == []


def test_without_notes_write_every_write_is_refused_before_any_request(fake):
    reader = gateway(fake, writes=False)
    with pytest.raises(NotesNotPermitted):
        reader.create(type_key="page", name="x")
    with pytest.raises(NotesNotPermitted):
        reader.ensure_schema()
    assert all(method == "GET" for method, _, _ in fake.requests)


def test_wrong_key_fails_closed_and_never_echoes_the_key(fake):
    wrong = "f" * 40
    with pytest.raises(NotesUnavailable) as refused:
        gateway(fake, key=wrong).search("garden")
    assert wrong not in str(refused.value) and KEY not in str(refused.value)
    with pytest.raises(NotesUnavailable):
        gateway(fake, key=None).search("garden")
    closed = AnytypeGateway(AnytypeSettings("http://127.0.0.1:9", SPACE), key_source=lambda: KEY)
    assert closed.available() is False


def test_schema_is_created_once(fake):
    first = gateway(fake).ensure_schema()
    assert set(first["types"]) == set(TYPES)
    assert set(PROPERTIES) <= set(first["properties"])
    assert "ask_agent" in first["tags"]
    writes = len([r for r in fake.requests if r[0] != "GET"])
    second = gateway(fake).ensure_schema()
    assert second == {"properties": [], "types": [], "tags": []}
    assert len([r for r in fake.requests if r[0] != "GET"]) == writes
    assert fake.tags["tag"]["ask_agent"]["name"] == "Ask agent"
    assert {t["name"] for t in fake.tags["lifeos_status"].values()} >= {"New", "In Things"}


def test_create_read_tag_and_hash(fake):
    notes = gateway(fake)
    notes.ensure_schema()
    object_id = notes.create(
        type_key="lifeos_suggested_action", name="Email Sam", body="About the rota",
        properties={"lifeos_status": "Suggested", "lifeos_evidence": "email Sam"}, agent="claude",
    )
    view = notes.get(object_id)
    assert view["properties"]["made_by"] == "claude"
    assert view["properties"]["lifeos_status"] == "suggested"
    before = notes.snapshot(object_id)["hash"]
    notes.tag(object_id, "ask_agent", agent="codex")
    after = notes.snapshot(object_id)
    assert after["hash"] != before
    assert after["node"]["properties"]["tag"] == ["ask_agent"]
    assert after["node"]["properties"]["made_by"] == "codex"
    # Anytype's own last-modified stamp alone never changes the hash.
    fake.objects[object_id]["properties"]["last_modified_date"]["date"] = "later"
    assert notes.snapshot(object_id)["hash"] == after["hash"]
    with pytest.raises(ValueError):
        notes.update(object_id, properties={"lifeos_status": "Made up"})
    assert notes.snapshot("obj-missing") is None
    assert [hit["id"] for hit in notes.search("Email Sam")] == [object_id]


def test_settings_and_key_file(tmp_path):
    path = tmp_path / "anytype.json"
    assert load_settings(path, {}) is None
    save_settings(path, AnytypeSettings("http://127.0.0.1:31012", "space-9", "chat-1"))
    assert load_settings(path, {}) == AnytypeSettings("http://127.0.0.1:31012", "space-9", "chat-1")
    assert load_settings(path, {"LIFEOS_ANYTYPE_SPACE_ID": "space-env"}).space_id == "space-env"
    key_file = tmp_path / "key"
    env = {"LIFEOS_ANYTYPE_API_KEY_FILE": str(key_file), "LIFEOS_ANYTYPE_NO_KEYCHAIN": "1"}
    assert store_api_key("abc/DEF+123=", env) == str(key_file)
    assert stat.S_IMODE(os.stat(key_file).st_mode) == 0o600
    assert read_api_key(env) == "abc/DEF+123="
    assert read_api_key({"LIFEOS_ANYTYPE_NO_KEYCHAIN": "1"}) is None
    with pytest.raises(ValueError):
        store_api_key("two words", env)


def test_pairing_flow(fake):
    assert pair_api_key(fake.url, "LifeOS", lambda: "1234") == KEY
    with pytest.raises(NotesUnavailable):
        pair_api_key(fake.url, "LifeOS", lambda: "0000")


def test_chat_stream_parses_events_and_skips_heartbeats(fake):
    notes = gateway(fake)
    chat = notes.find_or_create_chat()
    assert notes.find_or_create_chat() == chat
    fake.user_says(chat, "hello")
    events = notes.stream(chat, limit=10, timeout=5)
    name, message = next(events)
    assert (name, message["content"]["text"]) == ("message_added", "hello")
    reply = notes.post_message(chat, "hi back", reply_to=message["id"])
    name, message = next(events)
    assert message["id"] == reply and message["reply_to_message_id"]
    events.close()
