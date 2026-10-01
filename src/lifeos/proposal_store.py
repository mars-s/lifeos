"""Durable SQLite storage for immutable, user-reviewed proposal revisions."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock

from .models import (
    CalendarChange,
    ProposalRevision,
    ProposalState,
    SourceSnapshot,
    ThingsChange,
    canonical_json,
    revision_hash,
)


class ProposalError(RuntimeError):
    pass


class UnknownProposal(ProposalError):
    pass


class RevisionMismatch(ProposalError):
    pass


class InvalidTransition(ProposalError):
    pass


class IdempotencyConflict(ProposalError):
    pass


class ProposalStore:
    """A local, restart-safe store. It never applies an external change itself."""

    def __init__(self, path: str | Path) -> None:
        self._lock = RLock()
        self._connection = sqlite3.connect(Path(path), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._connection.execute("PRAGMA journal_mode = WAL")
        self._connection.execute("PRAGMA synchronous = FULL")
        self._connection.execute("PRAGMA foreign_keys = ON")
        self._migrate()

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> ProposalStore:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _migrate(self) -> None:
        with self._transaction() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS proposals (
                    proposal_id TEXT PRIMARY KEY,
                    current_revision_hash TEXT NOT NULL UNIQUE,
                    idempotency_key TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS proposal_revisions (
                    proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
                    revision_number INTEGER NOT NULL,
                    revision_hash TEXT NOT NULL UNIQUE,
                    state TEXT NOT NULL,
                    source_snapshots_json TEXT NOT NULL,
                    things_changes_json TEXT NOT NULL,
                    calendar_changes_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    approved_revision_hash TEXT,
                    failure_detail TEXT,
                    PRIMARY KEY (proposal_id, revision_number),
                    UNIQUE (proposal_id, revision_hash),
                    CHECK (state IN ('draft','approved','applying','applied','partial_failure','stale','rejected','reverted'))
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS proposal_revisions_current ON proposal_revisions(proposal_id, revision_number DESC)"
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS applied_operations (
                    proposal_id TEXT NOT NULL,
                    revision_hash TEXT NOT NULL,
                    domain TEXT NOT NULL,
                    operation_index INTEGER NOT NULL,
                    result_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (proposal_id, revision_hash, domain, operation_index),
                    FOREIGN KEY (proposal_id, revision_hash)
                        REFERENCES proposal_revisions(proposal_id, revision_hash)
                )
                """
            )

    @contextmanager
    def _transaction(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            try:
                self._connection.execute("BEGIN IMMEDIATE")
                yield self._connection
                self._connection.commit()
            except BaseException:
                self._connection.rollback()
                raise

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _encode_snapshots(values: Sequence[SourceSnapshot]) -> str:
        return canonical_json([item.to_dict() for item in values])

    @staticmethod
    def _encode_things(values: Sequence[ThingsChange]) -> str:
        return canonical_json([item.to_dict() for item in values])

    @staticmethod
    def _encode_calendar(values: Sequence[CalendarChange]) -> str:
        return canonical_json([item.to_dict() for item in values])

    @staticmethod
    def _row_to_revision(row: sqlite3.Row) -> ProposalRevision:
        return ProposalRevision(
            proposal_id=row["proposal_id"],
            revision_number=row["revision_number"],
            revision_hash=row["revision_hash"],
            state=ProposalState(row["state"]),
            source_snapshots=tuple(
                SourceSnapshot.from_dict(item) for item in json.loads(row["source_snapshots_json"])
            ),
            things_changes=tuple(
                ThingsChange.from_dict(item) for item in json.loads(row["things_changes_json"])
            ),
            calendar_changes=tuple(
                CalendarChange.from_dict(item) for item in json.loads(row["calendar_changes_json"])
            ),
            created_at=row["created_at"],
            approved_revision_hash=row["approved_revision_hash"],
            failure_detail=row["failure_detail"],
        )

    def create_draft(
        self,
        proposal_id: str,
        *,
        idempotency_key: str,
        source_snapshots: Sequence[SourceSnapshot],
        things_changes: Sequence[ThingsChange] = (),
        calendar_changes: Sequence[CalendarChange] = (),
    ) -> ProposalRevision:
        """Create revision one, or safely return the identical prior request."""

        if not proposal_id or not idempotency_key:
            raise ValueError("proposal_id and idempotency_key are required")
        desired_hash = revision_hash(
            proposal_id, 1, source_snapshots, things_changes, calendar_changes
        )
        with self._transaction() as connection:
            existing = connection.execute(
                "SELECT proposal_id, current_revision_hash FROM proposals WHERE proposal_id = ? OR idempotency_key = ?",
                (proposal_id, idempotency_key),
            ).fetchone()
            if existing:
                if (
                    existing["proposal_id"] == proposal_id
                    and existing["current_revision_hash"] == desired_hash
                ):
                    return self._fetch_revision(connection, proposal_id, desired_hash)
                raise IdempotencyConflict(
                    "proposal_id or idempotency_key was already used for different content"
                )
            now = self._now()
            connection.execute(
                "INSERT INTO proposals(proposal_id, current_revision_hash, idempotency_key, created_at) VALUES (?, ?, ?, ?)",
                (proposal_id, desired_hash, idempotency_key, now),
            )
            self._insert_revision(
                connection,
                proposal_id,
                1,
                desired_hash,
                source_snapshots,
                things_changes,
                calendar_changes,
                now,
            )
            return self._fetch_revision(connection, proposal_id, desired_hash)

    def create_revision(
        self,
        proposal_id: str,
        *,
        source_snapshots: Sequence[SourceSnapshot],
        things_changes: Sequence[ThingsChange] = (),
        calendar_changes: Sequence[CalendarChange] = (),
    ) -> ProposalRevision:
        """Append a new immutable draft after a non-applying revision."""

        with self._transaction() as connection:
            current = self._fetch_current(connection, proposal_id)
            if current.state is ProposalState.APPLYING:
                raise InvalidTransition("cannot revise while a proposal is applying")
            number = current.revision_number + 1
            digest = revision_hash(
                proposal_id, number, source_snapshots, things_changes, calendar_changes
            )
            now = self._now()
            self._insert_revision(
                connection,
                proposal_id,
                number,
                digest,
                source_snapshots,
                things_changes,
                calendar_changes,
                now,
            )
            connection.execute(
                "UPDATE proposals SET current_revision_hash = ? WHERE proposal_id = ?",
                (digest, proposal_id),
            )
            return self._fetch_revision(connection, proposal_id, digest)

    def get_current(self, proposal_id: str) -> ProposalRevision:
        with self._lock:
            row = self._connection.execute(
                """SELECT r.* FROM proposals p JOIN proposal_revisions r
                   ON r.proposal_id = p.proposal_id AND r.revision_hash = p.current_revision_hash
                   WHERE p.proposal_id = ?""",
                (proposal_id,),
            ).fetchone()
        if row is None:
            raise UnknownProposal(proposal_id)
        return self._row_to_revision(row)

    def get_revision(self, proposal_id: str, expected_hash: str) -> ProposalRevision:
        with self._lock:
            return self._fetch_revision(self._connection, proposal_id, expected_hash)

    def approve(self, proposal_id: str, expected_hash: str) -> ProposalRevision:
        """Bind approval to the exact current revision, never merely an ID."""

        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if (
                current.state is ProposalState.APPROVED
                and current.approved_revision_hash == expected_hash
            ):
                return current
            if current.state is not ProposalState.DRAFT:
                raise InvalidTransition(f"cannot approve a {current.state.value} proposal")
            connection.execute(
                "UPDATE proposal_revisions SET state = ?, approved_revision_hash = ? WHERE proposal_id = ? AND revision_hash = ?",
                (ProposalState.APPROVED.value, expected_hash, proposal_id, expected_hash),
            )
            return self._fetch_revision(connection, proposal_id, expected_hash)

    def begin_apply(self, proposal_id: str, expected_hash: str) -> ProposalRevision:
        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if current.state is ProposalState.APPLYING:
                return current
            if (
                current.state is ProposalState.PARTIAL_FAILURE
                and current.approved_revision_hash == expected_hash
            ):
                connection.execute(
                    "UPDATE proposal_revisions SET state = ?, failure_detail = NULL WHERE proposal_id = ? AND revision_hash = ?",
                    (ProposalState.APPLYING.value, proposal_id, expected_hash),
                )
                return self._fetch_revision(connection, proposal_id, expected_hash)
            if (
                current.state is not ProposalState.APPROVED
                or current.approved_revision_hash != expected_hash
            ):
                raise InvalidTransition("only the exactly approved revision may apply")
            connection.execute(
                "UPDATE proposal_revisions SET state = ? WHERE proposal_id = ? AND revision_hash = ?",
                (ProposalState.APPLYING.value, proposal_id, expected_hash),
            )
            return self._fetch_revision(connection, proposal_id, expected_hash)

    def finish_apply(
        self, proposal_id: str, expected_hash: str, *, partial_failure: str | None = None
    ) -> ProposalRevision:
        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if current.state is ProposalState.APPLIED and partial_failure is None:
                return current
            if (
                current.state is ProposalState.PARTIAL_FAILURE
                and partial_failure == current.failure_detail
            ):
                return current
            if current.state is not ProposalState.APPLYING:
                raise InvalidTransition("only an applying proposal can finish")
            state = ProposalState.PARTIAL_FAILURE if partial_failure else ProposalState.APPLIED
            connection.execute(
                "UPDATE proposal_revisions SET state = ?, failure_detail = ? WHERE proposal_id = ? AND revision_hash = ?",
                (state.value, partial_failure, proposal_id, expected_hash),
            )
            return self._fetch_revision(connection, proposal_id, expected_hash)

    def mark_stale(self, proposal_id: str, expected_hash: str) -> ProposalRevision:
        return self._transition_terminal(proposal_id, expected_hash, ProposalState.STALE)

    def reject(self, proposal_id: str, expected_hash: str) -> ProposalRevision:
        return self._transition_terminal(proposal_id, expected_hash, ProposalState.REJECTED)

    def mark_reverted(self, proposal_id: str, expected_hash: str) -> ProposalRevision:
        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if current.state is ProposalState.REVERTED:
                return current
            if current.state not in {ProposalState.APPLIED, ProposalState.PARTIAL_FAILURE}:
                raise InvalidTransition(
                    "only an applied or partially failed proposal can be reverted"
                )
            connection.execute(
                "UPDATE proposal_revisions SET state = ? WHERE proposal_id = ? AND revision_hash = ?",
                (ProposalState.REVERTED.value, proposal_id, expected_hash),
            )
            return self._fetch_revision(connection, proposal_id, expected_hash)

    def check_freshness(
        self, proposal_id: str, expected_hash: str, observed: Sequence[SourceSnapshot]
    ) -> ProposalRevision:
        """Mark a draft/approved revision stale when any reviewed source changed."""

        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if current.state not in {ProposalState.DRAFT, ProposalState.APPROVED}:
                return current
            expected = {
                item.key: canonical_json(item.to_dict()) for item in current.source_snapshots
            }
            actual = {item.key: canonical_json(item.to_dict()) for item in observed}
            if expected != actual:
                connection.execute(
                    "UPDATE proposal_revisions SET state = ? WHERE proposal_id = ? AND revision_hash = ?",
                    (ProposalState.STALE.value, proposal_id, expected_hash),
                )
            return self._fetch_revision(connection, proposal_id, expected_hash)

    def get_operation_result(
        self, proposal_id: str, expected_hash: str, domain: str, operation_index: int
    ) -> dict[str, object] | None:
        """Return a durable receipt so an interrupted apply can resume safely."""

        with self._lock:
            row = self._connection.execute(
                """SELECT result_json FROM applied_operations
                   WHERE proposal_id = ? AND revision_hash = ? AND domain = ?
                     AND operation_index = ?""",
                (proposal_id, expected_hash, domain, operation_index),
            ).fetchone()
        if row is None:
            return None
        value = json.loads(row["result_json"])
        if not isinstance(value, dict):
            raise ProposalError("stored operation result is not an object")
        return value

    def record_operation_result(
        self,
        proposal_id: str,
        expected_hash: str,
        domain: str,
        operation_index: int,
        result: dict[str, object],
    ) -> dict[str, object]:
        """Record one successful external write exactly once."""

        encoded = canonical_json(result)
        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if current.state is not ProposalState.APPLYING:
                raise InvalidTransition("operation results may only be recorded while applying")
            existing = connection.execute(
                """SELECT result_json FROM applied_operations
                   WHERE proposal_id = ? AND revision_hash = ? AND domain = ?
                     AND operation_index = ?""",
                (proposal_id, expected_hash, domain, operation_index),
            ).fetchone()
            if existing:
                if existing["result_json"] != encoded:
                    raise IdempotencyConflict("operation already has a different result")
                return json.loads(existing["result_json"])
            connection.execute(
                """INSERT INTO applied_operations(
                       proposal_id, revision_hash, domain, operation_index,
                       result_json, created_at
                   ) VALUES (?, ?, ?, ?, ?, ?)""",
                (proposal_id, expected_hash, domain, operation_index, encoded, self._now()),
            )
        return result

    def _transition_terminal(
        self, proposal_id: str, expected_hash: str, target: ProposalState
    ) -> ProposalRevision:
        with self._transaction() as connection:
            current = self._require_current_hash(connection, proposal_id, expected_hash)
            if current.state is target:
                return current
            if current.state not in {ProposalState.DRAFT, ProposalState.APPROVED}:
                raise InvalidTransition(f"cannot move {current.state.value} to {target.value}")
            connection.execute(
                "UPDATE proposal_revisions SET state = ? WHERE proposal_id = ? AND revision_hash = ?",
                (target.value, proposal_id, expected_hash),
            )
            return self._fetch_revision(connection, proposal_id, expected_hash)

    def _require_current_hash(
        self, connection: sqlite3.Connection, proposal_id: str, expected_hash: str
    ) -> ProposalRevision:
        current = self._fetch_current(connection, proposal_id)
        if current.revision_hash != expected_hash:
            raise RevisionMismatch("approval or apply hash does not identify the current revision")
        return current

    def _fetch_current(self, connection: sqlite3.Connection, proposal_id: str) -> ProposalRevision:
        row = connection.execute(
            """SELECT r.* FROM proposals p JOIN proposal_revisions r
               ON r.proposal_id = p.proposal_id AND r.revision_hash = p.current_revision_hash
               WHERE p.proposal_id = ?""",
            (proposal_id,),
        ).fetchone()
        if row is None:
            raise UnknownProposal(proposal_id)
        return self._row_to_revision(row)

    def _fetch_revision(
        self, connection: sqlite3.Connection, proposal_id: str, digest: str
    ) -> ProposalRevision:
        row = connection.execute(
            "SELECT * FROM proposal_revisions WHERE proposal_id = ? AND revision_hash = ?",
            (proposal_id, digest),
        ).fetchone()
        if row is None:
            raise RevisionMismatch("revision does not belong to proposal")
        return self._row_to_revision(row)

    def _insert_revision(
        self,
        connection: sqlite3.Connection,
        proposal_id: str,
        number: int,
        digest: str,
        snapshots: Sequence[SourceSnapshot],
        things: Sequence[ThingsChange],
        calendar: Sequence[CalendarChange],
        created_at: str,
    ) -> None:
        connection.execute(
            """INSERT INTO proposal_revisions(
                proposal_id, revision_number, revision_hash, state,
                source_snapshots_json, things_changes_json, calendar_changes_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                proposal_id,
                number,
                digest,
                ProposalState.DRAFT.value,
                self._encode_snapshots(snapshots),
                self._encode_things(things),
                self._encode_calendar(calendar),
                created_at,
            ),
        )
