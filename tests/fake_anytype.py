"""A small fake of the Anytype Local API (2025-11-08) for tests. Never the real app.

It implements only the routes LifeOS uses, checks the Bearer key and the Anytype-Version
header, records every request (so tests can prove no DELETE was sent), and serves the chat
stream as Server-Sent Events.
"""

from __future__ import annotations

import itertools
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

KEY = "SYNTHETIC-anytype-key-0123456789"
SPACE = "space-1"
USER = "_participant_user"
_SYSTEM_PROPERTIES = {"tag": ("Tag", "multi_select"), "last_modified_date": ("Last modified", "date")}


class FakeAnytype:
    def __init__(self, *, key: str = KEY, space: str = SPACE, author: str = USER) -> None:
        self.key, self.space, self.author = key, space, author
        self.requests: list[tuple[str, str, Any]] = []
        self.lock = threading.Condition()
        self.ids = itertools.count(1)
        self.properties: dict[str, dict[str, Any]] = {}
        self.tags: dict[str, dict[str, dict[str, Any]]] = {}
        self.types: dict[str, dict[str, Any]] = {
            "page": {"key": "page", "name": "Page", "layout": "basic", "id": "type-page"},
            "note": {"key": "note", "name": "Note", "layout": "note", "id": "type-note"},
        }
        self.objects: dict[str, dict[str, Any]] = {}
        self.lists: dict[str, list[str]] = {}
        self.chats: dict[str, dict[str, Any]] = {}
        self.messages: dict[str, list[dict[str, Any]]] = {}
        self.events: list[tuple[str, str, dict[str, Any]]] = []  # (chat, event, message)
        self.fail_next: int | None = None
        for key, (name, kind) in _SYSTEM_PROPERTIES.items():
            self._add_property(key, name, kind)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.server.daemon_threads = True
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> FakeAnytype:
        self.thread.start()
        return self

    def __exit__(self, *_: Any) -> None:
        with self.lock:
            self.closed = True
            self.lock.notify_all()
        self.server.shutdown()
        self.server.server_close()

    closed = False

    # Helpers for tests.
    def new_id(self, prefix: str) -> str:
        return f"{prefix}-{next(self.ids)}"

    def _add_property(self, key: str, name: str, kind: str) -> dict[str, Any]:
        prop = {"id": self.new_id("prop"), "key": key, "name": name, "format": kind, "object": "property"}
        self.properties[key] = prop
        self.tags.setdefault(key, {})
        return prop

    def _add_tag(self, prop_key: str, name: str, key: str | None = None, color: str = "grey") -> dict[str, Any]:
        tag_key = key or re.sub(r"\W+", "_", name.lower()).strip("_")
        tag = {"id": self.new_id("tag"), "key": tag_key, "name": name, "color": color, "object": "tag"}
        self.tags[prop_key][tag_key] = tag
        return tag

    def user_says(self, chat_id: str, text: str, *, author: str | None = None) -> dict[str, Any]:
        return self._add_message(chat_id, text, author or self.author, reply_to=None)

    def edit(self, chat_id: str, message_id: str, text: str) -> None:
        with self.lock:
            message = next(m for m in self.messages[chat_id] if m["id"] == message_id)
            message["content"]["text"] = text
            self.events.append((chat_id, "message_updated", dict(message)))
            self.lock.notify_all()

    def _add_message(self, chat_id: str, text: str, author: str, reply_to: str | None) -> dict[str, Any]:
        with self.lock:
            number = next(self.ids)
            message = {
                "id": f"msg-{number}", "order_id": f"{number:08d}", "creator": author,
                "created_at": int(time.time()), "content": {"text": text, "style": "paragraph"},
                "reactions": {}, "reply_to_message_id": reply_to or "",
            }
            self.messages.setdefault(chat_id, []).append(message)
            self.events.append((chat_id, "message_added", message))
            self.lock.notify_all()
            return message

    def deletes(self) -> list[tuple[str, str, Any]]:
        return [request for request in self.requests if request[0] == "DELETE"]

    def replies(self, chat_id: str, to: str) -> list[dict[str, Any]]:
        return [m for m in self.messages.get(chat_id, []) if m["reply_to_message_id"] == to]

    # The HTTP side.
    def _view(self, obj: dict[str, Any]) -> dict[str, Any]:
        return {
            "object": "object", "id": obj["id"], "name": obj["name"], "space_id": self.space,
            "archived": False, "layout": "basic", "snippet": obj["markdown"][:100],
            "markdown": obj["markdown"], "type": self.types[obj["type"]],
            "properties": [dict(value) for value in obj["properties"].values()],
        }

    def _property_values(self, links: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        values: dict[str, dict[str, Any]] = {}
        for link in links:
            prop = self.properties.get(link.get("key", ""))
            if prop is None:
                raise ValueError(f"unknown property {link.get('key')}")
            kind = prop["format"]
            if kind not in link:
                raise ValueError(f"property {prop['key']} needs a {kind} value")
            value = link[kind]
            if kind == "select":
                value = self._find_tag(prop["key"], value)
            elif kind == "multi_select":
                value = [self._find_tag(prop["key"], item) for item in value]
            values[prop["key"]] = {"key": prop["key"], "name": prop["name"], "format": kind,
                                   "id": prop["id"], "object": "property", kind: value}
        return values

    def _find_tag(self, prop_key: str, wanted: str) -> dict[str, Any]:
        for tag in self.tags[prop_key].values():
            if wanted in {tag["key"], tag["id"]}:
                return tag
        raise ValueError(f"unknown tag {wanted}")

    def _touch(self, obj: dict[str, Any]) -> None:
        obj["properties"]["last_modified_date"] = {
            "key": "last_modified_date", "format": "date", "date": f"{time.time():.6f}",
        }

    def route(self, method: str, path: str, query: dict[str, str], body: Any) -> tuple[int, Any]:
        if path == "/v1/spaces" and method == "GET":
            return 200, {"data": [{"id": self.space, "name": "Personal", "object": "anytype.space"},
                                  {"id": "space-other", "name": "Work", "object": "anytype.space"}],
                         "pagination": {}}
        match = re.fullmatch(r"/v1/spaces/([^/]+)/(.*)", path)
        if not match:
            return 404, {"message": "not found"}
        if match.group(1) != self.space:
            return 404, {"message": "space not found"}
        rest, page = match.group(2), {"pagination": {"has_more": False}}
        if method == "DELETE":
            return 200, {}
        if rest == "search" and method == "POST":
            words = str(body.get("query", "")).lower()
            hits = [self._view(o) for o in self.objects.values()
                    if words in (o["name"] + " " + o["markdown"]).lower()
                    and (not body.get("types") or o["type"] in body["types"])]
            return 200, {"data": hits[: int(query.get("limit", 100))], **page}
        if rest == "types":
            if method == "GET":
                return 200, {"data": list(self.types.values()), **page}
            key = body["key"]
            if key in self.types:
                return 400, {"message": "type exists"}
            for link in body.get("properties", []):
                if link["key"] not in self.properties:
                    self._add_property(link["key"], link["name"], link["format"])
            self.types[key] = {"key": key, "name": body["name"], "layout": body["layout"],
                               "id": self.new_id("type"), "properties": body.get("properties", [])}
            return 201, {"type": self.types[key]}
        if rest == "properties":
            if method == "GET":
                return 200, {"data": list(self.properties.values()), **page}
            if body["key"] in self.properties:
                return 400, {"message": "property exists"}
            prop = self._add_property(body["key"], body["name"], body["format"])
            for tag in body.get("tags", []):
                self._add_tag(prop["key"], tag["name"], tag.get("key"), tag["color"])
            return 201, {"property": prop}
        if tag_match := re.fullmatch(r"properties/([^/]+)/tags", rest):
            prop = next((p for p in self.properties.values() if p["id"] == tag_match.group(1)), None)
            if prop is None:
                return 404, {"message": "property not found"}
            if method == "GET":
                return 200, {"data": list(self.tags[prop["key"]].values()), **page}
            return 201, {"tag": self._add_tag(prop["key"], body["name"], body.get("key"), body["color"])}
        if rest == "objects" and method == "POST":
            if body.get("type_key") not in self.types:
                return 400, {"message": "unknown type"}
            obj = {"id": self.new_id("obj"), "name": body.get("name", ""), "type": body["type_key"],
                   "markdown": body.get("body", ""), "properties": self._property_values(body.get("properties", []))}
            self._touch(obj)
            self.objects[obj["id"]] = obj
            return 201, {"object": self._view(obj)}
        if obj_match := re.fullmatch(r"objects/([^/]+)", rest):
            obj = self.objects.get(obj_match.group(1))
            if obj is None:
                return 404, {"message": "object not found"}
            if method == "PATCH":
                obj["properties"].update(self._property_values(body.get("properties", [])))
                for field, target in (("name", "name"), ("markdown", "markdown")):
                    if field in body:
                        obj[target] = body[field]
                self._touch(obj)
            return 200, {"object": self._view(obj)}
        if list_match := re.fullmatch(r"lists/([^/]+)/objects", rest):
            if list_match.group(1) not in self.objects:
                return 404, {"message": "list not found"}
            self.lists.setdefault(list_match.group(1), []).extend(body["objects"])
            return 200, "ok"
        if rest == "chats":
            if method == "GET":
                return 200, {"data": list(self.chats.values()), **page}
            chat = {"id": self.new_id("chat"), "name": body.get("name", ""), "object": "object"}
            self.chats[chat["id"]] = chat
            self.messages[chat["id"]] = []
            return 201, {"object": chat}
        if msg_match := re.fullmatch(r"chats/([^/]+)/messages", rest):
            chat_id = msg_match.group(1)
            if chat_id not in self.chats:
                return 404, {"message": "chat not found"}
            if method == "GET":
                found = [m for m in self.messages[chat_id] if m["order_id"] > query.get("after_order_id", "")]
                return 200, {"messages": found[-int(query.get("limit", 50)):] if "after_order_id" not in query
                             else found[: int(query.get("limit", 50))]}
            message = self._add_message(chat_id, body["text"], "_participant_api", body.get("reply_to_message_id"))
            return 201, {"message_id": message["id"]}
        if react := re.fullmatch(r"chats/([^/]+)/messages/([^/]+)/reactions", rest):
            message = next(m for m in self.messages[react.group(1)] if m["id"] == react.group(2))
            message["reactions"].setdefault(body["emoji"], []).append("_participant_api")
            return 200, {}
        return 404, {"message": f"no route {method} {rest}"}

    def _handler(self) -> type[BaseHTTPRequestHandler]:
        fake = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_: Any) -> None:
                pass

            def _send(self, status: int, payload: Any) -> None:
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _handle(self) -> None:
                url = urlparse(self.path)
                query = {k: v[-1] for k, v in parse_qs(url.query).items()}
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b""
                body = json.loads(raw) if raw else {}
                with fake.lock:
                    fake.requests.append((self.command, url.path, body))
                if self.headers.get("Anytype-Version") != "2025-11-08":
                    return self._send(400, {"message": "missing Anytype-Version"})
                if url.path.startswith("/v1/auth/"):
                    if url.path == "/v1/auth/challenges":
                        return self._send(201, {"challenge_id": "challenge-1"})
                    if body.get("code") == "1234":
                        return self._send(201, {"api_key": fake.key})
                    return self._send(400, {"message": "wrong code"})
                if self.headers.get("Authorization") != f"Bearer {fake.key}":
                    return self._send(401, {"message": "unauthorized"})
                if fake.fail_next is not None:
                    status, fake.fail_next = fake.fail_next, None
                    return self._send(status, {"message": "synthetic failure"})
                if url.path.endswith("/messages/stream"):
                    return self._stream(url.path.split("/")[-3], int(query.get("limit", 50)))
                with fake.lock:
                    try:
                        status, payload = fake.route(self.command, url.path, query, body)
                    except (ValueError, KeyError) as error:
                        status, payload = 400, {"message": str(error)}
                self._send(status, payload)

            def _stream(self, chat_id: str, limit: int) -> None:
                if chat_id not in fake.chats:
                    return self._send(404, {"message": "chat not found"})
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                with fake.lock:
                    seen = len(fake.events)
                    opening = fake.messages[chat_id][-limit:]
                try:
                    for message in opening:
                        self._event("message_added", message)
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                    while True:
                        with fake.lock:
                            while len(fake.events) == seen and not fake.closed:
                                fake.lock.wait(0.5)
                                if fake.closed:
                                    return
                            if fake.closed:
                                return
                            fresh, seen = fake.events[seen:], len(fake.events)
                        for chat, event, message in fresh:
                            if chat == chat_id:
                                self._event(event, message)
                except (BrokenPipeError, ConnectionResetError):
                    return

            def _event(self, name: str, message: dict[str, Any]) -> None:
                frame = f"id: {message['order_id']}\nevent: {name}\ndata: {json.dumps(message)}\n\n"
                self.wfile.write(frame.encode())
                self.wfile.flush()

            do_GET = do_POST = do_PATCH = do_DELETE = _handle

        return Handler
