"""The only door from LifeOS into Anytype: its Local API (Anytype-Version 2025-11-08).

The same API is served by Anytype Desktop (http://127.0.0.1:31009) and by the headless
`anytype-cli` (http://127.0.0.1:31012), so the base URL, the API key source and the space are
configuration. The key comes from LIFEOS_ANYTYPE_API_KEY, a file named by
LIFEOS_ANYTYPE_API_KEY_FILE, or the macOS Keychain. It is never logged, returned or put in an
error message.

Only allowlisted routes run, all inside the one configured space. Every DELETE, space create or
update, and member route is on the Never list: they are not in the allowlist and fail before any
request. Anytype not running means NotesUnavailable; nothing is queued here.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterator, Mapping, Sequence
from dataclasses import asdict, dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

from .models import canonical_json

API_VERSION = "2025-11-08"
DESKTOP_URL = "http://127.0.0.1:31009"
KEYCHAIN_SERVICE = "lifeos-anytype"
KEYCHAIN_ACCOUNT = "api-key"
CHAT_NAME = "LifeOS"

# (method, route) pairs LifeOS may call. Routes are relative to /v1/spaces/<the space>/,
# except "spaces" (the setup picker). `*` is one path segment.
READ_ROUTES = frozenset({
    ("GET", "spaces"), ("POST", "search"), ("GET", "objects/*"), ("GET", "types"),
    ("GET", "properties"), ("GET", "properties/*/tags"), ("GET", "chats"),
    ("GET", "chats/*/messages"), ("GET", "chats/*/messages/stream"),
})
WRITE_ROUTES = frozenset({
    ("POST", "objects"), ("PATCH", "objects/*"), ("POST", "types"), ("POST", "properties"),
    ("POST", "properties/*/tags"), ("POST", "lists/*/objects"), ("POST", "chats"),
    ("POST", "chats/*/messages"), ("POST", "chats/*/messages/*/reactions"),
})
ALLOWED_ROUTES = READ_ROUTES | WRITE_ROUTES
# Never: listed so a test can prove none of them is reachable, not to filter at run time.
NEVER_ROUTES = frozenset({
    ("DELETE", "objects/*"), ("DELETE", "types/*"), ("DELETE", "properties/*"),
    ("DELETE", "properties/*/tags/*"), ("DELETE", "lists/*/objects/*"), ("DELETE", "files/*"),
    ("DELETE", "chats/*/messages/*"), ("PATCH", "chats/*/messages/*"), ("PATCH", "space"),
    ("POST", "create-space"), ("GET", "members"), ("PATCH", "types/*"), ("PATCH", "properties/*"),
})
assert not ALLOWED_ROUTES & NEVER_ROUTES
assert not any(method == "DELETE" for method, _ in ALLOWED_ROUTES)

# The LifeOS schema in the target space. Keys are snake_case and prefixed, so they never
# collide with the person's own properties. "made_by" is the attribution on every write.
PROPERTIES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "made_by": ("Made by", "text", ()),
    "lifeos_request_id": ("Request ID", "text", ()),
    "lifeos_capture_id": ("Capture ID", "text", ()),
    "lifeos_source_hash": ("Source hash", "text", ()),
    "lifeos_revision_hash": ("Revision hash", "text", ()),
    "lifeos_evidence": ("Evidence", "text", ()),
    "lifeos_things_id": ("Things ID", "text", ()),
    "lifeos_things_link": ("Things link", "url", ()),
    "lifeos_proposal_id": ("Proposal ID", "text", ()),
    "lifeos_source": ("Source", "objects", ()),
    "lifeos_date": ("Date", "date", ()),
    "lifeos_status": ("Status", "select", ("New", "Interpreted", "Suggested", "In Things", "Dismissed")),
    "lifeos_state": ("State", "select", ("Draft", "Approved", "Applied", "Rejected", "Stale", "Failed")),
}
_COMMON = ("made_by", "lifeos_request_id")
TYPES: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "lifeos_capture": ("Capture", "Captures", (*_COMMON, "lifeos_capture_id", "lifeos_source_hash", "lifeos_status")),
    "lifeos_interpretation": ("Interpretation", "Interpretations", (
        *_COMMON, "lifeos_capture_id", "lifeos_source_hash", "lifeos_revision_hash", "lifeos_source")),
    "lifeos_suggested_action": ("Suggested action", "Suggested actions", (
        *_COMMON, "lifeos_evidence", "lifeos_status", "lifeos_things_id", "lifeos_things_link",
        "lifeos_source")),
    "lifeos_meeting": ("Meeting", "Meetings", (
        *_COMMON, "lifeos_capture_id", "lifeos_revision_hash", "lifeos_date", "lifeos_source")),
    "lifeos_proposal": ("Proposal", "Proposals", (
        *_COMMON, "lifeos_proposal_id", "lifeos_revision_hash", "lifeos_state")),
    "lifeos_journal_day": ("Journal day", "Journal days", (*_COMMON, "lifeos_date")),
}
TAG_PROPERTY = "tag"
ASK_AGENT_TAG = ("ask_agent", "Ask agent", "purple")
# Anytype changes these by itself (opening, backlinking), so they never make a note stale.
VOLATILE = frozenset({"last_modified_date", "last_modified_by", "last_opened_date", "backlinks"})
_VALUE_KEYS = ("text", "number", "select", "multi_select", "date", "files", "checkbox", "url",
               "email", "phone", "objects")


class NotesUnavailable(RuntimeError):
    """Anytype is not running, not reachable, not configured, or refused the API key."""


class NotesError(RuntimeError):
    """Anytype answered but the request failed (not found, invalid, rate limited)."""


class NotesNotPermitted(PermissionError):
    """This caller's grant does not include notes:write, so LifeOS writes nothing to Anytype."""


# Configuration. Nothing here is macOS-only except the optional Keychain key source.

@dataclass(frozen=True)
class AnytypeSettings:
    base_url: str = DESKTOP_URL
    space_id: str = ""
    chat_id: str | None = None


def settings_path(database_path: Path, environ: Mapping[str, str] = os.environ) -> Path:
    return Path(environ.get("LIFEOS_ANYTYPE_CONFIG") or database_path.parent / "anytype.json")


def load_settings(path: Path, environ: Mapping[str, str] = os.environ) -> AnytypeSettings | None:
    """The saved settings with environment overrides; None until a space is chosen."""
    try:
        saved = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        saved = {}
    settings = AnytypeSettings(
        base_url=environ.get("LIFEOS_ANYTYPE_URL") or saved.get("base_url") or DESKTOP_URL,
        space_id=environ.get("LIFEOS_ANYTYPE_SPACE_ID") or saved.get("space_id") or "",
        chat_id=environ.get("LIFEOS_ANYTYPE_CHAT_ID") or saved.get("chat_id"),
    )
    return settings if settings.space_id else None


def save_settings(path: Path, settings: AnytypeSettings) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(settings), indent=2) + "\n", encoding="utf-8")


def _keychain_allowed(environ: Mapping[str, str]) -> bool:
    return sys.platform == "darwin" and environ.get("LIFEOS_ANYTYPE_NO_KEYCHAIN") != "1"


def read_api_key(environ: Mapping[str, str] = os.environ) -> str | None:
    if environ.get("LIFEOS_ANYTYPE_API_KEY"):
        return environ["LIFEOS_ANYTYPE_API_KEY"].strip()
    if environ.get("LIFEOS_ANYTYPE_API_KEY_FILE"):
        try:
            return Path(environ["LIFEOS_ANYTYPE_API_KEY_FILE"]).expanduser().read_text().strip() or None
        except OSError:
            return None
    if not _keychain_allowed(environ):
        return None
    found = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_ACCOUNT, "-w"],
        capture_output=True, text=True, check=False,
    )
    return found.stdout.strip() or None if found.returncode == 0 else None


def store_api_key(key: str, environ: Mapping[str, str] = os.environ) -> str:
    """Save the key and say where. Keychain on a Mac, else a 0600 file."""
    key = key.strip()
    if not key or any(ch.isspace() for ch in key):
        raise ValueError("that does not look like an Anytype API key")
    if environ.get("LIFEOS_ANYTYPE_API_KEY_FILE") or not _keychain_allowed(environ):
        path = Path(environ.get("LIFEOS_ANYTYPE_API_KEY_FILE") or "~/.config/lifeos/anytype-api-key").expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            handle.write(key + "\n")
        return str(path)
    # `security -i` reads the command from stdin, so the key never shows up in `ps`.
    command = f'add-generic-password -U -s {KEYCHAIN_SERVICE} -a {KEYCHAIN_ACCOUNT} -w "{key}"\n'
    if not re.fullmatch(r"[A-Za-z0-9+/=_.:-]+", key):
        raise ValueError("that does not look like an Anytype API key")
    done = subprocess.run(["security", "-i"], input=command, capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise RuntimeError("the Keychain did not save the key")
    return "macOS Keychain (lifeos-anytype)"


def pair_api_key(base_url: str, app_name: str, code_for: Callable[[], str], timeout: float = 15.0) -> str:
    """The documented pairing flow: Anytype shows a 4-digit code, the person types it."""
    def post(path: str, body: Mapping[str, str]) -> dict[str, Any]:
        request = urllib.request.Request(
            base_url.rstrip("/") + path, data=json.dumps(body).encode(), method="POST",
            headers={"Content-Type": "application/json", "Anytype-Version": API_VERSION},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise NotesUnavailable(f"Anytype refused the pairing ({error.code}).") from None
        except (urllib.error.URLError, OSError, ValueError):
            raise NotesUnavailable("Anytype is not reachable. Open Anytype and try again.") from None

    challenge = post("/v1/auth/challenges", {"app_name": app_name})["challenge_id"]
    return str(post("/v1/auth/api_keys", {"challenge_id": challenge, "code": code_for().strip()})["api_key"])


# Object views and freshness.

def _plain(prop: Mapping[str, Any]) -> Any:
    for key in _VALUE_KEYS:
        if key in prop:
            value = prop[key]
            if key == "select":
                return (value or {}).get("key") if isinstance(value, Mapping) else value
            if key == "multi_select":
                return [tag.get("key") if isinstance(tag, Mapping) else tag for tag in value or []]
            return value
    return None


def object_view(raw: Mapping[str, Any]) -> dict[str, Any]:
    """An Anytype object as LifeOS shows it: plain property values keyed by property key."""
    return {
        "id": raw.get("id"),
        "name": raw.get("name") or "",
        "type": (raw.get("type") or {}).get("key"),
        "snippet": raw.get("snippet") or "",
        "markdown": raw.get("markdown") or "",
        "archived": bool(raw.get("archived", False)),
        "properties": {
            str(prop["key"]): _plain(prop) for prop in raw.get("properties") or [] if prop.get("key")
        },
    }


def object_hash(view: Mapping[str, Any]) -> str:
    """The note's own content. Anytype has no revision counter, so this is the freshness check
    a tier-2 edit or a proposal records."""
    own = {
        "name": view["name"], "type": view["type"], "markdown": view["markdown"],
        "archived": view["archived"],
        "properties": {k: v for k, v in view["properties"].items() if k not in VOLATILE},
    }
    return sha256(canonical_json(own).encode()).hexdigest()


class AnytypeGateway:
    def __init__(
        self, settings: AnytypeSettings, *, key_source: Callable[[], str | None] = read_api_key,
        timeout: float = 15.0, writes: bool = True,
    ) -> None:
        """writes=False: the remote caller's grant lacks notes:write. Every write is refused."""
        self.settings = settings
        self._key_source = key_source
        self._timeout = timeout
        self.writes = writes
        self._properties: dict[str, dict[str, Any]] | None = None
        self._schema_ready = False

    @property
    def space_id(self) -> str:
        return self.settings.space_id

    def _url(self, route: str, ids: Sequence[str], query: Mapping[str, Any] | None) -> str:
        path = route
        for value in ids:
            if not re.fullmatch(r"[A-Za-z0-9._:-]{1,256}", str(value)):
                raise ValueError("an Anytype id has letters, digits and . _ : - only")
            path = path.replace("*", urllib.parse.quote(str(value), safe=""), 1)
        prefix = "/v1/" if route == "spaces" else f"/v1/spaces/{urllib.parse.quote(self.space_id, safe='')}/"
        url = self.settings.base_url.rstrip("/") + prefix + path
        return url + ("?" + urllib.parse.urlencode(query) if query else "")

    def _request(
        self, method: str, route: str, *ids: str, body: Any = None,
        query: Mapping[str, Any] | None = None, stream: bool = False, timeout: float | None = None,
    ) -> Any:
        if (method, route) not in ALLOWED_ROUTES:
            raise PermissionError(f"LifeOS does not call Anytype {method} {route}")
        if (method, route) in WRITE_ROUTES and not self.writes:
            raise NotesNotPermitted("not permitted: this connection may not write to Anytype (notes:write)")
        key = self._key_source()
        if not key:
            raise NotesUnavailable("No Anytype API key. Run `lifeos anytype connect`.")
        request = urllib.request.Request(
            self._url(route, ids, query), method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {key}", "Anytype-Version": API_VERSION,
                "Content-Type": "application/json",
                **({"Accept": "text/event-stream"} if stream else {}),
            },
        )
        try:
            response = urllib.request.urlopen(request, timeout=timeout or self._timeout)
        except urllib.error.HTTPError as error:
            # The status and Anytype's short message only; the key never reaches an error.
            try:
                message = str(json.load(error).get("message", ""))[:200]
            except (ValueError, OSError, AttributeError):
                message = ""
            if error.code in {401, 403}:
                raise NotesUnavailable(
                    f"Anytype refused the API key ({error.code}). Run `lifeos anytype connect`."
                ) from None
            raise NotesError(f"Anytype {error.code}: {message}".rstrip(": ")) from None
        except (urllib.error.URLError, OSError, ValueError):
            raise NotesUnavailable("Anytype is not reachable. Open Anytype and try again.") from None
        if stream:
            return response
        with response:
            raw = response.read()
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            return raw.decode(errors="replace")

    def available(self) -> bool:
        try:
            self._request("GET", "types", query={"limit": 1})
        except (NotesUnavailable, NotesError):
            return False
        return True

    # Reads (tier 0).
    def spaces(self) -> list[dict[str, Any]]:
        return [
            {"id": space["id"], "name": space.get("name", "")}
            for space in self._request("GET", "spaces", query={"limit": 100}).get("data", [])
        ]

    def search(self, query: str, limit: int = 20, types: Sequence[str] = ()) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"query": query}
        if types:
            body["types"] = list(types)
        found = self._request("POST", "search", body=body, query={"limit": limit})
        return [
            {key: view[key] for key in ("id", "name", "type", "snippet")}
            for view in map(object_view, found.get("data", []))
        ]

    def get(self, object_id: str) -> dict[str, Any]:
        return object_view(self._request("GET", "objects/*", object_id, query={"format": "md"})["object"])

    def snapshot(self, object_id: str) -> dict[str, Any] | None:
        """The object and its hash, or None when it is gone (or archived)."""
        try:
            view = self.get(object_id)
        except NotesError:
            return None
        return {"node": view, "hash": object_hash(view)}

    def types(self) -> list[dict[str, Any]]:
        return [
            {"key": item.get("key"), "name": item.get("name"), "layout": item.get("layout")}
            for item in self._request("GET", "types", query={"limit": 1000}).get("data", [])
        ]

    def properties(self, *, refresh: bool = False) -> dict[str, dict[str, Any]]:
        if self._properties is None or refresh:
            data = self._request("GET", "properties", query={"limit": 1000}).get("data", [])
            self._properties = {str(item["key"]): item for item in data if item.get("key")}
        return self._properties

    def tags(self, property_key: str = TAG_PROPERTY) -> dict[str, dict[str, Any]]:
        prop = self.properties().get(property_key)
        if prop is None:
            return {}
        data = self._request("GET", "properties/*/tags", prop["id"], query={"limit": 1000}).get("data", [])
        return {str(tag["key"]): tag for tag in data if tag.get("key")}

    # Writes (tier 1 and 2). Callers decide whether a write needs a proposal.
    def _require_writes(self) -> None:
        if not self.writes:
            raise NotesNotPermitted("not permitted: this connection may not write to Anytype (notes:write)")

    def _value(self, key: str, value: Any) -> dict[str, Any]:
        prop = self.properties().get(key) or self.properties(refresh=True).get(key)
        if prop is None:
            raise ValueError(f"no property {key!r} in this Anytype space")
        kind = prop.get("format")
        if kind in {"text", "url", "email", "phone", "date"}:
            return {"key": key, kind: str(value)}
        if kind == "number":
            return {"key": key, "number": float(value)}
        if kind == "checkbox":
            return {"key": key, "checkbox": value in {True, "true", "True", "yes", "1"}}
        if kind in {"select", "multi_select"}:
            known = self.tags(key)
            by_name = {str(tag.get("name", "")).casefold(): k for k, tag in known.items()}

            def tag_key(item: Any) -> str:
                text = str(item)
                found = text if text in known else by_name.get(text.casefold())
                if found is None:
                    raise ValueError(f"no tag {text!r} on property {key!r}; ask the person to make it")
                return found

            if kind == "select":
                return {"key": key, "select": tag_key(value)}
            items = value if isinstance(value, (list, tuple)) else [value]
            return {"key": key, "multi_select": [tag_key(item) for item in items]}
        if kind == "objects":
            items = value if isinstance(value, (list, tuple)) else [value]
            return {"key": key, "objects": [str(item) for item in items]}
        raise ValueError(f"LifeOS does not set {kind} properties")

    def create(
        self, *, type_key: str, name: str, body: str | None = None,
        properties: Mapping[str, Any] | None = None, agent: str = "lifeos",
    ) -> str:
        self._require_writes()
        values = [self._value(k, v) for k, v in {**(properties or {}), "made_by": agent}.items()]
        payload: dict[str, Any] = {"type_key": type_key, "name": name, "properties": values}
        if body:
            payload["body"] = body
        return str(self._request("POST", "objects", body=payload)["object"]["id"])

    def update(
        self, object_id: str, *, name: str | None = None, markdown: str | None = None,
        properties: Mapping[str, Any] | None = None, agent: str = "lifeos",
    ) -> None:
        self._require_writes()
        payload: dict[str, Any] = {
            "properties": [self._value(k, v) for k, v in {**(properties or {}), "made_by": agent}.items()],
        }
        if name is not None:
            payload["name"] = name
        if markdown is not None:
            payload["markdown"] = markdown
        self._request("PATCH", "objects/*", object_id, body=payload)

    def tag(self, object_id: str, tag_key: str, *, agent: str = "lifeos") -> None:
        current = self.get(object_id)["properties"].get(TAG_PROPERTY) or []
        if tag_key not in current:
            self.update(object_id, properties={TAG_PROPERTY: [*current, tag_key]}, agent=agent)

    def add_to_list(self, list_id: str, object_ids: Sequence[str]) -> None:
        self._request("POST", "lists/*/objects", list_id, body={"objects": list(object_ids)})

    def ensure_schema(self) -> dict[str, list[str]]:
        """Create the LifeOS types, properties and the Ask agent tag if missing. Idempotent."""
        self._require_writes()
        made: dict[str, list[str]] = {"properties": [], "types": [], "tags": []}
        existing = self.properties(refresh=True)
        for key, (name, kind, options) in PROPERTIES.items():
            if key not in existing:
                body: dict[str, Any] = {"key": key, "name": name, "format": kind}
                if options:
                    body["tags"] = [{"name": option, "color": "grey"} for option in options]
                self._request("POST", "properties", body=body)
                made["properties"].append(key)
        if TAG_PROPERTY not in existing:
            self._request("POST", "properties", body={"key": TAG_PROPERTY, "name": "Tag", "format": "multi_select"})
            made["properties"].append(TAG_PROPERTY)
        existing = self.properties(refresh=True)
        for key, (_, _, options) in PROPERTIES.items():
            if options:
                have = {str(tag.get("name")) for tag in self.tags(key).values()}
                for option in options:
                    if option not in have:
                        self._request("POST", "properties/*/tags", existing[key]["id"],
                                      body={"name": option, "color": "grey"})
                        made["tags"].append(f"{key}:{option}")
        tag_key, tag_name, color = ASK_AGENT_TAG
        if tag_key not in self.tags(TAG_PROPERTY):
            self._request("POST", "properties/*/tags", existing[TAG_PROPERTY]["id"],
                          body={"key": tag_key, "name": tag_name, "color": color})
            made["tags"].append(tag_key)
        have_types = {item["key"] for item in self.types()}
        for key, (name, plural, props) in TYPES.items():
            if key not in have_types:
                self._request("POST", "types", body={
                    "key": key, "name": name, "plural_name": plural, "layout": "basic",
                    "properties": [
                        {"key": p, "name": PROPERTIES[p][0], "format": PROPERTIES[p][1]} for p in props
                    ],
                })
                made["types"].append(key)
        self._schema_ready = True
        return made

    def ensure_schema_once(self) -> None:
        if not self._schema_ready:
            self.ensure_schema()

    # Chat (the chat agent).
    def find_or_create_chat(self, name: str = CHAT_NAME) -> str:
        for chat in self._request("GET", "chats", query={"limit": 1000}).get("data", []):
            if chat.get("name") == name:
                return str(chat["id"])
        return str(self._request("POST", "chats", body={"name": name})["object"]["id"])

    def chat_messages(self, chat_id: str, *, limit: int = 50, after: str | None = None) -> list[dict[str, Any]]:
        query: dict[str, Any] = {"limit": limit}
        if after:
            query["after_order_id"] = after
        return list(self._request("GET", "chats/*/messages", chat_id, query=query).get("messages", []))

    def post_message(self, chat_id: str, text: str, *, reply_to: str | None = None) -> str:
        body: dict[str, Any] = {"text": text}
        if reply_to:
            body["reply_to_message_id"] = reply_to
        return str(self._request("POST", "chats/*/messages", chat_id, body=body).get("message_id", ""))

    def react(self, chat_id: str, message_id: str, emoji: str) -> None:
        self._request("POST", "chats/*/messages/*/reactions", chat_id, message_id, body={"emoji": emoji})

    def stream(self, chat_id: str, *, limit: int = 50, timeout: float = 90.0) -> Iterator[tuple[str, dict[str, Any]]]:
        """Server-Sent Events from the chat: (event name, message). Heartbeat comments are
        skipped. The payload is a ChatMessage, or an object holding one under "message"."""
        response = self._request(
            "GET", "chats/*/messages/stream", chat_id, query={"limit": limit}, stream=True, timeout=timeout,
        )
        with response:
            event, data = "message", []
            for raw in response:
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                if not line:
                    if data:
                        try:
                            payload = json.loads("\n".join(data))
                        except ValueError:
                            payload = None
                        if isinstance(payload, dict):
                            message = payload.get("message") if isinstance(payload.get("message"), dict) else payload
                            yield event, message
                    event, data = "message", []
                elif line.startswith(":"):
                    continue
                elif line.startswith("event:"):
                    event = line[6:].strip()
                elif line.startswith("data:"):
                    data.append(line[5:].lstrip())


def build_gateway(database_path: Path, *, writes: bool = True,
                  environ: Mapping[str, str] = os.environ) -> AnytypeGateway | None:
    """The configured gateway, or None until `lifeos anytype connect` chose a space."""
    settings = load_settings(settings_path(database_path, environ), environ)
    if settings is None:
        return None
    return AnytypeGateway(settings, key_source=lambda: read_api_key(environ), writes=writes)
