"""Narrow Mac-to-gateway transport; no credentials are generated or persisted."""

from __future__ import annotations

import json
from typing import Protocol
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .core import Invalid, Json, encode, utcnow


class Gateway(Protocol):
    def clock(self) -> str: ...
    def upload(self, sequence: int, observed_at: str, items: list[Json]) -> Json: ...
    def pending(self) -> list[Json]: ...
    def claim(self, op_id: str, claim_id: str) -> Json: ...
    def acknowledge(self, op_id: str, claim_id: str, result: Json) -> Json: ...


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Invalid("refusing redirect: credentials must stay on the selected gateway")


class HTTPGateway:
    def __init__(self, origin: str, adapter_token: str):
        url = urlsplit(origin)
        if url.username or url.password or url.query or url.fragment or url.path not in {"", "/"}:
            raise Invalid("gateway must be an origin, without credentials or path")
        if url.scheme != "https" and not (url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost"}):
            raise Invalid("HTTPS required except for loopback fixture tests")
        self.origin = origin.rstrip("/")
        self.token = adapter_token
        self.client = build_opener(NoRedirect())

    @staticmethod
    def clock() -> str:
        return utcnow()

    def request(self, path: str, body=None):
        request = Request(
            self.origin + path,
            data=encode(body).encode() if body is not None else None,
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"},
        )
        with self.client.open(request, timeout=15) as response:
            return json.loads(response.read(1024 * 1024))

    def upload(self, sequence, observed_at, items):
        return self.request(
            "/adapter/snapshot", {"sequence": sequence, "observed_at": observed_at, "items": items, "complete": True}
        )

    def pending(self):
        return self.request("/adapter/pending")

    def claim(self, op_id, claim_id):
        return self.request("/adapter/claim", {"op_id": op_id, "claim_id": claim_id})

    def acknowledge(self, op_id, claim_id, result):
        return self.request("/adapter/ack", {"op_id": op_id, "claim_id": claim_id, "result": result})
