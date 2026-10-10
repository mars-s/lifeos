from __future__ import annotations

from lifeos import cli
from lifeos.models import ChangeOperation, ThingsChange
from lifeos.proposal_store import ProposalStore


def _draft(path):
    with ProposalStore(path) as store:
        return store.create_draft(
            "p1", idempotency_key="k1", source_snapshots=(),
            things_changes=(ThingsChange(ChangeOperation.CREATE, None, {"title": "Call Sam"}),),
        ).revision_hash


def _state(path):
    with ProposalStore(path) as store:
        return store.get_current("p1").state.value


def test_fallback_approval_needs_a_terminal_and_the_typed_hash(tmp_path, monkeypatch, capsys):
    db = tmp_path / "lifeos.sqlite3"
    monkeypatch.setenv("LIFEOS_DB_PATH", str(db))
    digest = _draft(db)
    args = ["approve", "p1", digest]

    # An agent's shell has no terminal: refused before anything is read or written.
    assert cli.main(args, interactive=lambda: False) == 2
    assert _state(db) == "draft"
    # A wrong typed prefix changes nothing.
    assert cli.main(args, interactive=lambda: True, ask=lambda _: "nope") == 1
    assert _state(db) == "draft"
    assert cli.main(args, interactive=lambda: True, ask=lambda _: digest[:8]) == 0
    assert _state(db) == "approved"
    assert "Call Sam" in capsys.readouterr().out


def test_fallback_reject(tmp_path, monkeypatch):
    db = tmp_path / "lifeos.sqlite3"
    monkeypatch.setenv("LIFEOS_DB_PATH", str(db))
    digest = _draft(db)
    assert cli.main(["reject", "p1", digest], interactive=lambda: True, ask=lambda _: digest[:8]) == 0
    assert _state(db) == "rejected"


def test_anytype_connect_saves_key_space_schema_and_chat(tmp_path, monkeypatch, capsys):
    import json

    from fake_anytype import KEY, SPACE, FakeAnytype

    from lifeos.anytype_gateway import load_settings, read_api_key

    key_file = tmp_path / "key"
    monkeypatch.setenv("LIFEOS_DB_PATH", str(tmp_path / "lifeos.sqlite3"))
    monkeypatch.setenv("LIFEOS_ANYTYPE_CONFIG", str(tmp_path / "anytype.json"))
    monkeypatch.setenv("LIFEOS_ANYTYPE_API_KEY_FILE", str(key_file))
    with FakeAnytype() as fake:
        args = ["anytype", "connect", "--url", fake.url]
        # An agent's shell cannot connect: it needs a person at a terminal.
        assert cli.main(args, interactive=lambda: False) == 2
        assert cli.main(args, interactive=lambda: True, secret=lambda _: KEY, ask=lambda _: "1") == 0
        out = capsys.readouterr().out
        assert KEY not in out
        settings = load_settings(tmp_path / "anytype.json")
        assert settings.space_id == SPACE and settings.base_url == fake.url and settings.chat_id
        assert read_api_key({"LIFEOS_ANYTYPE_API_KEY_FILE": str(key_file)}) == KEY
        assert "lifeos_capture" in fake.types and [c["name"] for c in fake.chats.values()] == ["LifeOS"]
        # Running it again (here with the pairing flow) creates nothing new.
        assert cli.main(args + ["--pair", "--space", "Personal"], interactive=lambda: True,
                        ask=lambda _: "1234") == 0
        again = json.loads(capsys.readouterr().out)
        assert again["created"] == {"properties": [], "types": [], "tags": []}
        assert len(fake.chats) == 1 and fake.deletes() == []
