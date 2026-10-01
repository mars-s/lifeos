"""Typed, serializable records for the reviewed-change boundary.

The records deliberately store source content as data only.  Adapters and MCP
layers must present task and event text as untrusted content, never commands.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from hashlib import sha256
from typing import Any

JsonValue = str | int | float | bool | None | list["JsonValue"] | dict[str, "JsonValue"]


class ChangeOperation(StrEnum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    COMPLETE = "complete"
    CANCEL = "cancel"


class ProposalState(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    APPLYING = "applying"
    APPLIED = "applied"
    PARTIAL_FAILURE = "partial_failure"
    STALE = "stale"
    REJECTED = "rejected"
    REVERTED = "reverted"


@dataclass(frozen=True, slots=True)
class SourceSnapshot:
    """The exact external record version on which a proposal was based."""

    system: str
    record_id: str
    version: str | None
    data: Mapping[str, JsonValue]

    def __post_init__(self) -> None:
        if not self.system or not self.record_id:
            raise ValueError("source snapshots need a system and record_id")

    @property
    def key(self) -> tuple[str, str]:
        return (self.system, self.record_id)

    def to_dict(self) -> dict[str, Any]:
        return {
            "system": self.system,
            "record_id": self.record_id,
            "version": self.version,
            "data": dict(self.data),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> SourceSnapshot:
        return cls(
            system=str(value["system"]),
            record_id=str(value["record_id"]),
            version=value.get("version"),
            data=dict(value.get("data", {})),
        )


@dataclass(frozen=True, slots=True)
class ThingsChange:
    operation: ChangeOperation
    task_id: str | None
    fields: Mapping[str, JsonValue]
    destructive: bool = False

    def __post_init__(self) -> None:
        if self.operation is ChangeOperation.CREATE and self.task_id is not None:
            raise ValueError("a Things create must not claim an existing task_id")
        if self.operation is not ChangeOperation.CREATE and not self.task_id:
            raise ValueError("a Things change needs task_id unless it creates")

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation.value,
            "task_id": self.task_id,
            "fields": dict(self.fields),
            "destructive": self.destructive,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ThingsChange:
        return cls(
            operation=ChangeOperation(value["operation"]),
            task_id=value.get("task_id"),
            fields=dict(value.get("fields", {})),
            destructive=bool(value.get("destructive", False)),
        )


@dataclass(frozen=True, slots=True)
class CalendarChange:
    operation: ChangeOperation
    calendar_id: str
    event_id: str | None
    fields: Mapping[str, JsonValue]
    destructive: bool = False

    def __post_init__(self) -> None:
        if not self.calendar_id:
            raise ValueError("a Calendar change needs calendar_id")
        if self.operation is ChangeOperation.CREATE and self.event_id is not None:
            raise ValueError("a Calendar create must not claim an existing event_id")
        if self.operation is not ChangeOperation.CREATE and not self.event_id:
            raise ValueError("a Calendar change needs event_id unless it creates")

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation.value,
            "calendar_id": self.calendar_id,
            "event_id": self.event_id,
            "fields": dict(self.fields),
            "destructive": self.destructive,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> CalendarChange:
        return cls(
            operation=ChangeOperation(value["operation"]),
            calendar_id=str(value["calendar_id"]),
            event_id=value.get("event_id"),
            fields=dict(value.get("fields", {})),
            destructive=bool(value.get("destructive", False)),
        )


def canonical_json(value: Any) -> str:
    """Return one stable JSON representation or reject non-JSON proposal data."""

    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    )


def revision_hash(
    proposal_id: str,
    revision_number: int,
    source_snapshots: Sequence[SourceSnapshot],
    things_changes: Sequence[ThingsChange],
    calendar_changes: Sequence[CalendarChange],
) -> str:
    """Hash semantic content only; timestamps and state never change a revision hash."""

    payload = {
        "proposal_id": proposal_id,
        "revision_number": revision_number,
        "source_snapshots": sorted(
            (item.to_dict() for item in source_snapshots),
            key=lambda item: (item["system"], item["record_id"]),
        ),
        "things_changes": [item.to_dict() for item in things_changes],
        "calendar_changes": [item.to_dict() for item in calendar_changes],
    }
    return sha256(canonical_json(payload).encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class ProposalRevision:
    proposal_id: str
    revision_number: int
    revision_hash: str
    state: ProposalState
    source_snapshots: tuple[SourceSnapshot, ...]
    things_changes: tuple[ThingsChange, ...]
    calendar_changes: tuple[CalendarChange, ...]
    created_at: str
    approved_revision_hash: str | None = None
    failure_detail: str | None = None

    def __post_init__(self) -> None:
        if not self.proposal_id or self.revision_number < 1:
            raise ValueError("proposal_id and a positive revision_number are required")
        if not self.revision_hash:
            raise ValueError("revision_hash is required")
        keys = [snapshot.key for snapshot in self.source_snapshots]
        if len(keys) != len(set(keys)):
            raise ValueError("a proposal may contain only one snapshot per source record")

    @property
    def is_terminal(self) -> bool:
        return self.state in {
            ProposalState.APPLIED,
            ProposalState.PARTIAL_FAILURE,
            ProposalState.STALE,
            ProposalState.REJECTED,
            ProposalState.REVERTED,
        }
