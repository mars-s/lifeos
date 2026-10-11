"""Local-only Convex lifecycle. Never prints admin keys or native tokens."""
import datetime
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)


def settings():
    env = os.environ.copy()
    for name in (".env", ".env.local"):
        path = ROOT / name
        if path.exists():
            for line in path.read_text().splitlines():
                if "=" in line and not line.startswith("#"):
                    key, value = line.split("=", 1)
                    env[key] = value
    return env


def run(args, **kwargs):
    return subprocess.run(args, cwd=ROOT, env=settings(), check=True, **kwargs)


def compose(*args, **kwargs):
    context = settings().get("LIFEOS_DOCKER_CONTEXT", "desktop-linux")
    return run(["docker", "--context", context, "compose", *args], **kwargs)


def convex(*args, **kwargs):
    return run(["npx", "--no-install", "convex", *args], **kwargs)


def save(path, values):
    # Create privately from the first byte, not after writing.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write("".join(f"{key}={value}\n" for key, value in values.items()))


def request(method, path, value=None, token=None):
    data = json.dumps(value).encode() if value is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request("http://127.0.0.1:3211" + path, data, headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as err:
        return err.code, json.load(err)


def start():
    compose("up", "-d", "--wait")
    if not (ROOT / ".env.local").exists():
        admin = compose("exec", "-T", "backend", "./generate_admin_key.sh",
                        capture_output=True, text=True).stdout.strip()
        if "|" not in admin or "\n" in admin:
            raise RuntimeError("Admin key generation failed")
        save(ROOT / ".env.local", {
            "CONVEX_SELF_HOSTED_URL": "http://127.0.0.1:3210",
            "CONVEX_SELF_HOSTED_ADMIN_KEY": admin,
            "LIFEOS_NATIVE_TOKEN": secrets.token_hex(32),
            "LIFEOS_DOCKER_CONTEXT": settings().get("LIFEOS_DOCKER_CONTEXT", "desktop-linux"),
        })
    # The CLI reads a value from stdin when the value argument is omitted.
    convex("env", "set", "LIFEOS_NATIVE_TOKEN",
           input=settings()["LIFEOS_NATIVE_TOKEN"], text=True, capture_output=True)
    convex("dev", "--once")
    print("LifeOS backend ready on loopback. No external accounts or records imported.")


def verify():
    token = settings()["LIFEOS_NATIVE_TOKEN"]
    date = "2099-01-01"
    path = f"/health/day?source=synthetic&date={date}"
    assert request("GET", path)[0] == 401
    assert request("GET", path, token="wrong")[0] == 401
    # Never overwrite even a previously created synthetic fixture.
    assert request("GET", path, token=token) == (200, None)
    payload = {"source": "synthetic", "date": date, "timeZone": "Australia/Melbourne",
               "steps": 123, "sleepMinutes": 420}
    try:
        assert request("POST", "/health/day", payload, token)[0] == 200
        status, row = request("GET", path, token=token)
        assert status == 200 and row["steps"] == 123 and row["sleepMinutes"] == 420
        payload["steps"] = 456
        del payload["sleepMinutes"]
        assert request("POST", "/health/day", payload, token)[0] == 200
        status, updated = request("GET", path, token=token)
        assert updated["_id"] == row["_id"] and updated["steps"] == 456
        assert "sleepMinutes" not in updated
        compose("restart", "backend", capture_output=True)
        compose("up", "-d", "--wait", capture_output=True)
        assert request("GET", path, token=token)[1]["steps"] == 456
        assert request("POST", "/health/day", {**payload, "date": "bad"}, token)[0] == 400
        # Internal functions must not be reachable through the unauthenticated public API.
        req = urllib.request.Request(
            "http://127.0.0.1:3210/api/query",
            json.dumps({"path": "health:get", "args": [{"source": "synthetic", "date": date}],
                        "format": "json"}).encode(),
            {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.load(response)
                assert result.get("status") != "success"
        except urllib.error.HTTPError:
            pass
    finally:
        convex("run", "health:removeSynthetic", json.dumps({"date": date}), capture_output=True)
    assert request("GET", path, token=token) == (200, None)
    print("PASS: auth denial, synthetic write/read/update, missing-field replacement,")
    print("restart persistence, invalid input, internal function isolation and cleanup.")


def backup():
    directory = ROOT / "backups"
    directory.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = directory / f"lifeos-{stamp}.zip"
    convex("export", "--path", str(path))
    path.chmod(0o600)
    print("Backup written to the private, gitignored backups directory.")


if __name__ == "__main__":
    actions = {"start": start, "verify": verify, "backup": backup}
    if len(sys.argv) != 2 or sys.argv[1] not in actions:
        raise SystemExit("Usage: python3 scripts/manage.py start|verify|backup")
    try:
        actions[sys.argv[1]]()
    except subprocess.CalledProcessError:
        # Captured command output can contain credentials. Do not echo it.
        raise SystemExit("Command failed. No secret-bearing output was printed.")
