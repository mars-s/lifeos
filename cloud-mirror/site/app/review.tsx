"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Circle, Check, RefreshCw, WifiOff } from "lucide-react";
import type { DemoState } from "@/lib/demo-store";
import MirrorReview from "./mirror-review";

async function call<T=unknown>(action:string,body?:unknown):Promise<T> {
  const response=await fetch("/api/demo/"+action,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??"Unable to load the demo. Refresh to try again.");return data as T;
}
export default function Review() {
  const [mirror,setMirror]=useState(true);
  const [state,setState]=useState<DemoState|null>(null), [target,setTarget]=useState("demo-flight"), [title,setTitle]=useState("Confirm flight details");
  const [open,setOpen]=useState(true), [busy,setBusy]=useState(false), [error,setError]=useState(""), [notice,setNotice]=useState("");
  const attempt=useRef<{signature:string;id:string}|null>(null);
  const refresh=useCallback(async()=>{setState(await call<DemoState>("state"));},[]);
  useEffect(()=>{if(mirror)return;let active=true;call<DemoState>("seed",{}).then(data=>{if(active)setState(data);}).catch(error=>{if(active)setError(error.message);});return()=>{active=false;};},[mirror]);
  async function act(action:()=>Promise<unknown>,message:string) {
    setBusy(true);setError("");setNotice("");try{await action();await refresh();setNotice(message);}catch(error){setError(error instanceof Error?error.message:"Request failed. Refresh before retrying.");}finally{setBusy(false);}
  }
  const pending=state?.operations.filter(op=>op.state==="queued").length??0;
  const selected=state?.confirmed.find(t=>t.id===target);
  if(mirror)return <MirrorReview onSample={()=>setMirror(false)}/>;
  return <main className="lifeos-shell">
    <header className="lifeos-header">
      <Button className="lifeos-dot" variant="ghost" onClick={()=>setOpen(!open)} aria-label={open?"Collapse LifeOS review":"Open LifeOS review"} aria-expanded={open} aria-controls="workspace"><Circle aria-hidden="true" /></Button>
      <div><h1>LifeOS</h1><p>Your private cache test</p></div><span className="demo-label">Sample data only</span><Button variant="outline" onClick={()=>setMirror(true)}>Things mirror</Button>
    </header>
    <div className="sync-line" role="status"><span>{state?.adapter_status==="recent"?<Check aria-hidden="true"/>:<WifiOff aria-hidden="true"/>}{state?.adapter_status==="recent"?"Simulated Mac connected":"Simulated Mac offline"}</span><span>{pending} pending</span></div>
    <p className="sync-age">Last sample sync: {state?.last_sync_at?new Date(state.last_sync_at).toLocaleString():"loading"}{state?.sync_age_seconds!=null?` · ${state.sync_age_seconds}s ago`:""}</p>
    <p className="demo-note">This uses synthetic tasks. Things, your iPhone, and Google Calendar are not connected. Approvals change only this demo.</p>
    <div id="workspace" hidden={!open}>
      <section className="tasks-section"><div className="section-heading"><h2>Last confirmed snapshot</h2><Button variant="ghost" onClick={()=>act(refresh,"Snapshot refreshed.")} disabled={busy}><RefreshCw aria-hidden="true"/>Refresh</Button></div>
        {!state&&!error?<p>Loading your sample snapshot…</p>:null}
        {state?.confirmed.map(task=><div className="task-row" key={task.id}><Circle aria-hidden="true"/><div><p>{task.title}</p><small>{task.deleted?"Deleted sample task":task.deadline?`Due ${task.deadline}`:"No deadline"}</small></div></div>)}
      </section>
      <div className="work-columns"><section><h2>Propose a small edit</h2><form onSubmit={event=>{event.preventDefault();if(!selected)return;void act(async()=>{
        const input={target,title,base_title_rev:selected.title_rev,zone:Intl.DateTimeFormat().resolvedOptions().timeZone};
        const signature=JSON.stringify(input);if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
        await call("propose",{...input,id:attempt.current.id});attempt.current=null;
      },"Proposal saved. Review it below before approving.");}}>
        <label htmlFor="task-choice">Sample task</label><Select value={target} onValueChange={setTarget}><SelectTrigger id="task-choice" className="task-select"><SelectValue/></SelectTrigger><SelectContent>{state?.confirmed.filter(t=>!t.deleted).map(t=><SelectItem value={t.id} key={t.id}>{t.title}</SelectItem>)}</SelectContent></Select>
        <label htmlFor="new-title">New title</label><Input id="new-title" value={title} onChange={event=>setTitle(event.target.value)} maxLength={300} required />
        <Button type="submit" disabled={busy||!state||!selected}>{busy?"Saving…":"Save proposal"}</Button>
      </form></section>
      <section className="simulation"><h2>Try reconnect behavior</h2><p>Approved edits wait here while the simulated Mac is offline.</p><div className="simulation-buttons"><Button disabled={busy||!state} onClick={()=>act(()=>call("reconnect",{}),"Simulated reconnect finished. Review each outcome below.")}>Simulate reconnect</Button><Button variant="outline" disabled={busy||!state} onClick={()=>act(()=>call("offline",{}),"The simulated Mac is offline. Approved proposals remain pending.")}>Go offline</Button></div>
        <Button variant="ghost" className="conflict-control" disabled={busy||!selected} onClick={()=>act(()=>call("conflict",{target}),"The mock iPhone changed this title. Reconnect to check for a conflict.")}>Simulate an iPhone title change</Button>
        <p className="limit">Real Things has no atomic conditional write. This demo’s conflict protection is a mock guarantee; live edits remain disabled.</p>
      </section></div>
      <section className="proposals"><h2>Review &amp; outcomes</h2>{state?.operations.length===0?<p className="empty">No proposals yet. Save a title edit to try the approval flow.</p>:null}
        {state?.operations.slice().reverse().map(op=><article className="proposal-row" key={op.id}><div className="proposal-top"><h3>{op.state==="draft"?"Ready for your review":op.state==="queued"?"Pending reconnect":op.state==="applied"?"Applied to sample task":op.state==="rejected"?"Rejected":"Conflict — review again"}</h3><span className={`state-word ${op.state}`}>{op.state}</span></div><div className="change-diff"><p><span>Before</span>{op.content.base.title}</p><p><span>Proposed</span>{op.content.fields.title}</p></div>
          {op.state==="draft"?<div className="decision-controls"><Button disabled={busy} onClick={()=>act(()=>call("approve",{id:op.id,revision:op.revision}),"Approved this exact revision. It is queued for simulated reconnect.")}>Approve this revision</Button><Button variant="outline" disabled={busy} onClick={()=>act(()=>call("reject",{id:op.id,revision:op.revision}),"Proposal rejected. It will not execute.")}>Reject</Button></div>:null}
          {op.state==="queued"?<p>Pending overlay only. The confirmed task above has not changed.</p>:null}
          {op.result?<p className="outcome">{op.state==="applied"?"Confirmed in the synthetic source. No iPhone synchronization is implied.":String(op.result.reason)}</p>:null}
          <details><summary>Reviewed revision &amp; audit</summary><p className="revision">{op.revision}</p><p>Timezone: {op.content.zone}. Content is immutable; a changed proposal requires a new review.</p></details>
        </article>)}
      </section>
      <footer><span>{state?.audit_count??0} persisted audit entries</span><span>Mac service access disabled · live sync disabled</span></footer>
    </div>
    {notice?<p className="feedback" role="status">{notice}</p>:null}{error?<p className="feedback error" role="alert">{error} <Button variant="outline" onClick={()=>act(refresh,"Refreshed.")} disabled={busy}>Retry refresh</Button></p>:null}
  </main>;
}
