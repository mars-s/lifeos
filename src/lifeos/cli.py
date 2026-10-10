"""`lifeos`: human-only commands that must not depend on an MCP host.

`lifeos approve|reject <proposal_id> <revision_hash>` is the fallback when a host does not
render the review card. It needs an interactive terminal and the first 8 characters of the
hash typed by hand, so an agent's non-interactive shell cannot approve its own proposal.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Sequence

from .proposal_store import ProposalStore
from .runtime import parse_runtime_config


def _summary(revision) -> str:
    lines = [f"Proposal {revision.proposal_id}, revision {revision.revision_number} ({revision.state.value})"]
    for domain, changes in (
        ("Things", revision.things_changes),
        ("Calendar", revision.calendar_changes),
        ("Bana", getattr(revision, "bana_changes", ())),
    ):
        for change in changes:
            lines.append(f"  {domain}: {json.dumps(change.to_dict(), ensure_ascii=False)}")
    return "\n".join(lines)


def main(
    argv: Sequence[str] | None = None,
    *,
    ask: Callable[[str], str] = input,
    interactive: Callable[[], bool] = lambda: sys.stdin.isatty() and sys.stdout.isatty(),
) -> int:
    parser = argparse.ArgumentParser(prog="lifeos")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("approve", "reject"):
        command = commands.add_parser(name, help=f"{name} one exact proposal revision")
        command.add_argument("proposal_id")
        command.add_argument("revision_hash")
    args = parser.parse_args(argv)
    config = parse_runtime_config([])

    if not interactive():
        print("lifeos: approval needs a person at an interactive terminal.", file=sys.stderr)
        return 2
    store = ProposalStore(config.database_path)
    revision = store.get_revision(args.proposal_id, args.revision_hash)
    print(_summary(revision))
    typed = ask(f"Type the first 8 characters of the hash to {args.command}: ").strip()
    if typed != args.revision_hash[:8]:
        print("lifeos: hash did not match; nothing changed.", file=sys.stderr)
        return 1
    action = store.approve if args.command == "approve" else store.reject
    print(f"{action(args.proposal_id, args.revision_hash).state.value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
