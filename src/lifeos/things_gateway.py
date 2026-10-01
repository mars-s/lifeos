"""A small, defensive adapter around the local Things 3 read API and URL scheme.

The read side is designed for an MCP proposal layer: every returned value is
structured data and each source record carries a stable snapshot hash.  The
write side is deliberately private to this adapter.  It launches one official
Things URL at a time, then re-reads the affected record before reporting an
outcome.  It has no delete or bulk-write operation.

This file adapts ideas from hald/things-mcp (MIT, pinned at 7e6e660).  In
particular, its URL parameter names and percent-encoding approach informed the
implementation.  Copyright (c) the hald/things-mcp contributors.  See their
MIT LICENSE at https://github.com/hald/things-mcp/blob/7e6e660/LICENSE.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import time as _time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Protocol
from urllib.parse import quote

_THINGS_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_LIST_METHODS = {
    "inbox": "inbox",
    "today": "today",
    "upcoming": "upcoming",
    "anytime": "anytime",
    "someday": "someday",
    "logbook": "logbook",
    "trash": "trash",
}
_WRITE_COMMANDS = {"update", "update-project"}
_UNSET = object()
_BUILTIN_SHOW_IDS = {
    "inbox",
    "today",
    "anytime",
    "upcoming",
    "someday",
    "logbook",
    "tomorrow",
    "deadlines",
    "repeating",
    "all-projects",
    "logged-projects",
}


class ThingsModule(Protocol):
    """The small part of ``things-py`` used by this adapter."""

    def get(self, item_id: str) -> Mapping[str, Any] | None: ...

    def token(self) -> str | None: ...


def _json_safe(value: Any) -> Any:
    """Convert a Things record to canonical JSON-safe primitives."""
    if isinstance(value, Mapping):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def source_hash(record: Mapping[str, Any]) -> str:
    """Return a deterministic SHA-256 source version for a Things record."""
    normalized = _json_safe(record)
    encoded = json.dumps(normalized, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _strict_id(value: str, field_name: str = "id") -> str:
    if not isinstance(value, str) or not _THINGS_ID_RE.fullmatch(value):
        raise ValueError(f"{field_name} must be an opaque Things ID")
    return value


def _text(value: str | None, field_name: str) -> str | None:
    if value is not None and not isinstance(value, str):
        raise TypeError(f"{field_name} must be text")
    return value


def _text_list(value: Iterable[str] | None, field_name: str) -> list[str] | None:
    if value is None:
        return None
    result = list(value)
    if not all(isinstance(item, str) for item in result):
        raise TypeError(f"{field_name} must contain only text")
    return result


def _encoded_query(params: Mapping[str, Any]) -> str:
    parts: list[str] = []
    for key, value in params.items():
        if value is None:
            continue
        if not isinstance(key, str) or not re.fullmatch(r"[a-z-]+", key):
            raise ValueError("invalid Things URL parameter name")
        if isinstance(value, bool):
            serialized = "true" if value else "false"
        elif isinstance(value, (list, tuple)):
            serialized = ",".join(str(item) for item in value)
        else:
            serialized = str(value)
        parts.append(f"{key}={quote(serialized, safe='')}")
    return "&".join(parts)


def things_deep_link(item_id: str) -> str:
    """Return a token-free Things link for a record or built-in list."""
    if not isinstance(item_id, str) or item_id not in _BUILTIN_SHOW_IDS:
        _strict_id(item_id, "item_id")
    return f"things:///show?id={quote(item_id, safe='')}"


@dataclass(frozen=True)
class ThingsCommand:
    """A command whose private wire URL never appears in a result or repr."""

    name: str
    safe_url: str
    _wire_url: str = field(repr=False, compare=False)


@dataclass(frozen=True)
class WriteResult:
    """An honest outcome for exactly one write attempt."""

    status: str
    command: str
    record: Mapping[str, Any] | None = None
    mismatches: Mapping[str, Mapping[str, Any]] = field(default_factory=dict)
    error: str | None = None
    checked_at: float | None = None

    @property
    def applied(self) -> bool:
        return self.status == "verified"


class ThingsGateway:
    """Local Things adapter with injected dependencies for deterministic tests."""

    def __init__(
        self,
        things: ThingsModule,
        *,
        run: Callable[..., Any] = subprocess.run,
        clock: Callable[[], float] = _time.time,
        sleeper: Callable[[float], None] = _time.sleep,
        verification_attempts: int = 15,
    ) -> None:
        if verification_attempts < 1:
            raise ValueError("verification_attempts must be positive")
        self._things = things
        self._run = run
        self._clock = clock
        self._sleep = sleeper
        self._verification_attempts = verification_attempts

    # Read operations.  Values in ``record`` are untrusted Things content;
    # callers must not interpret titles/notes as instructions.
    def read_list(
        self, list_name: str, *, limit: int | None = None, offset: int = 0
    ) -> dict[str, Any]:
        method_name = _LIST_METHODS.get(list_name)
        if method_name is None:
            raise ValueError(f"unsupported Things list: {list_name}")
        if limit is not None and (not isinstance(limit, int) or limit < 1):
            raise ValueError("limit must be a positive integer")
        if not isinstance(offset, int) or offset < 0:
            raise ValueError("offset must be a non-negative integer")
        method = getattr(self._things, method_name)
        try:
            records = method(include_items=True) or []
        except TypeError:
            records = method() or []
        return self._page(records, limit=limit, offset=offset)

    def read_todo(self, todo_id: str) -> dict[str, Any] | None:
        return self._read_typed(todo_id, expected_types={"to-do", "todo"})

    def read_project(self, project_id: str) -> dict[str, Any] | None:
        return self._read_typed(project_id, expected_types={"project"})

    def read_area(self, area_id: str) -> dict[str, Any] | None:
        return self._read_typed(area_id, expected_types={"area"})

    def read_projects(self, *, limit: int | None = None, offset: int = 0) -> dict[str, Any]:
        return self._collection("projects", limit=limit, offset=offset)

    def read_areas(self, *, limit: int | None = None, offset: int = 0) -> dict[str, Any]:
        return self._collection("areas", limit=limit, offset=offset)

    def read_tags(self, *, limit: int | None = None, offset: int = 0) -> dict[str, Any]:
        return self._collection("tags", limit=limit, offset=offset)

    def deep_link(self, item_id: str) -> str:
        return things_deep_link(item_id)

    def read_todos(
        self, *, project_id: str | None = None, limit: int | None = None, offset: int = 0
    ) -> dict[str, Any]:
        if project_id is not None:
            _strict_id(project_id, "project_id")
        method = self._things.todos
        kwargs: dict[str, Any] = {"include_items": True}
        if project_id is not None:
            kwargs["project"] = project_id
        try:
            records = method(**kwargs) or []
        except TypeError:
            records = method() or []
        return self._page(records, limit=limit, offset=offset)

    def search_todos(
        self, query: str, *, limit: int | None = None, offset: int = 0
    ) -> dict[str, Any]:
        _text(query, "query")
        method = self._things.search
        try:
            records = method(query, include_items=True) or []
        except TypeError:
            records = method(query) or []
        return self._page(records, limit=limit, offset=offset)

    def _collection(self, method_name: str, *, limit: int | None, offset: int) -> dict[str, Any]:
        method = getattr(self._things, method_name)
        return self._page(method() or [], limit=limit, offset=offset)

    def _page(
        self, records: Iterable[Mapping[str, Any]], *, limit: int | None, offset: int
    ) -> dict[str, Any]:
        if limit is not None and (not isinstance(limit, int) or limit < 1):
            raise ValueError("limit must be a positive integer")
        if not isinstance(offset, int) or offset < 0:
            raise ValueError("offset must be a non-negative integer")
        normalized = [self._structured_record(record) for record in records]
        page = normalized[offset:] if limit is None else normalized[offset : offset + limit]
        return {
            "items": page,
            "count": len(page),
            "total": len(normalized),
            "offset": offset,
            "limit": limit,
        }

    def _read_typed(self, item_id: str, *, expected_types: set[str]) -> dict[str, Any] | None:
        _strict_id(item_id)
        record = self._things.get(item_id)
        if record is None:
            return None
        item_type = str(record.get("type", "")).lower()
        if item_type and item_type not in expected_types:
            raise ValueError("Things record has an unexpected type")
        return self._structured_record(record)

    @staticmethod
    def _structured_record(record: Mapping[str, Any]) -> dict[str, Any]:
        raw = _json_safe(record)
        return {"record": raw, "source_hash": source_hash(raw), "content_is_untrusted": True}

    # URL building is intentionally separated from launch so it is auditable.
    # ``safe_url`` is suitable for a proposal/diff and cannot contain a token.
    def build_create_todo_command(
        self,
        *,
        title: str,
        notes: str | None = None,
        when: str | None = None,
        deadline: str | None = None,
        tags: Iterable[str] | None = None,
        list_id: str | None = None,
        list_title: str | None = None,
        project_id: str | None = None,
        project_title: str | None = None,
        area_id: str | None = None,
        area_title: str | None = None,
        checklist: Iterable[str] | None = None,
        completed: bool | None = None,
        canceled: bool | None = None,
    ) -> ThingsCommand:
        if canceled:
            raise ValueError("Things URL scheme cannot cancel a newly created to-do")
        params = self._todo_params(
            title=title,
            notes=notes,
            when=when,
            deadline=deadline,
            tags=tags,
            list_id=list_id,
            list_title=list_title,
            project_id=project_id,
            project_title=project_title,
            area_id=area_id,
            area_title=area_title,
            checklist=checklist,
            completed=completed,
            canceled=None,
        )
        return self._command("add", params)

    def build_update_todo_command(self, todo_id: str, **changes: Any) -> ThingsCommand:
        _strict_id(todo_id, "todo_id")
        params = {"id": todo_id}
        params.update(self._todo_params(**changes))
        if len(params) == 1:
            raise ValueError("at least one to-do change is required")
        return self._command("update", params, include_token=True)

    def build_update_project_command(self, project_id: str, **changes: Any) -> ThingsCommand:
        _strict_id(project_id, "project_id")
        allowed = {
            "title",
            "notes",
            "when",
            "deadline",
            "tags",
            "add_tags",
            "area_id",
            "area",
            "area_title",
            "completed",
            "canceled",
        }
        unknown = set(changes) - allowed
        if unknown:
            raise ValueError(f"unsupported project change: {sorted(unknown)[0]}")
        params: dict[str, Any] = {"id": project_id}
        params.update(self._project_params(**changes))
        if len(params) == 1:
            raise ValueError("at least one project change is required")
        return self._command("update-project", params, include_token=True)

    def build_show_command(self, item_id: str) -> ThingsCommand:
        """Build a token-free command for opening a Things record or list."""
        if isinstance(item_id, str) and item_id in _BUILTIN_SHOW_IDS:
            return self._command("show", {"id": item_id})
        return self._command("show", {"id": _strict_id(item_id, "item_id")})

    def _todo_params(
        self,
        *,
        title: str | None = None,
        notes: str | None = None,
        when: str | None = None,
        deadline: str | None = None,
        tags: Iterable[str] | None = None,
        add_tags: Iterable[str] | None = None,
        list_id: str | None = None,
        list_title: str | None = None,
        project_id: str | None = None,
        project_title: str | None = None,
        area_id: str | None = None,
        area_title: str | None = None,
        checklist: Iterable[str] | None = None,
        completed: bool | None = None,
        canceled: bool | None = None,
    ) -> dict[str, Any]:
        destination_ids = {
            "list_id": list_id,
            "project_id": project_id,
            "area_id": area_id,
        }
        provided_ids = [
            (name, value) for name, value in destination_ids.items() if value is not None
        ]
        if len(provided_ids) > 1:
            raise ValueError("provide only one of list_id, project_id, or area_id")
        for name, value in provided_ids:
            _strict_id(value, name)
        destination_titles = {
            "list_title": list_title,
            "project_title": project_title,
            "area_title": area_title,
        }
        provided_titles = [
            (name, value) for name, value in destination_titles.items() if value is not None
        ]
        if len(provided_titles) > 1:
            raise ValueError("provide only one of list_title, project_title, or area_title")
        if provided_ids and provided_titles:
            raise ValueError("provide a destination ID or title, not both")
        for name, value in (
            ("title", title),
            ("notes", notes),
            ("when", when),
            ("deadline", deadline),
            ("list_title", list_title),
            ("project_title", project_title),
            ("area_title", area_title),
        ):
            _text(value, name)
        tag_values = _text_list(tags, "tags")
        add_tag_values = _text_list(add_tags, "add_tags")
        checklist_values = _text_list(checklist, "checklist")
        for name, value in (("completed", completed), ("canceled", canceled)):
            if value is not None and not isinstance(value, bool):
                raise TypeError(f"{name} must be boolean")
        destination_id = provided_ids[0][1] if provided_ids else None
        destination_title = provided_titles[0][1] if provided_titles else None
        params = {
            "title": title,
            "notes": notes,
            "when": when,
            "deadline": deadline,
            "tags": tag_values,
            "add-tags": add_tag_values,
            "list-id": destination_id,
            "list": destination_title,
            "checklist-items": "\n".join(checklist_values)
            if checklist_values is not None
            else None,
            "completed": completed,
            "canceled": canceled,
        }
        return {key: value for key, value in params.items() if value is not None}

    @staticmethod
    def _project_params(
        *,
        title: str | None = None,
        notes: str | None = None,
        when: str | None = None,
        deadline: str | None = None,
        tags: Iterable[str] | None = None,
        add_tags: Iterable[str] | None = None,
        area_id: str | None = None,
        area: str | None = None,
        area_title: str | None = None,
        completed: bool | None = None,
        canceled: bool | None = None,
    ) -> dict[str, Any]:
        if area is not None and area_title is not None:
            raise ValueError("provide area or area_title, not both")
        if area_id is not None:
            _strict_id(area_id, "area_id")
        for name, value in (
            ("title", title),
            ("notes", notes),
            ("when", when),
            ("deadline", deadline),
        ):
            _text(value, name)
        tag_values = _text_list(tags, "tags")
        add_tag_values = _text_list(add_tags, "add_tags")
        for name, value in (("completed", completed), ("canceled", canceled)):
            if value is not None and not isinstance(value, bool):
                raise TypeError(f"{name} must be boolean")
        params = {
            "title": title,
            "notes": notes,
            "when": when,
            "deadline": deadline,
            "tags": tag_values,
            "add-tags": add_tag_values,
            "area-id": area_id,
            "area": area if area is not None else area_title,
            "completed": completed,
            "canceled": canceled,
        }
        return {key: value for key, value in params.items() if value is not None}

    def _command(
        self, name: str, params: Mapping[str, Any], *, include_token: bool = False
    ) -> ThingsCommand:
        safe_url = f"things:///{name}"
        query = _encoded_query(params)
        if query:
            safe_url = f"{safe_url}?{query}"
        wire_url = safe_url
        if include_token:
            token = self._things.token()
            if not isinstance(token, str) or not token:
                raise RuntimeError("Things authorization token is unavailable")
            wire_url = f"{wire_url}{'&' if query else '?'}auth-token={quote(token, safe='')}"
        return ThingsCommand(name=name, safe_url=safe_url, _wire_url=wire_url)

    # One-item mutations.  These do not surface the raw command URL or token.
    def create_todo(self, **changes: Any) -> WriteResult:
        command = self.build_create_todo_command(**changes)
        launched = self._launch(command)
        if launched is not None:
            return launched
        expected = self._todo_params(**changes)
        # URL add does not return a UUID.  Find exactly one exact-title result,
        # then verify all requested fields.  Ambiguity is a mismatch, not success.
        return self._verify_created_todo(command.name, expected)

    def update_todo(self, todo_id: str, **changes: Any) -> WriteResult:
        command = self.build_update_todo_command(todo_id, **changes)
        launched = self._launch(command)
        if launched is not None:
            return launched
        return self._verify_existing(command.name, todo_id, self._todo_params(**changes))

    def update_project(self, project_id: str, **changes: Any) -> WriteResult:
        command = self.build_update_project_command(project_id, **changes)
        launched = self._launch(command)
        if launched is not None:
            return launched
        return self._verify_existing(command.name, project_id, self._project_params(**changes))

    def _launch(self, command: ThingsCommand) -> WriteResult | None:
        try:
            self._run(
                [
                    "/usr/bin/open",
                    "-g",
                    "-b",
                    "com.culturedcode.ThingsMac",
                    command._wire_url,
                ],
                check=True,
                capture_output=True,
                text=True,
            )
        except Exception:
            # Do not stringify an exception: subprocess failures can include the URL/token.
            return WriteResult(
                status="launch_failed",
                command=command.name,
                error="Things command could not be launched",
                checked_at=self._clock(),
            )
        return None

    def _verify_created_todo(self, command: str, expected: Mapping[str, Any]) -> WriteResult:
        title = expected.get("title")
        if not isinstance(title, str):
            return WriteResult(
                status="mismatch",
                command=command,
                error="created to-do requires a title",
                checked_at=self._clock(),
            )
        candidates: list[Mapping[str, Any]] = []
        for attempt in range(self._verification_attempts):
            try:
                found = self._things.search(title, include_items=True) or []
            except TypeError:
                found = self._things.search(title) or []
            candidates = [item for item in found if item.get("title") == title]
            if len(candidates) == 1:
                return self._verified_or_mismatch(command, candidates[0], expected)
            if attempt + 1 < self._verification_attempts:
                self._sleep(0.2)
        return WriteResult(
            status="mismatch",
            command=command,
            error="created to-do could not be identified unambiguously for verification",
            checked_at=self._clock(),
        )

    def _verify_existing(
        self, command: str, item_id: str, expected: Mapping[str, Any]
    ) -> WriteResult:
        _strict_id(item_id)
        for attempt in range(self._verification_attempts):
            record = self._things.get(item_id)
            if record is not None:
                result = self._verified_or_mismatch(command, record, expected)
                if result.applied or attempt + 1 == self._verification_attempts:
                    return result
            if attempt + 1 < self._verification_attempts:
                self._sleep(0.2)
        return WriteResult(
            status="mismatch",
            command=command,
            error="record was not found after write",
            checked_at=self._clock(),
        )

    def _verified_or_mismatch(
        self, command: str, record: Mapping[str, Any], expected: Mapping[str, Any]
    ) -> WriteResult:
        mismatches = self._mismatches(record, expected)
        structured = self._structured_record(record)
        if mismatches:
            return WriteResult(
                status="mismatch",
                command=command,
                record=structured,
                mismatches=mismatches,
                checked_at=self._clock(),
            )
        return WriteResult(
            status="verified", command=command, record=structured, checked_at=self._clock()
        )

    @staticmethod
    def _mismatches(
        record: Mapping[str, Any], expected: Mapping[str, Any]
    ) -> dict[str, dict[str, Any]]:
        mismatches: dict[str, dict[str, Any]] = {}
        aliases = {
            "list-id": ("project", "area", "list_id"),
            "list": ("project_title", "area_title", "list"),
            "area-id": ("area", "area_id", "area_uuid", "area-id"),
            "area": ("area_title", "area_name", "area"),
        }
        for field_name, wanted in expected.items():
            if field_name == "checklist-items":
                actual = [
                    item.get("title", item) if isinstance(item, Mapping) else item
                    for item in record.get("items", record.get("checklist", []))
                ]
                wanted = str(wanted).split("\n")
            elif field_name == "completed":
                actual = str(record.get("status", "")).lower() == "completed" or bool(
                    record.get("completed")
                )
            elif field_name == "canceled":
                actual = str(record.get("status", "")).lower() in {"canceled", "cancelled"} or bool(
                    record.get("canceled")
                )
            elif field_name == "when":
                normalized = str(wanted).lower()
                if normalized == "today":
                    actual = _json_safe(record.get("start_date"))
                    wanted = date.today().isoformat()
                elif normalized == "tomorrow":
                    actual = _json_safe(record.get("start_date"))
                    wanted = (date.today() + timedelta(days=1)).isoformat()
                elif normalized in {"anytime", "someday"}:
                    actual = str(record.get("start", "")).lower()
                    wanted = normalized
                else:
                    actual = _json_safe(record.get("start_date"))
            elif field_name == "tags":
                actual = record.get("tags", [])
                actual = [
                    item.get("title", item) if isinstance(item, Mapping) else item
                    for item in actual
                ]
            elif field_name == "add-tags":
                actual = record.get("tags", [])
                actual = [
                    item.get("title", item) if isinstance(item, Mapping) else item
                    for item in actual
                ]
                wanted_tags = [
                    item.get("title", item) if isinstance(item, Mapping) else item
                    for item in wanted
                ]
                if all(tag in actual for tag in wanted_tags):
                    continue
                wanted = wanted_tags
            elif field_name in aliases:
                actual = next(
                    (
                        record.get(alias)
                        for alias in aliases[field_name]
                        if record.get(alias) is not None
                    ),
                    None,
                )
                if isinstance(actual, Mapping):
                    actual = actual.get("uuid") or actual.get("id") or actual.get("title")
            else:
                actual = record.get(field_name)
            if wanted == "" and actual is None:
                continue
            if _json_safe(actual) != _json_safe(wanted):
                mismatches[field_name] = {
                    "expected": _json_safe(wanted),
                    "actual": _json_safe(actual),
                }
        return mismatches
