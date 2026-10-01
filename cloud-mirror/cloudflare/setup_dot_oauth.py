"""USER-RUN OAuth activation. The agent must not execute credential entry.

GitHub creates the app in the owner's normal browser. This user process accepts
its credentials through hidden Terminal prompts and sends them to native Worker
secret storage via stdin. No secret files, argv, environment values or logs.
"""
from __future__ import annotations
import getpass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener

HERE = Path(__file__).resolve().parent
ORIGIN = "https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev"
ACCOUNT_ID = "d0f2ba4b10b5789ddd200648bbf055a7"
OWNER_GITHUB_ID = "71009876"  # Verified connected owner mars-s; not form-selected.
NAMESPACE = "lifeos-read-mirror-oauth"
# Wrangler appends offline_access itself; it rejects it as a --scopes argument.
SCOPES = ["user:read", "account:read", "workers:write", "workers_scripts:write", "d1:write", "workers_kv:write"]

def login_for_kv(*, runner=subprocess.run):
    # User-operated normal browser grant. Inherit their Terminal so a sign-in
    # link/prompt is visible immediately. No app secret has been entered yet.
    with tempfile.TemporaryDirectory(prefix="lifeos-oauth-login-") as directory:
        log=Path(directory)/"wrangler.log";log.symlink_to("/dev/null")
        args=["/usr/bin/env", "WRANGLER_SEND_METRICS=false", "WRANGLER_LOG_PATH="+str(log),
              "node", str(HERE/"node_modules/wrangler/bin/wrangler.js"), "--config", str(HERE/"wrangler.jsonc"), "login", "--scopes", *SCOPES]
        if runner(args, timeout=300, check=False).returncode:
            raise RuntimeError("Native browser permission grant not completed")

def native(args, *, value=None, runner=subprocess.run):
    with tempfile.TemporaryDirectory(prefix="lifeos-oauth-native-") as directory:
        log = Path(directory)/"wrangler.log"
        log.symlink_to("/dev/null")
        argv = ["/usr/bin/env", "WRANGLER_SEND_METRICS=false", "WRANGLER_LOG_PATH="+str(log),
                "node", str(HERE/"node_modules/wrangler/bin/wrangler.js"), *args,
                "--config", str(HERE/"wrangler.jsonc")]
        result = runner(argv, input=value, capture_output=True, text=True, timeout=180, check=False)
        if result.returncode:
            raise RuntimeError("Native Cloudflare operation failed; use its normal sign-in UI")
        return result.stdout  # Consumed here, never printed.

def configure(client_id, client_secret, *, run=native, path=None):
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,128}", client_id) or not re.fullmatch(r"[A-Za-z0-9_-]{20,256}", client_secret):
        raise ValueError("OAuth app credentials unavailable")
    config_path = path or HERE/"wrangler.jsonc"
    if config_path.is_symlink():
        raise ValueError("Config symlink refused")
    config = json.loads(config_path.read_text())
    if config.get("account_id") != ACCOUNT_ID or config.get("name") != "lifeos-read-mirror" or config.get("d1_databases", [{}])[0].get("database_id") != "980cb359-5819-4deb-b2c7-c57c446ba6dc":
        raise ValueError("Existing Worker target mismatch")
    spaces = json.loads(run(["kv", "namespace", "list"]))
    found = [s for s in spaces if s.get("title") == NAMESPACE]
    if len(found) > 1:
        raise ValueError("Duplicate OAuth namespaces; no resource changed")
    if not found:
        run(["kv", "namespace", "create", NAMESPACE, "--update-config=false"])
        found = [s for s in json.loads(run(["kv", "namespace", "list"])) if s.get("title") == NAMESPACE]
    if len(found) != 1 or not re.fullmatch(r"[a-f0-9]{32}", found[0].get("id", "")):
        raise ValueError("OAuth namespace not confirmed")
    existing = config.get("kv_namespaces", [])
    if any(b.get("binding") == "OAUTH_KV" and b.get("id") != found[0]["id"] for b in existing):
        raise ValueError("Existing OAuth binding mismatch")
    # User-controlled process; neither value enters an agent tool call.
    run(["secret", "put", "GITHUB_CLIENT_ID"], value=client_id+"\n")
    run(["secret", "put", "GITHUB_CLIENT_SECRET"], value=client_secret+"\n")
    config["main"] = "mcp-entry.ts"
    config["vars"]["LIFEOS_GITHUB_OWNER_ID"] = OWNER_GITHUB_ID
    config["kv_namespaces"] = [b for b in existing if b.get("binding") != "OAUTH_KV"]+[{"binding":"OAUTH_KV", "id":found[0]["id"]}]
    config_path.write_text(json.dumps(config, indent=2)+"\n")  # Only public IDs/bindings.
    run(["deploy", "--minify"])

def verify_public_discovery(*, opener=None, pause=time.sleep):
    # The previous version can briefly answer after a successful deployment.
    opener=opener or build_opener()
    for attempt in range(5):
        try:
            with opener.open(Request(ORIGIN+"/.well-known/oauth-protected-resource/mcp",headers={"User-Agent":"LifeOSReadOnlyMirror/0.1"}),timeout=5) as response:
                metadata=json.load(response)
        except (HTTPError, URLError, TimeoutError) as error:
            if isinstance(error, HTTPError):
                error.close()
                if error.code not in {401,404,429,500,502,503,504}:
                    raise
            if attempt==4:
                raise RuntimeError("Published deployment awaiting public discovery") from None
            pause(min(2**attempt,4))
            continue
        if metadata.get("resource") != ORIGIN+"/mcp":
            raise RuntimeError("MCP discovery resource mismatch")
        return

def main():
    if not sys.stdin.isatty():
        raise RuntimeError("Run personally in Terminal; no agent/redirected input")
    permissions=native(["whoami"])
    if "- workers_kv (write)" not in permissions:
        print("Cloudflare needs one normal browser grant: KV write plus the existing Worker/D1 permissions.")
        login_for_kv()
    print("Use the registered LifeOS cloud mirror reader app under mars-s:")
    print("https://github.com/settings/applications/3895657")
    print("Enter its credentials below. They stay hidden and go to native Worker secret storage.")
    client_id = getpass.getpass("GitHub OAuth app Client ID (hidden): ").strip()
    client_secret = getpass.getpass("GitHub OAuth app Client secret (hidden): ").strip()
    configure(client_id, client_secret)
    del client_secret
    # Public discovery checks only. No task data, access key, or manual test.
    try:
        verify_public_discovery()
    except Exception:
        print("Deployment completed; its final discovery check is pending. No credentials need re-entry.")
        print("Ask Codex to verify the published endpoint: "+ORIGIN+"/mcp")
        return
    print("Read-only OAuth endpoint published: "+ORIGIN+"/mcp")
    print("Connect dot using its normal OAuth browser grant. Task writes remain disabled.")

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("OAuth activation did not finish. No credentials are printed. Existing Mac sync configuration is preserved.", file=sys.stderr)
        raise SystemExit(1)
