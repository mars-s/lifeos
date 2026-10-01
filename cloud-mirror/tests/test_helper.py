import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from lifeos_cache.core import Invalid
from lifeos_cache.mac_helper import ConfiguredSiteGateway, Helper, SiteGateway, ThingsReader


def value(v):
    return {"state":"value","value":v}


class Reader:
    def __init__(self):
        self.items=[{"id":"task","kind":"todo","fields":{"title":value("Old"),"notes":value("Keep"),"unknown_vendor":value(42)}}]
        self.writes=0
        self.fail=False

    def inventory(self):
        return {"items":copy.deepcopy(self.items),"scopes":["todo"],"zone":"Europe/London","coverage":"fixture"}

    def read(self, target, kind):
        return copy.deepcopy(next(i for i in self.items if i["id"]==target))

    def patch(self, content):
        if self.fail:
            raise RuntimeError("fixture failure")
        self.writes+=1
        for k,v in content["fields"].items():
            self.items[0]["fields"][k]=value(v)
        return {"state":"applied"}


class Cloud:
    def __init__(self):
        self.calls=[]
        self.operations=[]
        self.fail_at=None

    def request(self, action, body=None):
        self.calls.append((action,copy.deepcopy(body)))
        if action==self.fail_at:
            self.fail_at=None
            raise OSError("fixture dropped response")
        if action=="pending":
            return copy.deepcopy([o for o in self.operations if o["state"] in {"queued","executing"}])
        if action in {"claim","ack"}:
            op=next(o for o in self.operations if o["id"]==body["id"])
            if action=="claim":
                op["claim"]=body["claim"]
                op["state"]="executing"
            else:
                op["state"]=body["result"]["state"]
                op["result"]=body["result"]
        return {}


def operation(id="op",field="title",base="Old",new="New"):
    return {"id":id,"state":"queued","content":{"target":"task","kind":"todo","fields":{field:new},"base":{field:value(base)},"zone":"Europe/London"}}


class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/"journal.sqlite3"
        self.cloud,self.reader=Cloud(),Reader()
        self.now=1000
        self.helper=Helper(self.path,self.cloud,self.reader,clock=lambda:self.now,jitter=lambda:0)

    def tearDown(self):
        self.helper.close()
        self.tmp.cleanup()

    def test_default_live_adapter_is_gated(self):
        called=[]
        reader=ThingsReader("/fixture/Things.app",runner=lambda *a,**kw:called.append(a))
        with self.assertRaises(Invalid):
            reader.inventory()
        self.assertEqual(called,[])

    def test_fixed_script_structured_stdin_and_no_shell(self):
        calls=[]
        def runner(argv,**kw):
            calls.append((argv,kw))
            return subprocess.CompletedProcess(argv,0,'[]' if argv[1].endswith('.applescript') else '{"items":[]}',"")
        reader=ThingsReader("/fixture/Things.app",permit_read=True,runner=runner)
        self.assertEqual(reader.inventory(),{"items":[]})
        self.assertEqual(len(calls),3)
        argv,kw=calls[1]
        self.assertEqual(argv[:3],["/usr/bin/osascript","-l","JavaScript"])
        self.assertNotIn("shell",kw)
        self.assertEqual(json.loads(kw["input"])["action"],"inventory")
        with self.assertRaises(Invalid):
            reader.patch({"fields":{"deadline":"2026-10-01"}})

    def test_class_probe_dedupes_stable_ids_and_preserves_project_class(self):
        def runner(argv,**kw):
            return subprocess.CompletedProcess(argv,0,'[["task","selected to do"],["task","selected to do"],["project","project"]]',"")
        reader=ThingsReader('/fixture/Things.app',permit_read=True,runner=runner)
        self.assertEqual(reader.classify(),{'task':'todo','project':'project'})

    def test_unknown_or_conflicting_public_class_never_reaches_inventory(self):
        for rows in ['[["id","heading"]]','[["id","to do"],["id","project"]]']:
            calls=[]
            def runner(argv,**kw):
                calls.append(argv)
                return subprocess.CompletedProcess(argv,0,rows,"")
            with self.assertRaises(Invalid):
                ThingsReader('/fixture/Things.app',permit_read=True,runner=runner).inventory()
            self.assertEqual(len(calls),1)

    def test_classification_drift_invalidates_complete_result(self):
        outputs=iter(['[["task","to do"]]','{"items":[]}','[]'])
        reader=ThingsReader('/fixture/Things.app',permit_read=True,runner=lambda argv,**kw:subprocess.CompletedProcess(argv,0,next(outputs),''))
        with self.assertRaises(Invalid):
            reader.inventory()

    def test_incomplete_read_never_stages_pages_or_contacts_cloud(self):
        def incomplete():
            raise Invalid('fixture public list scan failed')
        self.reader.inventory=incomplete
        with self.assertRaises(Invalid):
            self.helper.upload()
        self.assertEqual(self.cloud.calls,[])
        self.assertEqual(self.helper.db.execute('SELECT count(*) FROM uploads').fetchone()[0],0)

    def test_manifest_keeps_public_coverage_evidence(self):
        inventory=self.reader.inventory()
        inventory['coverage_evidence']={'list_ids':['fixture-list'],'classified_records':1,'consistent_passes':2}
        self.reader.inventory=lambda:inventory
        self.helper.upload()
        manifest=next(body['manifest'] for action,body in self.cloud.calls if action=='begin')
        self.assertEqual(manifest['coverage_evidence'],inventory['coverage_evidence'])

    def test_live_test_id_allowlist_blocks_other_targets_before_command(self):
        calls=[]
        reader=ThingsReader("/fixture/Things.app",permit_read=True,permit_write=True,
                            allowed_write_ids=["fixture-only"],runner=lambda *a,**kw:calls.append(a))
        with self.assertRaises(Invalid):
            reader.patch({"target":"personal-task","fields":{"title":"New"}})
        self.assertEqual(calls,[])

    def test_upload_pagination_and_durable_sequence_restart(self):
        self.reader.items=[{"id":str(n),"kind":"todo","fields":{"title":value("Fixture")}} for n in range(205)]
        self.helper.upload()
        pages=[b for a,b in self.cloud.calls if a=="page"]
        self.assertEqual([len(p["items"]) for p in pages],[100,100,5])
        self.helper.close()
        self.helper=Helper(self.path,self.cloud,self.reader)
        self.helper.upload()
        self.assertEqual([b["sequence"] for a,b in self.cloud.calls if a=="commit"],[1,2])
        self.assertEqual(self.path.stat().st_mode & 0o777,0o600)

    def test_interrupted_upload_replays_exact_old_payload_before_new_read(self):
        self.cloud.fail_at="commit"
        with self.assertRaises(OSError):
            self.helper.upload()
        self.reader.items[0]["fields"]["title"]=value("iPhone changed")
        self.helper.upload()
        pages=[b for a,b in self.cloud.calls if a=="page"]
        self.assertEqual(pages[0],pages[1])
        self.helper.upload()
        self.assertEqual([b for a,b in self.cloud.calls if a=="page"][-1]["items"][0]["fields"]["title"],value("iPhone changed"))

    def test_read_only_sync_never_claims(self):
        self.cloud.operations=[operation()]
        self.assertEqual(self.helper.once(),"synced")
        self.assertFalse(any(a=="pending" for a,b in self.cloud.calls))
        self.assertEqual(self.reader.writes,0)

    def test_cross_device_same_field_conflict(self):
        self.cloud.operations=[operation()]
        self.reader.items[0]["fields"]["title"]=value("New iPhone title")
        self.helper.apply(writes=True)
        self.assertEqual(self.cloud.operations[0]["state"],"conflict")
        self.assertEqual(self.reader.writes,0)

    def test_unrelated_fields_preserved_partial_batch(self):
        self.cloud.operations=[operation(),operation("notes","notes","iPhone notes","New notes")]
        self.reader.items[0]["fields"]["notes"]=value("iPhone notes")
        self.helper.apply(writes=True)
        self.assertEqual(self.reader.items[0]["fields"]["unknown_vendor"],value(42))
        self.assertEqual(self.reader.writes,2)
        self.assertTrue(all(o["state"]=="applied" for o in self.cloud.operations))

    def test_crash_after_write_never_replays(self):
        self.cloud.operations=[operation()]
        with self.assertRaises(InterruptedError):
            self.helper.apply(writes=True,crash="after_write")
        self.helper.close()
        self.helper=Helper(self.path,self.cloud,self.reader)
        self.helper.apply(writes=True)
        self.assertEqual(self.reader.writes,1)
        self.assertEqual(self.cloud.operations[0]["state"],"uncertain")

    def test_crash_before_write_conservative_uncertain(self):
        self.cloud.operations=[operation()]
        with self.assertRaises(InterruptedError):
            self.helper.apply(writes=True,crash="before_write")
        self.helper.apply(writes=True)
        self.assertEqual(self.reader.writes,0)
        self.assertEqual(self.cloud.operations[0]["state"],"uncertain")

    def test_receipt_before_ack_replays_without_duplicate_write(self):
        self.cloud.operations=[operation()]
        with self.assertRaises(InterruptedError):
            self.helper.apply(writes=True,crash="before_ack")
        self.helper.apply(writes=True)
        self.assertEqual(self.reader.writes,1)
        self.assertEqual(self.cloud.operations[0]["state"],"applied")

    def test_lost_journal_never_steals_executing_operation(self):
        op=operation()
        op["state"]="executing"
        self.cloud.operations=[op]
        self.helper.apply(writes=True)
        self.assertEqual(self.reader.writes,0)
        self.assertFalse(any(a=="claim" for a,b in self.cloud.calls))

    def test_wake_backoff_and_no_catchup_burst(self):
        self.cloud.fail_at="begin"
        self.assertEqual(self.helper.once(),"retry_later")
        self.now+=10
        count=len(self.cloud.calls)
        self.assertEqual(self.helper.once(wake=True),"idle")
        self.assertEqual(len(self.cloud.calls),count)
        self.now+=20
        self.assertEqual(self.helper.once(wake=True),"synced")
        self.now+=10
        self.assertEqual(self.helper.once(wake=True),"idle")
        self.now+=100000
        before=len([a for a,b in self.cloud.calls if a=="commit"])
        self.assertEqual(self.helper.once(wake=True),"synced")
        self.assertEqual(len([a for a,b in self.cloud.calls if a=="commit"]),before+1)

    def test_unavailable_vault_backoff_prevents_repeated_credential_reads(self):
        calls=[]
        def locked(config,**kw):
            calls.append(config)
            raise Invalid('synthetic vault locked')
        self.helper.cloud=ConfiguredSiteGateway({'origin':'https://fixture.invalid'},loader=locked)
        self.assertEqual(self.helper.once(),'retry_later')
        self.now+=10
        self.assertEqual(self.helper.once(wake=True),'idle')
        self.assertEqual(len(calls),1)
        self.assertEqual(self.helper.db.execute('SELECT failures FROM schedule').fetchone()[0],1)

    def test_transports_no_redirect_and_origin_validation(self):
        with self.assertRaises(Invalid):
            SiteGateway("https://user:pass@example.test","fixture","fixture")
        with self.assertRaises(Invalid):
            SiteGateway("http://example.test","fixture","fixture")


if __name__=="__main__":
    unittest.main()
