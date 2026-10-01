"""A testable, shell-free adapter for the local EventKit helper.

The adapter deliberately does not expose a generic "run any EventKit request" method.
Callers use narrowly named methods, receive validated dictionaries, and can attach the
returned source hash to a schedule proposal for stale-preview detection.
"""

from __future__ import annotations

import json
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any, Protocol


class CalendarGatewayError(RuntimeError):
    """The native helper rejected a request or returned an invalid protocol message."""


class CalendarRunner(Protocol):
    def __call__(self, args: Sequence[str], input_data: bytes) -> bytes:
        """Run the helper without a shell and return stdout bytes."""


def subprocess_runner(args: Sequence[str], input_data: bytes) -> bytes:
    """Run an absolute helper path without shell interpolation."""
    completed = subprocess.run(
        list(args),
        input=input_data,
        capture_output=True,
        check=False,
        shell=False,
    )
    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        raise CalendarGatewayError(f"Calendar helper exited {completed.returncode}: {stderr}")
    return completed.stdout


def canonical_source_hash(value: Mapping[str, Any] | Sequence[Mapping[str, Any]]) -> str:
    """Hash a canonical projection of EventKit data for proposal freshness checks."""
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(encoded.encode("utf-8")).hexdigest()


def _require_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise CalendarGatewayError(f"Invalid helper response: {field} must be a non-empty string")
    return value


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        raise CalendarGatewayError(f"Invalid helper response: {field} must be a string")
    return value


def _require_bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise CalendarGatewayError(f"Invalid helper response: {field} must be a boolean")
    return value


def _validate_calendar(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CalendarGatewayError("Invalid helper response: calendar must be an object")
    for field in ("id", "title", "source_id", "source_title"):
        _require_string(value.get(field), f"calendar.{field}")
    _require_bool(value.get("allows_modifications"), "calendar.allows_modifications")
    _require_bool(value.get("read_only"), "calendar.read_only")
    if value["read_only"] == value["allows_modifications"]:
        raise CalendarGatewayError("Invalid helper response: calendar read-only flags disagree")
    return dict(value)


def _validate_event(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CalendarGatewayError("Invalid helper response: event must be an object")
    for field in (
        "calendar_item_identifier",
        "calendar_id",
        "calendar_source_id",
        "start",
        "end",
    ):
        _require_string(value.get(field), f"event.{field}")
    for field in ("event_identifier", "title", "notes", "location", "url"):
        _require_text(value.get(field), f"event.{field}")
    _require_bool(value.get("all_day"), "event.all_day")
    _require_bool(value.get("planner_owned"), "event.planner_owned")
    return dict(value)


@dataclass(frozen=True)
class CalendarSnapshot:
    calendars: tuple[dict[str, Any], ...]
    source_hash: str


@dataclass(frozen=True)
class EventSnapshot:
    events: tuple[dict[str, Any], ...]
    source_hash: str


class CalendarGateway:
    """Typed commands over the one-request EventKit process protocol."""

    def __init__(self, helper_path: str | Path, runner: CalendarRunner = subprocess_runner) -> None:
        path = Path(helper_path)
        if not path.is_absolute():
            raise ValueError("helper_path must be absolute")
        self._helper_path = str(path)
        self._runner = runner

    def _call(self, request: Mapping[str, Any]) -> dict[str, Any]:
        payload = json.dumps(dict(request), separators=(",", ":"), ensure_ascii=False).encode(
            "utf-8"
        )
        stdout = self._runner([self._helper_path], payload)
        try:
            decoded = json.loads(stdout.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise CalendarGatewayError("Calendar helper returned invalid JSON") from error
        if not isinstance(decoded, dict) or not isinstance(decoded.get("ok"), bool):
            raise CalendarGatewayError("Calendar helper returned an invalid response envelope")
        if not decoded["ok"]:
            error = decoded.get("error")
            if not isinstance(error, dict):
                raise CalendarGatewayError("Calendar helper returned an invalid error envelope")
            code = _require_string(error.get("code"), "error.code")
            message = _require_string(error.get("message"), "error.message")
            raise CalendarGatewayError(f"{code}: {message}")
        result = decoded.get("result")
        if not isinstance(result, dict):
            raise CalendarGatewayError("Calendar helper returned a non-object result")
        return result

    def authorization_status(self) -> str:
        return _require_string(
            self._call({"operation": "authorization_status"}).get("status"), "status"
        )

    def request_authorization(self) -> dict[str, Any]:
        result = self._call({"operation": "request_authorization"})
        _require_bool(result.get("granted"), "granted")
        _require_string(result.get("status"), "status")
        return result

    def list_calendars(self) -> CalendarSnapshot:
        result = self._call({"operation": "list_calendars"})
        raw_calendars = result.get("calendars")
        if not isinstance(raw_calendars, list):
            raise CalendarGatewayError("Invalid helper response: calendars must be a list")
        calendars = tuple(_validate_calendar(item) for item in raw_calendars)
        return CalendarSnapshot(calendars=calendars, source_hash=canonical_source_hash(calendars))

    def create_planner_calendar(
        self, title: str = "Planned Tasks", source_id: str | None = None
    ) -> dict[str, Any]:
        request: dict[str, Any] = {"operation": "create_planner_calendar", "title": title}
        if source_id is not None:
            request["source_id"] = source_id
        return _validate_calendar(self._call(request).get("calendar"))

    def list_event_occurrences(
        self, start: str, end: str, calendar_ids: Sequence[str] | None = None
    ) -> EventSnapshot:
        request: dict[str, Any] = {
            "operation": "list_event_occurrences",
            "start": start,
            "end": end,
        }
        if calendar_ids is not None:
            request["calendar_ids"] = list(calendar_ids)
        result = self._call(request)
        raw_events = result.get("events")
        if not isinstance(raw_events, list):
            raise CalendarGatewayError("Invalid helper response: events must be a list")
        events = tuple(_validate_event(item) for item in raw_events)
        return EventSnapshot(events=events, source_hash=canonical_source_hash(events))

    def create_linked_work_block(
        self,
        *,
        calendar_id: str,
        link_id: str,
        things_id: str,
        title: str,
        start: str,
        end: str,
        notes: str | None = None,
        location: str | None = None,
    ) -> dict[str, Any]:
        request: dict[str, Any] = {
            "operation": "create_linked_work_block",
            "calendar_id": calendar_id,
            "link_id": link_id,
            "things_id": things_id,
            "title": title,
            "start": start,
            "end": end,
        }
        if notes is not None:
            request["notes"] = notes
        if location is not None:
            request["location"] = location
        return _validate_event(self._call(request).get("event"))

    def create_calendar_event(
        self,
        *,
        calendar_id: str,
        link_id: str,
        title: str,
        start: str,
        end: str,
        notes: str | None = None,
        location: str | None = None,
    ) -> dict[str, Any]:
        """Create an idempotent LifeOS-owned event that is not a Things work block."""
        request: dict[str, Any] = {
            "operation": "create_calendar_event",
            "calendar_id": calendar_id,
            "link_id": link_id,
            "title": title,
            "start": start,
            "end": end,
        }
        if notes is not None:
            request["notes"] = notes
        if location is not None:
            request["location"] = location
        return _validate_event(self._call(request).get("event"))

    def update_linked_work_block(
        self,
        *,
        event_identifier: str,
        link_id: str,
        things_id: str,
        title: str | None = None,
        start: str | None = None,
        end: str | None = None,
        notes: str | None = None,
        location: str | None = None,
    ) -> dict[str, Any]:
        request: dict[str, Any] = {
            "operation": "update_linked_work_block",
            "event_identifier": event_identifier,
            "link_id": link_id,
            "things_id": things_id,
        }
        for field, value in (
            ("title", title),
            ("start", start),
            ("end", end),
            ("notes", notes),
            ("location", location),
        ):
            if value is not None:
                request[field] = value
        return _validate_event(self._call(request).get("event"))

    def delete_linked_work_block(self, *, event_identifier: str) -> str:
        result = self._call(
            {"operation": "delete_linked_work_block", "event_identifier": event_identifier}
        )
        return _require_string(result.get("deleted_event_identifier"), "deleted_event_identifier")
