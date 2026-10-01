"""Read-only Things benchmark. Prints counts, field names and timing only.

Run explicitly with: python3 Tests/test_bulk_reader_parity.py /path/Things3.app
All task data stays in a mode-0700 temporary directory and is removed on exit.
The old inventory brackets the new inventory to reject concurrent edits.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def command(args, **kwargs):
    result = subprocess.run([str(arg) for arg in args], capture_output=True, **kwargs)
    if result.returncode:
        # Automation errors may contain task text. Never print stderr/stdout.
        raise RuntimeError("read-only benchmark command failed; no private output disclosed")
    return result.stdout


def benchmark(app_path):
    os.umask(0o077)
    command(["swift", "build"], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix="lifeos-bulk-parity-") as directory:
        private = Path(directory)
        binary, bulk, classify_script = private / "reader", private / "bulk.scpt", private / "classify.scpt"
        command(["swiftc", "-parse-as-library", "-I", ".build/debug/Modules", "-I", "Sources/CSQLite",
                 "Sources/LifeOSSync/BulkPublicThings.swift", "Tests/BulkThingsReaderTests.swift",
                 *sorted((ROOT / ".build/debug/SyncCore.build").glob("*.o")), "-o", binary], cwd=ROOT)
        command(["/usr/bin/osacompile", "-o", bulk, ROOT / "Resources/things_bulk.applescript"])
        command(["/usr/bin/osacompile", "-o", classify_script, ROOT.parent / "cloud-mirror/lifeos_cache/things_classify.applescript"])

        def classify():
            raw = json.loads(command(["/usr/bin/osascript", classify_script, app_path]))
            classes = {}
            for identifier, name in raw:
                if name in ["project", "«class tspt»"]:
                    kind = "project"
                elif name in ["to do", "«class tslt»", "«class tstk»"]:
                    kind = "todo"
                else:
                    raise RuntimeError("unsupported public class")
                if identifier in classes and classes[identifier] != kind:
                    raise RuntimeError("public class collision")
                classes[identifier] = kind
            return classes

        def old_inventory():
            started = time.monotonic()
            before = classify()
            request = json.dumps(dict(action="inventory", app_path=app_path, allow_write=False, classifications=before)).encode()
            raw = command(["/usr/bin/osascript", "-l", "JavaScript", ROOT.parent / "cloud-mirror/lifeos_cache/things_read.js"], input=request)
            after = classify()
            if before != after:
                raise RuntimeError("public inventory changed during old read")
            return json.loads(raw), time.monotonic() - started

        old, old_seconds = old_inventory()
        output = private / "new.json"
        started = time.monotonic()
        command([binary, bulk, app_path, output])
        new_seconds = time.monotonic() - started
        new = json.loads(output.read_bytes())
        last, bracket_seconds = old_inventory()
        if old != last:
            raise RuntimeError("inventory changed during parity bracket; retry when stable")
        left, right = ({row["id"]: row for row in snapshot["items"]} for snapshot in [old, new])
        differences = {}
        for identifier in left.keys() & right.keys():
            a, b = left[identifier], right[identifier]
            if a["kind"] != b["kind"]:
                differences["kind"] = differences.get("kind", 0) + 1
            for field in a["fields"].keys() | b["fields"].keys():
                if a["fields"].get(field) != b["fields"].get(field):
                    differences[field] = differences.get(field, 0) + 1
        metadata = [key for key in old.keys() | new.keys() if key != "items" and old.get(key) != new.get(key)]
        print(json.dumps(dict(total_records=len(new["items"]), classified_tasks=new["coverage_evidence"]["classified_records"],
                              old_seconds=round(old_seconds, 3), new_seconds=round(new_seconds, 3), bracket_old_seconds=round(bracket_seconds, 3),
                              stable_bracket=True, stable_id_sets_equal=left.keys() == right.keys(),
                              field_mismatch_counts=differences, metadata_mismatch_fields=metadata), sort_keys=True))
        if old != new or new_seconds >= old_seconds:
            raise RuntimeError("canonical parity or speed gate failed")
        print("PASS complete canonical parity and speed gate")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Specify the already-running Things application path for this read-only live test.")
    try:
        benchmark(sys.argv[1])
    except Exception as error:
        print("BLOCKED:", str(error), file=sys.stderr)
        sys.exit(1)
