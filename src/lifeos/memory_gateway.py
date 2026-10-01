"""Loopback-only access to the local Supermemory process."""

from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen


class MemoryGatewayError(RuntimeError):
    pass


class UnknownMemoryDocument(MemoryGatewayError):
    pass


class SupermemoryGateway:
    def __init__(self, base_url: str = "http://localhost:6767", timeout: float = 15) -> None:
        parsed = urlsplit(base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
            raise ValueError("Supermemory must use a loopback HTTP address")
        if parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
            raise ValueError("Supermemory base URL must not contain a path or query")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def add_document(self, *, content: str, custom_id: str, container_tag: str = "lifeos") -> dict[str, Any]:
        return self._request(
            "POST",
            "/v3/documents",
            {"content": content, "customId": custom_id, "containerTag": container_tag},
        )

    def get_document(self, identifier: str) -> dict[str, Any]:
        return self._request("GET", f"/v3/documents/{quote(identifier, safe='')}")

    def search(self, query: str, *, limit: int, container_tag: str = "lifeos") -> dict[str, Any]:
        return self._request(
            "POST",
            "/v4/search",
            {"q": query, "containerTag": container_tag, "searchMode": "hybrid", "limit": limit},
        )

    def delete_document(self, identifier: str) -> None:
        request = Request(
            self.base_url + f"/v3/documents/{quote(identifier, safe='')}", method="DELETE"
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                if response.status != 204:
                    raise MemoryGatewayError("Supermemory did not confirm document deletion")
        except HTTPError as error:
            if error.code == 404:
                raise UnknownMemoryDocument("memory document not found") from error
            raise MemoryGatewayError(f"Supermemory returned HTTP {error.code}") from error
        except (URLError, TimeoutError) as error:
            raise MemoryGatewayError("local Supermemory is unavailable") from error

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        body = json.dumps(payload).encode() if payload is not None else None
        request = Request(
            self.base_url + path,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body is not None else {},
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                result = json.load(response)
        except HTTPError as error:
            if error.code == 404:
                raise UnknownMemoryDocument("memory document not found") from error
            raise MemoryGatewayError(f"Supermemory returned HTTP {error.code}") from error
        except (URLError, TimeoutError, ValueError) as error:
            raise MemoryGatewayError("local Supermemory is unavailable or returned invalid data") from error
        if not isinstance(result, dict):
            raise MemoryGatewayError("Supermemory returned an unexpected response")
        return result
