"""Small WSGI API. Loopback preview only; production serving is a rollout gate."""

from __future__ import annotations

import hmac
import json
from collections.abc import Callable
from pathlib import Path

from .core import Invalid, Store, encode

MAX_BODY = 256 * 1024


class API:
    def __init__(self, store: Store, tokens: dict[str, str], demo_step: Callable | None = None):
        if set(tokens) != {"dot", "reviewer", "adapter"} or len(set(tokens.values())) != 3:
            raise Invalid("distinct dot, reviewer and adapter credentials required")
        if any(len(value) < 20 for value in tokens.values()):
            raise Invalid("supply credentials of at least 20 characters")
        self.store, self.tokens, self.demo_step = store, tokens, demo_step

    def __call__(self, env, start_response):
        try:
            status, body, mime = self.dispatch(env)
        except (Invalid, ValueError, TypeError, KeyError) as error:
            status, body, mime = 409, encode({"error": str(error)}), "application/json"
        except Exception:  # noqa: BLE001 -- contain boundary failures without logging secrets
            status, body, mime = 503, encode({"error": "service unavailable"}), "application/json"
        phrases = {
            200: "OK",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            409: "Conflict",
            413: "Payload Too Large",
            503: "Service Unavailable",
        }
        raw = body.encode()
        start_response(
            f"{status} {phrases[status]}",
            [
                ("Content-Type", mime),
                ("Content-Length", str(len(raw))),
                ("Cache-Control", "no-store"),
                ("X-Content-Type-Options", "nosniff"),
                (
                    "Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
                ),
            ],
        )
        return [raw]

    def dispatch(self, env):
        path, method = env.get("PATH_INFO", "/"), env["REQUEST_METHOD"]
        if method == "GET" and path == "/health":
            return 200, encode({"status": "ok", "mode": "prototype"}), "application/json"
        if method == "GET" and path in {"/", "/dot.js", "/dot.css"}:
            filenames = {"/": "index.html", "/dot.js": "dot.js", "/dot.css": "dot.css"}
            mime = {"/": "text/html", "/dot.js": "text/javascript", "/dot.css": "text/css"}[path]
            return 200, (Path(__file__).parent / "web" / filenames[path]).read_text(), mime
        auth = env.get("HTTP_AUTHORIZATION", "")
        role = next((role for role, token in self.tokens.items() if hmac.compare_digest(auth, "Bearer " + token)), None)
        if role is None:
            return 401, encode({"error": "authentication required"}), "application/json"
        allowed = {
            ("GET", "/state"): {"dot", "reviewer"},
            ("POST", "/proposals"): {"dot", "reviewer"},
            ("POST", "/approve"): {"reviewer"},
            ("POST", "/reject"): {"reviewer"},
            ("GET", "/adapter/pending"): {"adapter"},
            ("POST", "/adapter/snapshot"): {"adapter"},
            ("POST", "/adapter/claim"): {"adapter"},
            ("POST", "/adapter/ack"): {"adapter"},
        }
        if self.demo_step:
            allowed[("POST", "/demo/reconnect")] = {"reviewer"}
        route = (method, path)
        if route not in allowed:
            return 404, encode({"error": "unknown route"}), "application/json"
        if role not in allowed[route]:
            return 403, encode({"error": "role cannot perform this action"}), "application/json"
        if method == "GET":
            result = self.store.state() if path == "/state" else self.store.pending()
        else:
            length = int(env.get("CONTENT_LENGTH") or 0)
            if length < 0 or length > MAX_BODY:
                return 413, encode({"error": "body too large"}), "application/json"
            body = json.loads(env["wsgi.input"].read(length))
            if not isinstance(body, dict):
                raise Invalid("JSON object required")
            if path == "/proposals":
                result = self.store.propose(**body)
            elif path in {"/approve", "/reject"}:
                if set(body) != {"op_id", "revision"}:
                    raise Invalid("decision requires operation ID and revision")
                result = self.store.decide(**body, approve=path == "/approve")
            elif path == "/adapter/pending":
                result = self.store.pending()
            elif path == "/adapter/snapshot":
                if set(body) != {"sequence", "observed_at", "items", "complete"} or body["complete"] is not True:
                    raise Invalid("only explicitly complete inventories are accepted")
                body.pop("complete")
                result = self.store.upload(**body)
            elif path == "/adapter/claim":
                result = self.store.claim(**body)
            elif path == "/adapter/ack":
                result = self.store.acknowledge(**body)
            else:
                if self.demo_step is None:
                    raise Invalid("demo reconnect is disabled")
                self.demo_step()
                result = self.store.state()
        return 200, encode(result), "application/json"
