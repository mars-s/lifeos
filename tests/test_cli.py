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
