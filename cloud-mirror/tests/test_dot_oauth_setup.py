"""Synthetic-only tests for the user-operated secure entry handoff."""
import importlib.util
import io
import json
import re
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("dot_setup",ROOT/"cloudflare/setup_dot_oauth.py")
setup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class DotSetup(unittest.TestCase):
    def test_reuses_namespace_and_secrets_only_via_stdin(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"config.json"
            config=json.loads((ROOT/"cloudflare/wrangler.jsonc").read_text())
            config["kv_namespaces"]=[]  # Synthetic namespace, independent of live binding.
            path.write_text(json.dumps(config))
            calls=[]
            client="SYNTHETIC-app-client-id"
            secret="SYNTHETIC-app-secret-not-real-at-least-twenty"
            def native(args,**kwargs):
                calls.append((args,kwargs))
                self.assertNotIn(client," ".join(args))
                self.assertNotIn(secret," ".join(args))
                if args==["kv","namespace","list"]:
                    return json.dumps([{"title":setup.NAMESPACE,"id":"a"*32}])
                return "SYNTHETIC native success"
            setup.configure(client,secret,run=native,path=path)
            result=json.loads(path.read_text())
            self.assertEqual(result["main"],"mcp-entry.ts")
            self.assertEqual(result["vars"]["LIFEOS_GITHUB_OWNER_ID"],"71009876")
            self.assertNotIn(secret,path.read_text())
            self.assertNotIn(client,path.read_text())
            self.assertFalse(any("create" in args for args,_ in calls))
            self.assertEqual([kw["value"] for args,kw in calls if args[:2]==["secret","put"]],[client+"\n",secret+"\n"])
            self.assertEqual(calls[-1][0],["deploy","--minify"])

    def test_wrong_worker_target_refused_before_native_operations(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"config.json";path.write_text(json.dumps({"name":"unrelated"}))
            with self.assertRaises(ValueError):
                setup.configure("SYNTHETIC-client","SYNTHETIC-secret-long-enough",path=path,run=lambda *a,**k:self.fail("Unexpected native operation"))

    def test_mismatched_binding_refused_before_credential_transmission(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"config.json";config=json.loads((ROOT/"cloudflare/wrangler.jsonc").read_text());config["kv_namespaces"]=[{"binding":"OAUTH_KV","id":"b"*32}];path.write_text(json.dumps(config))
            def native(args,**kwargs):
                self.assertEqual(args,["kv","namespace","list"])
                return json.dumps([{"title":setup.NAMESPACE,"id":"a"*32}])
            with self.assertRaises(ValueError):
                setup.configure("SYNTHETIC-client","SYNTHETIC-secret-long-enough",path=path,run=native)

    def test_native_wrapper_never_puts_secret_in_argv_or_environment(self):
        def runner(argv,**kwargs):
            self.assertNotIn("SYNTHETIC-secret"," ".join(argv))
            self.assertEqual(kwargs["input"],"SYNTHETIC-secret\n")
            self.assertTrue(kwargs["capture_output"])
            return type("Result",(),{"returncode":0,"stdout":"metadata only"})()
        self.assertEqual(setup.native(["secret","put","GITHUB_CLIENT_SECRET"],value="SYNTHETIC-secret\n",runner=runner),"metadata only")

    def test_browser_grant_adds_only_kv_to_existing_scopes(self):
        def runner(argv,**kwargs):
            self.assertEqual(argv[argv.index("--scopes")+1:],setup.SCOPES)
            self.assertIn("workers_kv:write",argv)
            self.assertNotIn("ai:write",argv)
            self.assertNotIn("offline_access",argv)
            self.assertNotIn("capture_output",kwargs)
            return type("Result",(),{"returncode":0})()
        setup.login_for_kv(runner=runner)

    def test_requested_scopes_supported_by_installed_wrangler(self):
        # This local metadata command neither opens login nor reads credentials.
        listing=setup.native(["login","--scopes-list"])
        available=set(re.findall(r"│\s*([a-z0-9_.-]+:[a-z]+)\s*│",listing))
        self.assertTrue(available, "Wrangler scope metadata unavailable")
        self.assertFalse(set(setup.SCOPES)-available)

    def test_discovery_retries_previous_deployment_then_confirms_resource(self):
        calls=[];pauses=[]
        class Opener:
            def open(self, request, **kwargs):
                calls.append(request.full_url)
                if len(calls)==1:
                    raise HTTPError(request.full_url,401,"Previous version",{},None)
                return io.BytesIO(json.dumps({"resource":setup.ORIGIN+"/mcp"}).encode())
        setup.verify_public_discovery(opener=Opener(),pause=pauses.append)
        self.assertEqual(len(calls),2)
        self.assertEqual(pauses,[1])

    def test_discovery_wrong_resource_is_never_accepted(self):
        class Opener:
            def open(self, *args, **kwargs):
                return io.BytesIO(b'{"resource":"https://unrelated.example/mcp"}')
        with self.assertRaisesRegex(RuntimeError,"resource mismatch"):
            setup.verify_public_discovery(opener=Opener(),pause=lambda _:self.fail("No retry on wrong resource"))

if __name__=="__main__":
    unittest.main()
