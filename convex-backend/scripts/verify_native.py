"""Exercise the packaged Swift client with disposable synthetic health records."""
import importlib.util
import json
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location("manage", Path(__file__).with_name("manage.py"))
manage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manage)
app = manage.ROOT.parent / "mac-sync/build/LifeOS Sync.app/Contents/MacOS/LifeOSSync"
token = manage.settings()["LIFEOS_NATIVE_TOKEN"]
dates = ["2098-12-30", "2098-12-31"]


def native(*args, success=True):
    result = subprocess.run([str(app), "--health-check", *args], capture_output=True, text=True, timeout=20)
    assert (result.returncode == 0) == success, "Unexpected native connection result"
    print(result.stdout.strip())


assert manage.request("GET", "/health/days?source=synthetic")[0] == 401
assert manage.request("GET", "/health/days?source=synthetic", token="wrong")[0] == 401
for query in ("limit=0", "limit=91", "limit=abc", "limit=1.5", "source=invalid"):
    path = "/health/days?" + ("source=synthetic&" if not query.startswith("source") else "") + query
    assert manage.request("GET", path, token=token)[0] == 400
for date in dates:
    assert manage.request("GET", f"/health/day?source=synthetic&date={date}", token=token) == (200, None)
try:
    for date, minutes in zip(dates, [390, 420]):
        value = {
            "source": "synthetic", "date": date, "timeZone": "Australia/Melbourne",
            "sleepMinutes": minutes, "sleepEfficiency": 87.5, "steps": 6123,
            "restingHeartRate": 58, "hrv": 41, "spo2": 97, "activeMinutes": 32,
            "respiratoryRate": 14,
            "heartRateSeries": [{"t": f"{date}T02:00:00+11:00", "v": 60}],
            "sleepSessions": [{
                "label": "Synthetic night", "startTime": f"{date}T00:00:00+11:00",
                "endTime": f"{date}T08:00:00+11:00", "minutesAsleep": minutes,
                "minutesInPeriod": 480,
                "stages": [
                    {"type": stage, "startTime": f"{date}T0{i * 2}:00:00+11:00",
                     "endTime": f"{date}T0{(i + 1) * 2}:00:00+11:00"}
                    for i, stage in enumerate(["LIGHT", "DEEP", "REM", "AWAKE"])
                ],
            }],
        }
        assert manage.request("POST", "/health/day", value, token)[0] == 200
    status, days = manage.request("GET", "/health/days?source=synthetic&limit=90", token=token)
    assert status == 200
    own = [day for day in days if day["date"] in dates]
    assert [day["date"] for day in own] == list(reversed(dates))
    native("--health-synthetic")
    # Leave records present only during this optional local visual inspection.
    if "--visual" in __import__("sys").argv:
        subprocess.run(["open", "-n", str(app.parents[2]), "--args",
                        "--desktop-preview", "--health-live", "--health-synthetic"], check=True)
        input("Inspect the labelled synthetic health UI, then press Enter to clean up: ")
    manage.compose("stop", "backend", capture_output=True)
    native(success=False)
finally:
    manage.compose("up", "-d", "--wait", capture_output=True)
    for date in dates:
        manage.convex("run", "health:removeSynthetic", json.dumps({"date": date}), capture_output=True)
native()
for date in dates:
    assert manage.request("GET", f"/health/day?source=synthetic&date={date}", token=token) == (200, None)
print("PASS: recent-days authentication/validation/order, packaged native decoding, offline rejection and cleanup.")
