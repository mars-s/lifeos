"""Runtime configuration for the local LifeOS MCP server."""

from __future__ import annotations

import argparse
import ipaddress
import os
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

Transport = Literal["stdio", "streamable-http"]

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 48763
DEFAULT_HTTP_PATH = "/mcp"
LOG_LEVELS = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


def default_database_path() -> Path:
    return Path.home() / "Library" / "Application Support" / "LifeOS" / "lifeos.sqlite3"


def default_journal_dir() -> Path:
    return Path.home() / "Library" / "Application Support" / "LifeOS" / "Journal"


def default_calendar_helper_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "eventkit-bridge"
        / ".build"
        / "release"
        / "lifeos-calendar-helper"
    )


def _is_loopback_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


@dataclass(frozen=True, slots=True)
class RuntimeConfig:
    """Validated process settings for stdio or local Streamable HTTP."""

    transport: Transport = "stdio"
    host: str = DEFAULT_HOST
    port: int = DEFAULT_PORT
    path: str = DEFAULT_HTTP_PATH
    database_path: Path = default_database_path()
    journal_dir: Path = default_journal_dir()
    calendar_helper_path: Path = default_calendar_helper_path()
    log_level: str | None = None
    show_banner: bool = False
    public_base_url: str | None = None
    github_client_id: str | None = None
    github_client_secret: str | None = field(default=None, repr=False)
    github_allowed_login: str | None = None

    def __post_init__(self) -> None:
        if self.transport not in ("stdio", "streamable-http"):
            raise ValueError("transport must be 'stdio' or 'streamable-http'")
        if not _is_loopback_host(self.host):
            raise ValueError("host must be loopback-only: localhost, 127.0.0.1, or ::1")
        if not 1 <= self.port <= 65535:
            raise ValueError("port must be between 1 and 65535")
        if not self.path.startswith("/") or "?" in self.path or "#" in self.path:
            raise ValueError("path must be an absolute URL path without a query or fragment")
        if self.path == "/health":
            raise ValueError(
                "path cannot be /health because LifeOS uses that path for health checks"
            )
        if self.log_level is not None and self.log_level.upper() not in LOG_LEVELS:
            allowed = ", ".join(sorted(LOG_LEVELS))
            raise ValueError(f"log_level must be one of {allowed}")
        oauth_values = (
            self.public_base_url,
            self.github_client_id,
            self.github_client_secret,
            self.github_allowed_login,
        )
        if any(oauth_values) and not all(oauth_values):
            raise ValueError(
                "remote OAuth requires LIFEOS_PUBLIC_BASE_URL, LIFEOS_GITHUB_CLIENT_ID, "
                "LIFEOS_GITHUB_CLIENT_SECRET, and LIFEOS_GITHUB_ALLOWED_LOGIN"
            )
        if self.oauth_enabled:
            if self.transport != "streamable-http":
                raise ValueError("remote OAuth requires the streamable-http transport")
            parsed = urlsplit(self.public_base_url)
            if parsed.scheme != "https" or not parsed.netloc or parsed.path not in ("", "/"):
                raise ValueError("LIFEOS_PUBLIC_BASE_URL must be an HTTPS origin without a path")

    @property
    def oauth_enabled(self) -> bool:
        return all(
            (
                self.public_base_url,
                self.github_client_id,
                self.github_client_secret,
                self.github_allowed_login,
            )
        )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local LifeOS MCP server.")
    parser.add_argument(
        "--transport",
        choices=("stdio", "streamable-http"),
        help="MCP transport. Defaults to LIFEOS_TRANSPORT or stdio.",
    )
    parser.add_argument("--host", help="Loopback bind host for Streamable HTTP.")
    parser.add_argument("--port", type=int, help="Bind port for Streamable HTTP.")
    parser.add_argument("--path", help="MCP HTTP path. Defaults to /mcp.")
    parser.add_argument("--db-path", help="SQLite state path.")
    parser.add_argument("--journal-dir", help="Daily Journal Markdown directory.")
    parser.add_argument("--calendar-helper", help="EventKit helper executable path.")
    parser.add_argument(
        "--log-level",
        choices=sorted(LOG_LEVELS),
        help="FastMCP log level. Defaults to LIFEOS_LOG_LEVEL when set.",
    )
    parser.add_argument(
        "--show-banner",
        action="store_true",
        help="Show FastMCP's startup banner. Keep this off for stdio clients.",
    )
    return parser


def parse_runtime_config(
    argv: Sequence[str] | None = None,
    *,
    environ: Mapping[str, str] | None = None,
) -> RuntimeConfig:
    """Parse CLI and environment settings at the process boundary."""

    args = _parser().parse_args(argv)
    env = os.environ if environ is None else environ

    def setting(argument: str | None, name: str, fallback: str) -> str:
        return argument if argument is not None else env.get(name, fallback)

    def github_client_secret() -> str | None:
        direct = env.get("LIFEOS_GITHUB_CLIENT_SECRET")
        if direct:
            return direct
        secret_path = env.get("LIFEOS_GITHUB_CLIENT_SECRET_FILE")
        if secret_path:
            value = Path(secret_path).expanduser().read_text().strip()
            if not value:
                raise ValueError("LIFEOS_GITHUB_CLIENT_SECRET_FILE is empty")
            return value

        keychain_service = env.get("LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_SERVICE")
        keychain_account = env.get("LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_ACCOUNT")
        if bool(keychain_service) != bool(keychain_account):
            raise ValueError(
                "LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_SERVICE and "
                "LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_ACCOUNT must be set together"
            )
        if not keychain_service:
            return None
        try:
            value = subprocess.run(
                [
                    "/usr/bin/security",
                    "find-generic-password",
                    "-s",
                    keychain_service,
                    "-a",
                    keychain_account,
                    "-w",
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout.strip()
        except subprocess.CalledProcessError as exc:
            raise ValueError("GitHub OAuth secret was not found in macOS Keychain") from exc
        if not value:
            raise ValueError("GitHub OAuth secret in macOS Keychain is empty")
        return value

    try:
        configured_log_level = args.log_level or env.get("LIFEOS_LOG_LEVEL")
        config = RuntimeConfig(
            transport=setting(args.transport, "LIFEOS_TRANSPORT", "stdio"),  # type: ignore[arg-type]
            host=setting(args.host, "LIFEOS_HOST", DEFAULT_HOST),
            port=args.port if args.port is not None else int(env.get("LIFEOS_PORT", DEFAULT_PORT)),
            path=setting(args.path, "LIFEOS_HTTP_PATH", DEFAULT_HTTP_PATH),
            database_path=Path(
                setting(args.db_path, "LIFEOS_DB_PATH", str(default_database_path()))
            ).expanduser(),
            journal_dir=Path(
                setting(args.journal_dir, "LIFEOS_JOURNAL_DIR", str(default_journal_dir()))
            ).expanduser(),
            calendar_helper_path=Path(
                setting(
                    args.calendar_helper,
                    "LIFEOS_CALENDAR_HELPER",
                    str(default_calendar_helper_path()),
                )
            ).expanduser(),
            log_level=configured_log_level.upper() if configured_log_level else None,
            show_banner=args.show_banner,
            public_base_url=env.get("LIFEOS_PUBLIC_BASE_URL"),
            github_client_id=env.get("LIFEOS_GITHUB_CLIENT_ID"),
            github_client_secret=github_client_secret(),
            github_allowed_login=env.get("LIFEOS_GITHUB_ALLOWED_LOGIN"),
        )
        return config
    except (TypeError, ValueError) as exc:
        _parser().error(str(exc))
    raise AssertionError("argparse.error must exit")
