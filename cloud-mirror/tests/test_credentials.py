import subprocess
import unittest
from unittest.mock import patch

from lifeos_cache.core import Invalid
from lifeos_cache.credentials import load_credentials
from lifeos_cache.mac_helper import ConfiguredSiteGateway, SiteGateway


class CredentialTests(unittest.TestCase):
    def config(self):
        return {"credential_provider":"1password", "onepassword":{
            "account":"fixture.1password.test", "dispatcher_ref":"op://fixture-vault/LifeOS fixture/password",
            "sync_ref":"op://fixture-vault/LifeOS fixture/app_sync_key"}}

    def test_1password_reads_only_references_into_process_memory(self):
        calls=[]
        public_fixtures=("synthetic-dispatcher-value-1234567890","synthetic-sync-value-12345678901234567890")
        def run(argv,**kw):
            calls.append((argv,kw))
            return subprocess.CompletedProcess(argv,0,public_fixtures[len(calls)-1],'')
        self.assertEqual(load_credentials(self.config(),runner=run),public_fixtures)
        for argv,kw in calls:
            self.assertEqual(argv[:2],['/opt/homebrew/bin/op','read'])
            self.assertFalse(any(v in arg for v in public_fixtures for arg in argv))
            self.assertNotIn('--force',argv)
            self.assertNotIn('--out-file',argv)
            self.assertNotIn('shell',kw)
            self.assertNotIn('env',kw)
            self.assertEqual(kw['stdin'],subprocess.DEVNULL)
            self.assertEqual(kw['timeout'],15)

    def test_keychain_remains_compatible_without_provisioning(self):
        calls=[]
        def run(argv,**kw):
            calls.append(argv)
            return subprocess.CompletedProcess(argv,0,'synthetic-credential-12345678901234567890\n','')
        load_credentials({},runner=run)
        self.assertEqual([a[-2] for a in calls],['dispatcher','sync'])
        self.assertTrue(all(a[1]=='find-generic-password' for a in calls))

    def test_bad_references_never_invoke_cli(self):
        invalid=['file:///tmp/credential','op://vault/item/field?attribute=otp','op://vault/item/field\n','op://vault/item','op://vault//field']
        for ref in invalid:
            c=self.config();c['onepassword']['dispatcher_ref']=ref
            calls=[]
            with self.assertRaises(Invalid):load_credentials(c,runner=lambda *a,**kw:calls.append(a))
            self.assertEqual(calls,[])

    def test_cross_item_or_same_field_and_plaintext_config_are_rejected(self):
        for change in [{'sync_ref':'op://fixture-vault/Other fixture/app_sync_key'},
                       {'sync_ref':'op://fixture-vault/LifeOS fixture/password'}, {'token':'synthetic-value'}]:
            c=self.config();c['onepassword'].update(change)
            with self.assertRaises(Invalid):load_credentials(c,runner=lambda *a,**kw:self.fail('CLI must not run'))

    def test_native_denial_timeout_empty_and_header_injection_fail_without_diagnostics(self):
        for result in [subprocess.CompletedProcess([],1,'','synthetic-secret-in-stderr'),
                       subprocess.CompletedProcess([],0,'',''),subprocess.CompletedProcess([],0,'synthetic-value\r\nInjected: secret','')]:
            with self.assertRaises(Invalid) as error:load_credentials(self.config(),runner=lambda *a,**kw:result)
            self.assertNotIn('secret',str(error.exception))
        def timeout(*a,**kw):raise subprocess.TimeoutExpired(['synthetic-secret-in-command'],15)
        with self.assertRaises(Invalid) as error:load_credentials(self.config(),runner=timeout)
        self.assertNotIn('secret',str(error.exception))

    def test_unknown_provider_fails_closed(self):
        with self.assertRaises(Invalid):load_credentials({'credential_provider':'plaintext'},runner=lambda *a,**kw:self.fail('CLI must not run'))

    def test_runtime_provider_loads_once_per_pass_and_only_after_request(self):
        calls=[]
        def loader(config,**kw):
            calls.append(kw)
            return ('synthetic-dispatcher-credential','synthetic-application-sync-credential')
        gateway=ConfiguredSiteGateway({'origin':'https://fixture.invalid'},loader=loader)
        self.assertEqual(calls,[])
        with patch.object(SiteGateway,'request',return_value={}):
            gateway.request('begin',{})
            gateway.request('page',{})
            gateway.request('commit',{})
        self.assertEqual(len(calls),1)

    def test_expired_budget_does_not_start_secret_read(self):
        with self.assertRaises(Invalid):
            load_credentials(self.config(),deadline=1,runner=lambda *a,**kw:self.fail('CLI must not run'))


if __name__=='__main__':unittest.main()
