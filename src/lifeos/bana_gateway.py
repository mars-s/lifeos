"""The only door from LifeOS into Bana: the running app's `POST /mcp` on 127.0.0.1.

It finds the app through `<BANA_HOME>/graph.bana.live` (port) and `<BANA_HOME>/token`, never
returns or logs the token, and runs only allowlisted command ids. Destructive or persistent
commands (the plan's Never tier) are not in the allowlist and are refused before any request.
Bana closed means `BanaUnavailable`: nothing is queued.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Mapping
from hashlib import sha256
from pathlib import Path
from typing import Any

from .models import canonical_json

# Tier 0 (read) and the write commands the note tools and proposals use. Nothing else.
READ_COMMANDS = frozenset({"graph.search", "graph.inspect", "graph.tags", "export.markdown", "nav.day"})
WRITE_COMMANDS = frozenset({
    "node.add", "node.setDescription", "node.move", "tag.add", "field.add", "field.set",
    "template.install",  # only the Agent notebook template, see run()
})
ALLOWED_COMMANDS = READ_COMMANDS | WRITE_COMMANDS
# Never: listed so a test can prove none of them is reachable, not to filter at run time.
NEVER_COMMANDS = frozenset({
    "node.hardDelete", "node.delete", "trash.empty", "node.toggleLock", "import.folder",
    "commandNode.on", "file.save", "file.open",
})
NEVER_PREFIXES = ("file.", "settings.", "workspace.", "commandNode.", "trash.", "import.")
assert not ALLOWED_COMMANDS & NEVER_COMMANDS
assert not any(command.startswith(NEVER_PREFIXES) for command in ALLOWED_COMMANDS)

# Bana's "Agent notebook" template defines these supertags and their fields. LifeOS installs it
# once, before its first write, if any of them is missing (installing again adds a page).
TEMPLATE = "Agent notebook"
LIFEOS_TAGS = frozenset({
    "capture", "interpretation", "suggested-action", "question", "meeting", "thing", "event",
    "proposal", "in-things", "ask-agent",
})


class BanaUnavailable(RuntimeError):
    """Bana is not running, not reachable, or refused this install's token."""


class BanaError(RuntimeError):
    """Bana answered but the command failed (a locked node says "not available: ...")."""


class BanaRefused(BanaError):
    """Bana's own agent rules refused the command (its text starts with "refused:")."""


def node_hash(tree: Mapping[str, Any]) -> str:
    """A node's own content (name, note, tags, fields, done, parent), not its children.

    Bana has no revision counter, so this is the freshness check a tier-2 edit or a proposal
    records. Adding a child under a node does not make it stale.
    """
    own = {key: value for key, value in tree.items() if key not in {"children", "breadcrumbs", "results"}}
    crumbs = tree.get("breadcrumbs") or []
    own["parent"] = crumbs[-1]["id"] if crumbs else None
    return sha256(canonical_json(own).encode()).hexdigest()


class BanaGateway:
    def __init__(self, home: str | Path | None = None, *, timeout: float = 15.0) -> None:
        self._home = Path(home or os.environ.get("BANA_HOME") or Path.home() / "Bana")
        self._timeout = timeout
        self._template_ready = False

    def _endpoint(self) -> tuple[int, str]:
        try:
            live = json.loads((self._home / "graph.bana.live").read_text(encoding="utf-8"))
            port = int(live["port"])
            token = (self._home / "token").read_text(encoding="utf-8").strip()
        except (OSError, ValueError, KeyError, TypeError):
            raise BanaUnavailable("Bana is not reachable. Open Bana on this Mac and try again.") from None
        if len(token) < 32:
            raise BanaUnavailable("Bana's local token is missing.")
        return port, token

    def run(self, command: str, params: Mapping[str, Any] | None = None, *, agent: str = "lifeos") -> Any:
        """agent: who Bana records as the author of a write (X-Bana-Agent)."""
        if command not in ALLOWED_COMMANDS:
            raise PermissionError(f"LifeOS does not run the Bana command {command!r}")
        if command == "template.install" and (params or {}).get("name") != TEMPLATE:
            raise PermissionError("LifeOS installs only the Agent notebook template")
        port, token = self._endpoint()
        body = {
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": {"name": "execute", "arguments": {"command": command, "params": dict(params or {})}},
        }
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/mcp", data=json.dumps(body).encode(), method="POST",
            headers={
                "Authorization": f"Bearer {token}", "Content-Type": "application/json",
                "X-Bana-Agent": agent,
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                reply = json.load(response)
        except urllib.error.HTTPError as error:
            # The status only; the request (and its token) never reaches an error message.
            raise BanaUnavailable(f"Bana refused the request ({error.code}).") from None
        except (urllib.error.URLError, OSError, ValueError):
            raise BanaUnavailable("Bana is not reachable. Open Bana on this Mac and try again.") from None
        if "error" in reply:
            raise BanaError(str(reply["error"].get("message", "Bana error")))
        result = reply.get("result", {})
        if result.get("isError"):
            text = "".join(item.get("text", "") for item in result.get("content", []))
            raise (BanaRefused if text.startswith("refused:") else BanaError)(text or "Bana command failed")
        content = result.get("structuredContent", {})
        return content["result"] if set(content) == {"result"} else content

    def available(self) -> bool:
        try:
            self.run("graph.tags")
        except (BanaUnavailable, BanaError):
            return False
        return True

    # Reads (tier 0).
    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        return list(self.run("graph.search", {"query": query}))[:limit]

    def inspect(self, node_id: str | int) -> dict[str, Any]:
        return self.run("graph.inspect", {"node": int(node_id)})

    def snapshot(self, node_id: str | int) -> dict[str, Any] | None:
        """The node and its hash, or None when it no longer exists."""
        try:
            tree = self.inspect(node_id)
        except BanaError:
            return None
        return {"node": tree, "hash": node_hash(tree)}

    def markdown(self, node_id: str | int) -> str:
        return str(self.run("export.markdown", {"node": int(node_id)})["markdown"])

    def day(self, date: str) -> int:
        """The day page's node id (Bana makes the page if the day has none)."""
        return int(self.run("nav.day", {"date": date})["zoom"])

    def tags(self) -> set[str]:
        return {str(tag["name"]) for tag in self.run("graph.tags")}

    # Writes (tier 1 and 2). Callers decide whether a write needs a proposal.
    def ensure_template(self) -> None:
        if not self._template_ready:
            if not self.tags() >= LIFEOS_TAGS:
                self.run("template.install", {"name": TEMPLATE})
            self._template_ready = True

    def add(
        self, *, name: str, parent: str | int, tags: tuple[str, ...] = (),
        fields: Mapping[str, str] | None = None, description: str | None = None,
        agent: str = "lifeos",
    ) -> int:
        node = int(self.run("node.add", {"name": name, "parent": parent}, agent=agent)["id"])
        if description:
            self.run("node.setDescription", {"node": node, "text": description}, agent=agent)
        for tag in tags:
            self.tag(node, tag, agent=agent)
        for field, value in (fields or {}).items():
            self.set_field(node, field, value, agent=agent)
        return node

    def tag(self, node_id: str | int, tag: str, *, agent: str = "lifeos") -> None:
        self.run("tag.add", {"node": int(node_id), "tag": tag}, agent=agent)

    def set_field(self, node_id: str | int, field: str, value: str, *, agent: str = "lifeos") -> None:
        # field.add makes the field on the node if it has none; field.set writes the value.
        self.run("field.add", {"node": int(node_id), "field": field}, agent=agent)
        self.run("field.set", {"node": int(node_id), "field": field, "value": str(value), "keep": True}, agent=agent)

    def move(self, node_id: str | int, parent: str | int, *, agent: str = "lifeos") -> None:
        self.run("node.move", {"node": int(node_id), "parent": int(parent)}, agent=agent)
