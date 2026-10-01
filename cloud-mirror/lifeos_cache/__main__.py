import argparse
import json
import os
import tempfile
from pathlib import Path
from wsgiref.simple_server import make_server

from .adapter import Adapter, MockThings
from .api import API
from .core import Store


def main():
    parser = argparse.ArgumentParser(description="Loopback LifeOS fixture preview; never runs live Things")
    parser.add_argument("--port", type=int, default=8767)
    args = parser.parse_args()
    tokens = {role: os.environ.get("LIFEOS_" + role.upper() + "_TOKEN", "") for role in ("dot", "reviewer", "adapter")}
    # No secret generation or persistent credential setup in this prototype.
    with tempfile.TemporaryDirectory(prefix="lifeos-fixture-") as directory:
        fixture = json.loads((Path(__file__).parent.parent / "fixtures" / "things.json").read_text())
        store = Store(Path(directory) / "cloud.sqlite")
        things = MockThings(fixture)
        adapter = Adapter(store, things, Path(directory) / "mac.sqlite")
        adapter.sync()
        app = API(store, tokens, adapter.run_once)
        print(f"Synthetic Things preview: http://127.0.0.1:{args.port}; Ctrl+C cleans scratch data.")
        try:
            with make_server("127.0.0.1", args.port, app) as server:
                server.serve_forever()
        finally:
            adapter.close()
            store.close()


if __name__ == "__main__":
    main()
