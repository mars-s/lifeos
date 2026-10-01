"""USER-RUN secure activation. The agent must not execute this workflow.

The owner rotates the existing GitHub app credential, enters it at hidden prompts,
and approves native Keychain/Things permissions. Secrets stay in process memory
or app-scoped Keychain. This script never prints native command output.
"""
from __future__ import annotations

import getpass
import hashlib
import importlib.util
import json
import os
import plistlib
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLOUD = HERE.parent / "cloud-mirror/cloudflare"
LABEL = "com.lifeos.workers.mirror"
ORIGIN = "https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev"
STAGE = "preflight"


def run(argv, *, data=None, timeout=180):
    result = subprocess.run(argv, input=data, capture_output=True, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError("Native operation failed. No private diagnostic output is displayed.")
    return result.stdout


def module():
    spec = importlib.util.spec_from_file_location("lifeos_oauth_setup", CLOUD / "setup_dot_oauth.py")
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def old_config():
    path = Path.home() / "Library/Application Support/LifeOSWorkersMirror/config.json"
    if path.is_symlink() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise RuntimeError("Existing private mirror configuration is unavailable.")
    config = json.loads(path.read_text())
    if config.get("origin") != ORIGIN or config.get("backend") != "cloudflare" or config.get("approved_write") is not False:
        raise RuntimeError("Only the existing read-only mirror can be migrated automatically.")
    journal = Path(config["journal"])
    if journal.is_symlink() or journal.stat().st_uid != os.getuid() or journal.stat().st_mode & 0o077:
        raise RuntimeError("Existing private journal is unavailable.")
    return config


def provision(key, client_id, client_secret, binary, *, native, command=run):
    """User-owned runtime only. Tests inject synthetic values and all I/O."""
    command([str(binary), "--store-key"], data=key.encode())
    native(["secret", "put", "GITHUB_CLIENT_ID"], value=client_id + "\n")
    native(["secret", "put", "GITHUB_CLIENT_SECRET"], value=client_secret + "\n")
    native(["secret", "put", "LIFEOS_AGENT_KEY_SHA256"], value=hashlib.sha256(key.encode()).hexdigest() + "\n")


def main():
    global STAGE
    if not sys.stdin.isatty():
        raise RuntimeError("Run this yourself in a secure interactive Terminal.")
    print("This activates title changes and task completion queued by dot.")
    print("Things wins same-field conflicts. Uncertain writes are recorded without replay.")
    print("It installs the native app, backs up/imports the old journal and stops only the old mirror helper.")
    print("No ThingsCloud credentials or new OAuth app are used.")
    if input("Activate this reviewed setup? Type yes: ").strip() != "yes":
        return
    config = old_config()
    plist_path = Path.home() / ("Library/LaunchAgents/" + LABEL + ".plist")
    plist = plistlib.loads(plist_path.read_bytes())
    if plist.get("Label") != LABEL:
        raise RuntimeError("The existing helper identity does not match.")
    native = module().native
    wrangler = json.loads((CLOUD / "wrangler.jsonc").read_text())
    if wrangler.get("name") != "lifeos-read-mirror" or wrangler.get("account_id") != "d0f2ba4b10b5789ddd200648bbf055a7" or wrangler.get("d1_databases", [{}])[0].get("database_id") != "980cb359-5819-4deb-b2c7-c57c446ba6dc":
        raise RuntimeError("The existing deployment target does not match.")
    if not any(b.get("binding") == "OAUTH_KV" and b.get("id") == "104729ae5c99424fb6d293062e0856a3" for b in wrangler.get("kv_namespaces", [])):
        raise RuntimeError("Existing OAuth namespace does not match.")
    print("Rotate the exposed secret in the existing LifeOS cloud mirror reader GitHub app first.")
    print("Keep its Client ID and new secret out of chat. Enter both in the hidden prompts below.")
    client_id = getpass.getpass("Existing GitHub Client ID (hidden): ").strip()
    client_secret = getpass.getpass("New GitHub client secret (hidden): ").strip()
    if not 10 <= len(client_id) <= 128 or not 20 <= len(client_secret) <= 256 or any(c.isspace() for c in client_id + client_secret):
        raise RuntimeError("Credentials are unavailable.")
    STAGE = "app installation"
    source = HERE / "build/LifeOS Sync.app"
    if not source.is_dir():
        raise RuntimeError("Build the reviewed app first with sh mac-sync/build-app.sh.")
    installed = Path("/Applications/LifeOS Sync.app")
    if installed.exists():
        raise RuntimeError("LifeOS Sync is already installed; use the documented recovery path rather than replacing a running agent.")
    shutil.copytree(source, installed)
    binary = installed / "Contents/MacOS/LifeOSSync"
    run(["/usr/bin/codesign", "--verify", "--strict", str(installed)])
    STAGE = "private cloud backup"
    backup_dir = Path.home() / "Library/Application Support/LifeOS/Backups"
    backup_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    if backup_dir.is_symlink() or backup_dir.stat().st_uid != os.getuid() or backup_dir.stat().st_mode & 0o077:
        raise RuntimeError("Private backup directory permissions do not match.")
    with tempfile.NamedTemporaryFile(prefix="before-native-", suffix=".sql", dir=backup_dir, delete=False) as backup:
        backup_path = Path(backup.name)
    native(["d1", "export", "lifeos-read-mirror", "--remote", "--output", str(backup_path)])
    os.chmod(backup_path, 0o600)
    STAGE = "cloud migrations and secure credentials"
    # Existing deployment predates Wrangler's migration ledger. Apply only the
    # additive, idempotent native migration, never rerun its historical schemas.
    native(["d1", "execute", "lifeos-read-mirror", "--remote", "--file", str(CLOUD.parent / "site/drizzle/0002_native_sync.sql")])
    key = secrets.token_urlsafe(48)
    provision(key, client_id, client_secret, binary, native=native)
    del key, client_secret, client_id
    wrangler["vars"]["LIFEOS_WRITES_ENABLED"] = "true"
    (CLOUD / "wrangler.jsonc").write_text(json.dumps(wrangler, indent=2) + "\n")
    native(["deploy", "--minify"])
    STAGE = "read-only journal migration"
    domain = "gui/" + str(os.getuid())
    registered = subprocess.run(["/bin/launchctl", "print", domain + "/" + LABEL], capture_output=True, check=False)
    stopped = registered.returncode == 0
    if stopped:
        run(["/bin/launchctl", "bootout", domain + "/" + LABEL])
    try:
        run([str(binary), "--import-legacy", config["journal"], config["app_path"]])
    except Exception:
        if stopped:
            subprocess.run(["/bin/launchctl", "bootstrap", domain, str(plist_path)], capture_output=True, check=False)
        raise RuntimeError("Journal import did not finish. The original helper was restored; pending uploads must drain before migration.") from None
    STAGE = "native app permission handoff"
    run(["/usr/bin/open", str(installed)])
    print("Native app installed. Approve its normal Things permission if prompted.")
    print("Use its menu to enable Start at login. Reconnect the existing dot app with things:read and things:write.")
    print("The previous read grant stays read-only until you approve that new consent.")
    print("Test with a disposable task, then verify its Mac receipt and Things iPhone sync.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Setup stopped at " + STAGE + ". Secrets and private native output were not displayed.", file=sys.stderr)
        sys.exit(1)
