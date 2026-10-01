import hashlib
import importlib.util
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "setup_native_sync.py"
spec = importlib.util.spec_from_file_location("setup_native", path)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SecureSetup(unittest.TestCase):
    def test_credentials_use_only_stdin_and_dedicated_agent_hash(self):
        key = "SYNTHETIC-agent-key-at-least-32-characters"
        calls = []

        def command(argv, *, data):
            self.assertNotIn(key, " ".join(argv))
            self.assertEqual(data, key.encode())
            calls.append("keychain")

        def native(argv, *, value):
            self.assertNotIn(key, " ".join(argv))
            self.assertNotIn("SYNTHETIC-secret", " ".join(argv))
            if argv[-1] == "LIFEOS_AGENT_KEY_SHA256":
                self.assertEqual(value.strip(), hashlib.sha256(key.encode()).hexdigest())
            calls.append(argv[-1])

        setup.provision(key, "SYNTHETIC-client", "SYNTHETIC-secret", Path("SYNTHETIC-app"), native=native, command=command)
        self.assertEqual(calls, ["keychain", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "LIFEOS_AGENT_KEY_SHA256"])

    def test_agent_does_not_execute_setup_on_import(self):
        self.assertEqual(setup.STAGE, "preflight")


if __name__ == "__main__":
    unittest.main()
