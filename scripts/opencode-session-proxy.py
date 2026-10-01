#!/usr/bin/env python3
"""Loopback-only OpenAI-compatible adapter for OpenCode Go's session header."""

from http.client import HTTPSConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM_HOST = "opencode.ai"
UPSTREAM_PREFIX = "/zen/go/v1"
MAX_BODY_BYTES = 2 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/chat/completions":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400)
            return
        if not 0 < length <= MAX_BODY_BYTES:
            self.send_error(413)
            return

        authorization = self.headers.get("Authorization")
        if not authorization or not authorization.startswith("Bearer "):
            self.send_error(401)
            return

        body = self.rfile.read(length)
        connection = HTTPSConnection(UPSTREAM_HOST, timeout=120)
        try:
            connection.request(
                "POST",
                UPSTREAM_PREFIX + "/chat/completions",
                body=body,
                headers={
                    "Authorization": authorization,
                    "Content-Type": "application/json",
                    "User-Agent": "lifeos-memory/0.1",
                    "x-opencode-session": "lifeos",
                },
            )
            upstream = connection.getresponse()
            response_body = upstream.read()
            self.send_response(upstream.status)
            self.send_header("Content-Type", upstream.getheader("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        except (OSError, TimeoutError):
            self.send_error(502, "Upstream request failed")
        finally:
            connection.close()

    def log_message(self, format, *args):
        # Requests contain private memory content and bearer credentials.
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 6768), Handler).serve_forever()
