"""USER-RUN secure setup. The agent must not execute this credential workflow.

1Password itself generates and stores the keys. This local user process consumes
them only in memory, configures SHA256 hashes, then installs approved read-only
sync. No secret is printed, saved in a file, passed in argv, or sent to the agent.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
from urllib.request import Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from lifeos_cache.core import Invalid, encode
from lifeos_cache.mac_helper import Helper, ThingsReader, ConfiguredWorkerGateway, WORKER_USER_AGENT
from lifeos_cache.transport import NoRedirect

ORIGIN = "https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev"
ACCOUNT = "my.1password.eu"
VAULT = "bo6qwibocksylye4kq2cyy3x4m"  # Personal; unrelated vaults never used.
OP = "/opt/homebrew/bin/op"
LABEL = "com.lifeos.workers.mirror"
STAGE = "preflight"

def command(argv, *, input=None, runner=subprocess.run, timeout=120):
    result = runner(argv, input=input, capture_output=True, text=True, timeout=timeout, check=False)
    if result.returncode:
        raise Invalid("Native operation failed; approve/unlock in its normal UI")
    return result.stdout  # Caller consumes inside this user process. Never print.

def credential(title, *, run=command):
    items = json.loads(run([OP, "item", "list", "--account", ACCOUNT, "--vault", VAULT, "--tags", "LifeOSWorkersMirror", "--format", "json"]))
    found = [item for item in items if item.get("title") == title]
    if len(found)>1:
        raise Invalid("Duplicate LifeOS credential items; no item was overwritten")
    if found:
        item_id = found[0]["id"]
    else:
        created = json.loads(run([OP, "item", "create", "--account", ACCOUNT, "--vault", VAULT,
            "--category", "password", "--title", title, "--url", ORIGIN,
            "--tags", "LifeOSWorkersMirror", "--generate-password=letters,digits,64", "--format", "json"]))
        item_id = created["id"]
        del created
    ref = "op://"+VAULT+"/"+item_id+"/password"
    value = run([OP, "read", ref, "--account", ACCOUNT, "--no-newline"]).rstrip("\r\n")
    if not 32<=len(value)<=4096 or any(c in value for c in "\r\n\x00"):
        raise Invalid("Native credential unavailable")
    return ref, value

def set_hash(name, key, *, run=command):
    digest = hashlib.sha256(key.encode()).hexdigest()
    # Only a digest goes to the platform CLI stdin; never the access key itself.
    # Wrangler requires a .log path. Native diagnostic output goes to the null
    # device through a private temporary link; no keys or diagnostics persist.
    with tempfile.TemporaryDirectory(prefix="lifeos-native-log-") as tmp:
        logfile=Path(tmp)/"wrangler.log";logfile.symlink_to("/dev/null")
        argv = ["/usr/bin/env", "WRANGLER_LOG_PATH="+str(logfile), "WRANGLER_SEND_METRICS=false",
            "node", str(ROOT/"cloudflare/node_modules/wrangler/bin/wrangler.js"), "secret", "put", name,
            "--config", str(ROOT/"cloudflare/wrangler.jsonc")]
        run(argv, input=digest+"\n")

def read_cloud(read_key, *, opener=None):
    client = opener or build_opener(NoRedirect())
    cursor=0;items=[];sequence=None
    for _ in range(101):
        request = Request(ORIGIN+"/state?cursor="+str(cursor), headers={"Authorization":"Bearer "+read_key,"User-Agent":WORKER_USER_AGENT})
        with client.open(request, timeout=20) as response:
            raw = response.read(1024*1024+1)
        if len(raw)>1024*1024:
            raise Invalid("Cloud response exceeds budget")
        page = json.loads(raw)
        if sequence is not None and sequence!=page["sequence"]:
            raise Invalid("Inventory changed during comparison")
        sequence=page["sequence"];items.extend(page["confirmed"])
        next_cursor=page["next_cursor"]
        if next_cursor is None:
            if len(items)!=page["total_items"]:
                raise Invalid("Incomplete cloud pagination")
            return page, items
        if not isinstance(next_cursor,int) or next_cursor<=cursor:
            raise Invalid("Invalid cloud pagination")
        cursor=next_cursor
    raise Invalid("Cloud pagination exceeds budget")

def verify_snapshot(helper, read_key):
    row=helper.db.execute("SELECT * FROM uploads WHERE delivered=1 ORDER BY seq DESC LIMIT 1").fetchone()
    if not row:
        raise Invalid("First read-only upload did not finish")
    expected=[i for page in json.loads(row["pages"]) for i in page]
    state, cloud = read_cloud(read_key)
    actual={i["id"]:i for i in cloud if not i["deleted"]}
    if state["sequence"]!=row["seq"] or len(actual)!=len(expected):
        raise Invalid("Cloud inventory count/sequence mismatch")
    for item in expected:
        target=actual.get(item["id"])
        if not target or target["kind"]!=item["kind"]:
            raise Invalid("Cloud inventory identity mismatch")
        for name, cell in item["fields"].items():
            saved=target["fields"].get(name,{})
            if cell["state"]!=saved.get("state") or cell["state"]=="value" and cell["value"]!=saved.get("value"):
                raise Invalid("Cloud field equality mismatch")
    return len(expected)

def write_private(path, value):
    if path.is_symlink() or path.exists() and (path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077):
        raise Invalid("Existing state file has unsafe ownership or permissions")
    temp=path.with_name(path.name+".setup-"+str(os.getpid()))
    fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        with os.fdopen(fd,"wb") as file:
            file.write(value);file.flush();os.fsync(file.fileno())
        os.replace(temp,path)
    finally:
        temp.unlink(missing_ok=True)

def main():
    global STAGE
    if not sys.stdin.isatty():
        raise Invalid("Run this setup yourself in Terminal; do not submit secrets through agent tools")
    os.umask(0o077)
    # Stop before generating keys if the published endpoint is not reachable.
    with build_opener(NoRedirect()).open(Request(ORIGIN+"/health",headers={"User-Agent":WORKER_USER_AGENT}),timeout=20) as r:
        if r.status!=200:
            raise Invalid("Cloud endpoint is not ready")
    state_dir=Path.home()/"Library/Application Support/LifeOSWorkersMirror"
    state_dir.mkdir(parents=True,exist_ok=True,mode=0o700)
    if state_dir.is_symlink() or state_dir.stat().st_uid!=os.getuid() or state_dir.stat().st_mode&0o077:
        raise Invalid("State directory must be private and owned by you")
    config_path=state_dir/"config.json"
    if config_path.is_symlink():
        raise Invalid("Existing helper configuration is a symlink")
    if config_path.exists():
        existing=json.loads(config_path.read_text())
        if existing.get("backend")!="cloudflare" or existing.get("origin")!=ORIGIN or existing.get("approved_write"):
            raise Invalid("Existing helper configuration differs; nothing was overwritten")
    STAGE="1Password native authorization"
    print("Approve the normal 1Password prompt if shown. No key needs copying.")
    sync_ref,sync=credential("LifeOS Workers upload key")
    read_ref,read=credential("LifeOS Workers read key")
    if sync==read:
        raise Invalid("Role credentials must differ")
    STAGE="Cloudflare role-hash configuration"
    set_hash("LIFEOS_SYNC_KEY_SHA256",sync)
    set_hash("LIFEOS_READ_KEY_SHA256",read)
    config={"backend":"cloudflare","origin":ORIGIN,"approved_read":True,"approved_write":False,
        "app_path":"/Users/avi/Documents/apps/Things3.app","journal":str(state_dir/"journal.sqlite3"),
        "credential_provider":"1password","onepassword":{"account":ACCOUNT,"sync_ref":sync_ref},
        "read_ref":read_ref}
    write_private(config_path,(encode(config)+"\n").encode())
    cloud=ConfiguredWorkerGateway(config,loader=lambda *a,**k:sync)
    reader=ThingsReader(config["app_path"],permit_read=True,permit_write=False)
    helper=Helper(config["journal"],cloud,reader)
    try:
        STAGE="supported Things read and first upload"
        outcome=helper.once(wake=True,writes=False)
        if outcome!="synced":
            raise Invalid("Initial upload needs native permission or reconnect; background helper was not installed")
        STAGE="private cloud field comparison"
        count=verify_snapshot(helper,read)
        # Verify independent role identity cannot bypass human review.
        STAGE="duplicate snapshot receipt check"
        row=helper.db.execute("SELECT seq FROM uploads WHERE delivered=1 ORDER BY seq DESC LIMIT 1").fetchone()
        if not cloud.request("commit",{"sequence":row["seq"]}).get("duplicate"):
            raise Invalid("Duplicate acknowledgement mismatch")
    finally:
        helper.close()
    del sync,read
    STAGE="read-only launch-on-login installation"
    agents=Path.home()/"Library/LaunchAgents";agents.mkdir(parents=True,exist_ok=True)
    plist_path=agents/(LABEL+".plist")
    if plist_path.is_symlink():
        raise Invalid("Existing launch helper is a symlink")
    if plist_path.exists():
        existing=plistlib.loads(plist_path.read_bytes())
        if existing.get("Label")!=LABEL or existing.get("ProgramArguments",[])[-1:]!=[str(config_path)]:
            raise Invalid("Existing launch helper differs; nothing was overwritten")
    plist={"Label":LABEL,"ProgramArguments":[sys.executable,"-m","lifeos_cache.mac_helper","--config",str(config_path)],
        "WorkingDirectory":str(ROOT),"RunAtLoad":True,"StartInterval":300,
        "ProcessType":"Background","Nice":10,"LowPriorityIO":True}
    write_private(plist_path,plistlib.dumps(plist))
    domain="gui/"+str(os.getuid())
    # Reuse a registered matching helper; never remove another service.
    registered=subprocess.run(["/bin/launchctl","print",domain+"/"+LABEL],capture_output=True,text=True,check=False)
    if registered.returncode:
        command(["/bin/launchctl","bootstrap",domain,str(plist_path)])
    print("Read-only sync verified for "+str(count)+" supported records. Five-minute background helper installed. Real task writes disabled.")

if __name__=="__main__":
    try:
        main()
    except Exception:
        print("Setup stopped at "+STAGE+". No private diagnostics were printed. Complete its normal authorization or reconnect, then rerun the same command.",file=sys.stderr)
        sys.exit(1)
