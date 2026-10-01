import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("worker_setup",Path(__file__).resolve().parents[1]/"cloudflare/setup_mac_sync.py")
setup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class WorkerSetupTests(unittest.TestCase):
    def test_vault_native_generation_and_no_key_in_arguments(self):
        calls=[];key="SYNTHETIC-KEY-at-least-thirty-two-characters"
        def run(argv,**kw):
            calls.append((argv,kw))
            if "list" in argv:return "[]"
            if "create" in argv:return json.dumps({"id":"fixture-item","fields":[{"value":"SYNTHETIC-concealed-output"}]})
            return key
        ref,value=setup.credential("fixture-upload",run=run)
        self.assertTrue(ref.endswith("/fixture-item/password"))
        self.assertEqual(value,key)
        self.assertEqual(len(calls),3)
        self.assertIn("--generate-password=letters,digits,64",calls[1][0])
        self.assertTrue(all(key not in json.dumps(c) for c in calls))

    def test_existing_item_is_reused_and_duplicates_abort_before_read(self):
        calls=[]
        def run(argv,**kw):
            calls.append(argv)
            if "list" in argv:return json.dumps([{"id":"existing-fixture","title":"fixture"}])
            return "SYNTHETIC-KEY-at-least-thirty-two-characters"
        setup.credential("fixture",run=run)
        self.assertFalse(any("create" in c for c in calls))
        with self.assertRaises(setup.Invalid):setup.credential("fixture",run=lambda *a,**k:json.dumps([{"title":"fixture"},{"title":"fixture"}]))

    def test_only_digest_transmitted_to_platform_cli(self):
        key="SYNTHETIC-KEY-at-least-thirty-two-characters";calls=[]
        setup.set_hash("LIFEOS_SYNC_KEY_SHA256",key,run=lambda argv,**kw:calls.append((argv,kw)))
        self.assertEqual(calls[0][1]["input"],hashlib.sha256(key.encode()).hexdigest()+"\n")
        self.assertNotIn(key,json.dumps(calls))
        self.assertIn("secret",calls[0][0]);self.assertIn("put",calls[0][0])

    def test_nonsecret_file_permissions_and_symlink_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            file=Path(tmp)/"config.json"
            setup.write_private(file,b'{"reference":"op://fixture/item/password"}')
            self.assertEqual(file.stat().st_mode&0o777,0o600)
            link=Path(tmp)/"unsafe";link.symlink_to(Path(tmp)/"missing")
            with self.assertRaises(setup.Invalid):setup.write_private(link,b"fixture")
            self.assertTrue(link.is_symlink())

    def test_native_errors_never_expose_output(self):
        class Result:
            returncode=1;stdout="PRIVATE-SYNTHETIC-KEY";stderr="PRIVATE-SYNTHETIC-KEY"
        with self.assertRaises(setup.Invalid) as error:setup.command(["fixture-native"],runner=lambda *a,**k:Result())
        self.assertNotIn("PRIVATE-SYNTHETIC-KEY",str(error.exception))

if __name__=="__main__":unittest.main()
