"""Runtime-only credential reads. No provisioning, secret files or diagnostics."""
from __future__ import annotations

import subprocess
import time

from .core import Invalid


def load_credentials(config, *, runner=subprocess.run, deadline=None):
    """Return two previously provisioned credentials in helper process memory.

    Never call this through an agent tool to inspect live credential values.
    The running helper consumes them directly in its authenticated HTTP client.
    """
    provider = config.get("credential_provider", "keychain")
    if provider == "keychain":
        commands = [["/usr/bin/security", "find-generic-password", "-s", "LifeOSMirror", "-a", account, "-w"]
                    for account in ("dispatcher", "sync")]
    elif provider == "1password":
        settings = config.get("onepassword")
        if not isinstance(settings, dict) or set(settings) != {"account", "dispatcher_ref", "sync_ref"}:
            raise Invalid("1Password requires account and two secret references")
        account = settings["account"]
        if not isinstance(account, str) or not account or any(c.isspace() for c in account) or len(account)>200:
            raise Invalid("Invalid 1Password account identifier")
        parts = []
        for name in ("dispatcher_ref", "sync_ref"):
            ref = settings[name]
            if not isinstance(ref, str) or not ref.startswith("op://") or len(ref)>1000 or any(c in ref for c in "\r\n\x00?#"):
                raise Invalid("Invalid 1Password secret reference")
            path = ref[5:].split("/")
            if len(path)!=3 or any(not component for component in path):
                raise Invalid("Expected vault/item/field secret reference")
            parts.append(path)
        if parts[0][:2] != parts[1][:2] or parts[0][2] == parts[1][2]:
            raise Invalid("Credentials must be separate fields in one LifeOS item")
        commands = [["/opt/homebrew/bin/op", "read", settings[name], "--account="+account, "--no-newline"]
                    for name in ("dispatcher_ref", "sync_ref")]
    else:
        raise Invalid("Unsupported credential provider")
    values = []
    for command in commands:
        try:
            timeout=min(15,deadline-time.monotonic()) if deadline else 15
            if timeout<=0:
                raise ValueError("pass budget exhausted")
            # Secret stdout/stderr remains inside the helper, never a tool result.
            # No shell, file output, force flag, environment export or UI automation.
            result = runner(command, capture_output=True, text=True, stdin=subprocess.DEVNULL,
                            timeout=timeout, check=False)
            value = result.stdout.rstrip("\r\n")
            if result.returncode or not 20<=len(value)<=12000 or any(c in value for c in "\r\n\x00"):
                raise ValueError("unavailable")
            values.append(value)
        except Exception:
            raise Invalid("Credential unavailable; native authorization may be required") from None
    if len(values[1])<32:
        raise Invalid("Application sync credential is too short")
    return tuple(values)


def load_worker_credential(config, *, runner=subprocess.run, deadline=None):
    """Consume one user-provisioned sync credential locally; never provision it."""
    if config.get("credential_provider", "keychain") == "keychain":
        command = ["/usr/bin/security", "find-generic-password", "-s", "LifeOSWorkersMirror", "-a", "sync", "-w"]
    elif config.get("credential_provider") == "1password":
        settings = config.get("onepassword")
        if not isinstance(settings, dict) or set(settings) != {"account", "sync_ref"}:
            raise Invalid("Worker requires account and one sync secret reference")
        account, ref = settings["account"], settings["sync_ref"]
        if not isinstance(account, str) or not account or any(c.isspace() for c in account) or len(account)>200:
            raise Invalid("Invalid 1Password account identifier")
        if not isinstance(ref, str) or not ref.startswith("op://") or len(ref)>1000 or any(c in ref for c in "\r\n\x00?#"):
            raise Invalid("Invalid sync secret reference")
        if len(ref[5:].split("/"))!=3 or any(not p for p in ref[5:].split("/")):
            raise Invalid("Expected vault/item/field reference")
        command = ["/opt/homebrew/bin/op", "read", ref, "--account="+account, "--no-newline"]
    else:
        raise Invalid("Unsupported credential provider")
    try:
        timeout = min(15, deadline-time.monotonic()) if deadline else 15
        if timeout<=0:
            raise ValueError("budget exhausted")
        result = runner(command, capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=timeout, check=False)
        value = result.stdout.rstrip("\r\n")
        if result.returncode or not 32<=len(value)<=4096 or any(c in value for c in "\r\n\x00"):
            raise ValueError("unavailable")
        return value
    except Exception:
        raise Invalid("Sync credential unavailable; native authorization may be required") from None
