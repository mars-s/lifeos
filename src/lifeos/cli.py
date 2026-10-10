"""`lifeos`: commands that must not depend on an MCP host.

`lifeos export-journal [--date D]` writes an Anytype journal day to LIFEOS_JOURNAL_DIR (launchd runs it).

`lifeos anytype connect [--url URL] [--pair] [--space ID]` saves an Anytype API key (Keychain on
a Mac, else a 0600 file), picks the LifeOS space, creates the LifeOS types, properties, the Ask
agent tag and the "LifeOS" chat if missing. It never prints the key.

`lifeos approve|reject <proposal_id> <revision_hash>` is the fallback when a host does not
render the review card. It needs an interactive terminal and the first 8 characters of the
hash typed by hand, so an agent's non-interactive shell cannot approve its own proposal.
"""

from __future__ import annotations

import argparse
import getpass
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
        ("Anytype", revision.note_changes),
    ):
        for change in changes:
            lines.append(f"  {domain}: {json.dumps(change.to_dict(), ensure_ascii=False)}")
    return "\n".join(lines)


def _anytype_connect(args, config, ask: Callable[[str], str], secret: Callable[[str], str]) -> int:
    from .anytype_gateway import (
        AnytypeGateway,
        AnytypeSettings,
        NotesError,
        NotesUnavailable,
        load_settings,
        pair_api_key,
        save_settings,
        settings_path,
        store_api_key,
    )

    path = settings_path(config.database_path)
    saved = load_settings(path)
    url = args.url or (saved.base_url if saved else None) or AnytypeSettings().base_url
    try:
        if args.pair:
            key = pair_api_key(url, "LifeOS", lambda: ask("Type the 4-digit code Anytype shows: "))
        else:
            key = secret("Paste the API key from Anytype, Settings, API Keys (input hidden): ")
        where = store_api_key(key)
        probe = AnytypeGateway(AnytypeSettings(url, "-"), key_source=lambda: key)
        spaces = probe.spaces()
        if args.space:
            space = next((item for item in spaces if args.space in {item["id"], item["name"]}), None)
        else:
            for number, item in enumerate(spaces, 1):
                print(f"  {number}. {item['name']}")
            choice = ask("Which space should LifeOS use? Number: ").strip()
            space = spaces[int(choice) - 1] if choice.isdigit() and 0 < int(choice) <= len(spaces) else None
        if space is None:
            print("lifeos: no such space; nothing else changed.", file=sys.stderr)
            return 1
        notes = AnytypeGateway(AnytypeSettings(url, space["id"]), key_source=lambda: key)
        made = notes.ensure_schema()
        chat_id = notes.find_or_create_chat()
    except (NotesUnavailable, NotesError, ValueError, RuntimeError) as error:
        print(f"lifeos: {error}", file=sys.stderr)
        return 1
    save_settings(path, AnytypeSettings(url, space["id"], chat_id))
    print(json.dumps({
        "space": space["name"], "space_id": space["id"], "base_url": url, "chat_id": chat_id,
        "key_saved_in": where, "settings": str(path), "created": made,
    }, indent=2))
    return 0


def main(
    argv: Sequence[str] | None = None,
    *,
    ask: Callable[[str], str] = input,
    secret: Callable[[str], str] = getpass.getpass,
    interactive: Callable[[], bool] = lambda: sys.stdin.isatty() and sys.stdout.isatty(),
) -> int:
    parser = argparse.ArgumentParser(prog="lifeos")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("approve", "reject"):
        command = commands.add_parser(name, help=f"{name} one exact proposal revision")
        command.add_argument("proposal_id")
        command.add_argument("revision_hash")
    export = commands.add_parser("export-journal", help="write an Anytype journal day to the journal folder")
    export.add_argument("--date", help="YYYY-MM-DD (default: today)")
    anytype = commands.add_parser("anytype", help="set up the Anytype notebook").add_subparsers(
        dest="anytype_command", required=True)
    connect = anytype.add_parser("connect", help="save the API key and choose the LifeOS space")
    connect.add_argument("--url", help="Local API base URL (default: Anytype Desktop, 127.0.0.1:31009)")
    connect.add_argument("--pair", action="store_true", help="pair with a 4-digit code instead of pasting a key")
    connect.add_argument("--space", help="space id or name (default: ask)")
    args = parser.parse_args(argv)
    config = parse_runtime_config([])

    if args.command == "anytype":
        if not interactive():
            print("lifeos: connecting Anytype needs a person at an interactive terminal.", file=sys.stderr)
            return 2
        return _anytype_connect(args, config, ask, secret)

    if args.command == "export-journal":
        from .anytype_gateway import build_gateway
        from .brain_dump_store import BrainDumpStore
        from .service import LifeOSService

        # Only Anytype and the journal folder: no Things or Calendar access is needed.
        service = LifeOSService(
            ProposalStore(config.database_path), None, None,
            BrainDumpStore(config.database_path, config.journal_dir),
            anytype=build_gateway(config.database_path),
        )
        print(json.dumps(service.export_journal(args.date)))
        return 0

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
