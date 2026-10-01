from __future__ import annotations

import pytest

from lifeos.models import (
    CalendarChange,
    ChangeOperation,
    ProposalState,
    SourceSnapshot,
    ThingsChange,
    revision_hash,
)
from lifeos.proposal_store import (
    IdempotencyConflict,
    InvalidTransition,
    ProposalStore,
    RevisionMismatch,
)


def source(version: str = "v1") -> SourceSnapshot:
    return SourceSnapshot(
        "things", "task-1", version, {"title": "Write essay", "notes": "Quoted user data"}
    )


def things_change() -> ThingsChange:
    return ThingsChange(ChangeOperation.UPDATE, "task-1", {"title": "Draft essay"})


def calendar_change() -> CalendarChange:
    return CalendarChange(
        ChangeOperation.CREATE,
        "Work",
        None,
        {"title": "Draft essay", "start": "2026-09-22T09:00:00+10:00"},
    )


def create(store: ProposalStore):
    return store.create_draft(
        "tomorrow-plan",
        idempotency_key="request-1",
        source_snapshots=[source()],
        things_changes=[things_change()],
        calendar_changes=[calendar_change()],
    )


def test_hash_is_stable_despite_mapping_order() -> None:
    a = SourceSnapshot("things", "task-1", "v1", {"title": "x", "notes": "y"})
    b = SourceSnapshot("things", "task-1", "v1", {"notes": "y", "title": "x"})
    assert revision_hash("p", 1, [a], [things_change()], []) == revision_hash(
        "p", 1, [b], [things_change()], []
    )


def test_draft_is_durable_and_idempotent_after_restart(tmp_path) -> None:
    path = tmp_path / "proposals.sqlite"
    with ProposalStore(path) as store:
        created = create(store)
        assert create(store) == created
    with ProposalStore(path) as reopened:
        restored = reopened.get_current("tomorrow-plan")
        assert restored.revision_hash == created.revision_hash
        assert restored.calendar_changes[0].calendar_id == "Work"
        with pytest.raises(IdempotencyConflict):
            reopened.create_draft(
                "tomorrow-plan", idempotency_key="request-1", source_snapshots=[source("v2")]
            )


def test_approval_is_bound_to_the_exact_current_hash(tmp_path) -> None:
    with ProposalStore(tmp_path / "p.sqlite") as store:
        first = create(store)
        second = store.create_revision(
            "tomorrow-plan", source_snapshots=[source("v2")], things_changes=[things_change()]
        )
        with pytest.raises(RevisionMismatch):
            store.approve("tomorrow-plan", first.revision_hash)
        approved = store.approve("tomorrow-plan", second.revision_hash)
        assert approved.state is ProposalState.APPROVED
        assert approved.approved_revision_hash == second.revision_hash


def test_apply_state_machine_is_idempotent(tmp_path) -> None:
    with ProposalStore(tmp_path / "p.sqlite") as store:
        draft = create(store)
        approved = store.approve(draft.proposal_id, draft.revision_hash)
        applying = store.begin_apply(draft.proposal_id, draft.revision_hash)
        assert store.begin_apply(draft.proposal_id, draft.revision_hash) == applying
        applied = store.finish_apply(draft.proposal_id, draft.revision_hash)
        assert applied.state is ProposalState.APPLIED
        assert store.finish_apply(draft.proposal_id, draft.revision_hash) == applied
        assert (
            store.mark_reverted(draft.proposal_id, draft.revision_hash).state
            is ProposalState.REVERTED
        )
        assert approved.approved_revision_hash == draft.revision_hash


def test_partial_failure_records_detail_and_can_be_reverted(tmp_path) -> None:
    with ProposalStore(tmp_path / "p.sqlite") as store:
        draft = create(store)
        store.approve(draft.proposal_id, draft.revision_hash)
        store.begin_apply(draft.proposal_id, draft.revision_hash)
        failed = store.finish_apply(
            draft.proposal_id, draft.revision_hash, partial_failure="calendar event rejected"
        )
        assert failed.state is ProposalState.PARTIAL_FAILURE
        assert failed.failure_detail == "calendar event rejected"
        assert (
            store.mark_reverted(draft.proposal_id, draft.revision_hash).state
            is ProposalState.REVERTED
        )


def test_changed_snapshot_marks_reviewed_revision_stale(tmp_path) -> None:
    with ProposalStore(tmp_path / "p.sqlite") as store:
        draft = create(store)
        store.approve(draft.proposal_id, draft.revision_hash)
        stale = store.check_freshness(draft.proposal_id, draft.revision_hash, [source("v2")])
        assert stale.state is ProposalState.STALE
        with pytest.raises(InvalidTransition):
            store.begin_apply(draft.proposal_id, draft.revision_hash)


def test_rejection_and_stale_are_idempotent_but_not_applyable(tmp_path) -> None:
    with ProposalStore(tmp_path / "p.sqlite") as store:
        draft = create(store)
        assert store.reject(draft.proposal_id, draft.revision_hash).state is ProposalState.REJECTED
        assert store.reject(draft.proposal_id, draft.revision_hash).state is ProposalState.REJECTED
        with pytest.raises(InvalidTransition):
            store.approve(draft.proposal_id, draft.revision_hash)


def test_sql_data_is_bound_as_parameters_not_interpolated(tmp_path) -> None:
    proposal_id = "quote'); DROP TABLE proposals; --"
    with ProposalStore(tmp_path / "p.sqlite") as store:
        draft = store.create_draft(
            proposal_id, idempotency_key="sql-test", source_snapshots=[source()]
        )
        assert store.get_current(proposal_id).revision_hash == draft.revision_hash
        count = store._connection.execute("SELECT count(*) FROM proposals").fetchone()[0]
        assert count == 1


def test_invalid_shape_is_rejected_before_storage() -> None:
    with pytest.raises(ValueError):
        ThingsChange(ChangeOperation.UPDATE, None, {})
    with pytest.raises(ValueError):
        CalendarChange(ChangeOperation.CREATE, "", None, {})
