"""`lifeos`: commands that must not depend on an MCP host.

`lifeos export-journal [--date D]` writes an Anytype journal day to LIFEOS_JOURNAL_DIR (launchd runs it).

`lifeos anytype connect [--url URL] [--pair] [--space ID]` saves an Anytype API key (Keychain on
a Mac, else a 0600 file), picks the LifeOS space, creates the LifeOS types, properties, the Ask
agent tag and the "LifeOS" chat if missing. It never prints the key.

`lifeos chat-agent run|pause|resume` runs the Anytype chat agent (launchd keeps it running) or
flips its kill switch.

`lifeos approve|reject <proposal_id> <revision_hash>` is the fallback when a host does not
render the review card. It needs an interactive terminal and the first 8 characters of the
hash typed by hand, so an agent's non-interactive shell cannot approve its own proposal.
"""

from __future__ import annotations

import argparse
import contextlib
import getpass
import json
import os
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

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


def _chat_agent(args, config) -> int:
    import logging
    import shutil
    import signal
    import threading

    from .anytype_gateway import build_gateway, settings_path
    from .chat_agent import ChatAgent, ChatAgentConfig, default_mcp_command, passthrough_env

    folder = config.database_path.parent
    pause_file = folder / "chat-agent.paused"
    if args.action == "pause":
        folder.mkdir(parents=True, exist_ok=True)
        pause_file.touch()
        print("Chat agent paused: it will skip new messages until `lifeos chat-agent resume`.")
        return 0
    if args.action == "resume":
        pause_file.unlink(missing_ok=True)
        print("Chat agent resumed. Messages sent while it was paused stay unanswered.")
        return 0
    gateway = build_gateway(config.database_path)
    if gateway is None:
        print("lifeos: run `lifeos anytype connect` first.", file=sys.stderr)
        return 1
    codex = os.environ.get("LIFEOS_CODEX_BIN") or shutil.which("codex")
    if not codex:
        print("lifeos: Codex CLI not found; install it or set LIFEOS_CODEX_BIN.", file=sys.stderr)
        return 1
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    mcp_env = {
        **passthrough_env(),
        "LIFEOS_DB_PATH": str(config.database_path), "LIFEOS_JOURNAL_DIR": str(config.journal_dir),
        "LIFEOS_ANYTYPE_CONFIG": str(settings_path(config.database_path)),
    }
    agent = ChatAgent(gateway, gateway.settings.chat_id or gateway.find_or_create_chat(), ChatAgentConfig(
        state_path=folder / "chat-agent.sqlite3", mcp_command=default_mcp_command(), mcp_env=mcp_env,
        codex=codex, codex_home=Path(os.environ["CODEX_HOME"]) if os.environ.get("CODEX_HOME") else None,
        workdir=folder, timeout=float(os.environ.get("LIFEOS_CHAT_AGENT_TIMEOUT", "300")),
        max_per_hour=int(os.environ.get("LIFEOS_CHAT_AGENT_MAX_PER_HOUR", "20")), pause_file=pause_file,
    ))
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    with contextlib.suppress(KeyboardInterrupt):
        agent.run(stop)
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
    agent = commands.add_parser("chat-agent", help="the Anytype chat agent (run, pause, resume)")
    agent.add_argument("action", choices=("run", "pause", "resume"))
    args = parser.parse_args(argv)
    config = parse_runtime_config([])

    if args.command == "chat-agent":
        return _chat_agent(args, config)

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
