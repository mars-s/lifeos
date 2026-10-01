import subprocess
import unittest
from unittest.mock import patch
from lifeos_cache.core import Invalid
from lifeos_cache.credentials import load_worker_credential
from lifeos_cache.mac_helper import ConfiguredWorkerGateway, SiteGateway


class WorkerTransportTests(unittest.TestCase):
    def config(self):
        return {"backend":"cloudflare","origin":"https://fixture.invalid","credential_provider":"1password",
                "onepassword":{"account":"fixture.1password.test","sync_ref":"op://fixture-vault/LifeOS fixture/password"}}

    def test_one_reference_native_read_without_secret_files(self):
        calls=[]
        def run(argv,**kwargs):
            calls.append((argv,kwargs))
            return subprocess.CompletedProcess(argv,0,"synthetic-key-with-at-least-thirty-two-characters","")
        self.assertTrue(load_worker_credential(self.config(),runner=run).startswith("synthetic"))
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0][0][1],"read")
        self.assertEqual(calls[0][1]["stdin"],subprocess.DEVNULL)

    def test_invalid_reference_and_expired_budget_do_not_read(self):
        for ref in ["plaintext", "op://v/i", "op://v/i/f?otp", "op://v//f"]:
            c=self.config();c["onepassword"]["sync_ref"]=ref
            with self.assertRaises(Invalid):load_worker_credential(c,runner=lambda *a,**k:self.fail("no secret read"))
        with self.assertRaises(Invalid):load_worker_credential(self.config(),deadline=1,runner=lambda *a,**k:self.fail("no secret read"))

    def test_lazy_one_role_loading_and_no_dispatcher_header(self):
        calls=[]
        def loader(config,**kw):
            calls.append(kw);return "synthetic-key-with-at-least-thirty-two-characters"
        g=ConfiguredWorkerGateway(self.config(),loader=loader)
        self.assertEqual(calls,[])
        with patch.object(SiteGateway,"request",return_value={}):
            g.request("begin",{});g.request("page",{})
        self.assertEqual(len(calls),1)
        self.assertEqual(set(g.headers()),{"X-LifeOS-Sync-Key","Content-Type","User-Agent"})
        self.assertEqual(g.headers()["User-Agent"],"LifeOSReadOnlyMirror/0.1")
        for action in ["claim","ack","approve","exec"]:
            with self.assertRaises(Invalid):g.request(action,{})

    def test_write_enabled_configuration_rejected(self):
        c=self.config();c["approved_write"]=True
        with self.assertRaises(Invalid):ConfiguredWorkerGateway(c)

    def test_denial_does_not_expose_native_output(self):
        with self.assertRaises(Invalid) as error:
            load_worker_credential(self.config(),runner=lambda *a,**k:subprocess.CompletedProcess([],1,"","private-fixture-secret"))
        self.assertNotIn("private-fixture-secret",str(error.exception))

if __name__=="__main__":unittest.main()
