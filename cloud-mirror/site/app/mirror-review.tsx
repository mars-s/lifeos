"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Circle} from "lucide-react";
import type {Cell,MirrorItem,MirrorOperation} from "@/lib/mirror-store";
type State={confirmed:MirrorItem[];operations:MirrorOperation[];pending_overlay:{id:string;target:string;fields:Record<string,unknown>;state:string}[];last_sync_at:string|null;sync_age_seconds:number|null;plans:{id:string;priority:string;revision:number}[];next_cursor:number|null;total_items:number};
const text=(cell:Cell|undefined)=>cell?.state==="value"?String(cell.value):cell?.state??"unknown";
async function call<T=unknown>(action:string,body?:unknown):Promise<T> {
  const response=await fetch("/api/mirror/"+action,{method:body?"POST":"GET",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  const data=await response.json() as {error?:string};if(!response.ok)throw Error(data.error??"Refresh before retrying.");return data as T;
}
export default function MirrorReview({onSample}:{onSample:()=>void}) {
  const [open,setOpen]=useState(true);
  const [state,setState]=useState<State|null>(null),[target,setTarget]=useState(""),[field,setField]=useState("title"),[value,setValue]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const attempt=useRef<{signature:string;id:string}|null>(null);
  async function refresh(){setState(await call<State>("state"));}
  useEffect(()=>{let live=true;call<State>("state").then(s=>{if(live)setState(s);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[]);
  async function act(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:"Refresh before retrying.");}finally{setBusy(false);}}
  const selected=state?.confirmed.find(i=>i.id===target),planning=field==="planning_priority";
  return <main className="lifeos-shell"><header className="lifeos-header"><Button className="lifeos-dot" variant="ghost" onClick={()=>setOpen(!open)} aria-label={open?"Collapse mirror review":"Open mirror review"} aria-expanded={open} aria-controls="mirror-workspace"><Circle aria-hidden="true"/></Button><div><h1>LifeOS mirror</h1><p>Last confirmed Things data &amp; reviewed pending changes</p></div><Button variant="outline" onClick={onSample}>Sample sandbox</Button></header><div id="mirror-workspace" hidden={!open}>
    <p className="demo-note">Mac access requires one approved setup. This view starts empty until the first upload. Title and notes are the first supported edit phase; cloud planning priority stays here. It does not become a Things property.</p>
    <div className="section-heading"><p>Last sync: {state?.last_sync_at?new Date(state.last_sync_at).toLocaleString():"Never"}{state?.sync_age_seconds!=null?` · ${Math.floor(state.sync_age_seconds)}s old`:""} · {state?.pending_overlay.length??0} pending or uncertain</p><Button variant="ghost" disabled={busy} onClick={()=>act(refresh)}>Refresh</Button></div>
    <section><h2>Confirmed snapshot</h2>{state?.confirmed.length===0?<p>No mirror uploaded. Sample simulation cannot populate this cache.</p>:null}<p>{state?.confirmed.length??0} of {state?.total_items??0} cached records shown · latest 100 journal entries shown</p>
    {state?.confirmed.map(item=><article className="task-row" key={item.id}><div><p>{text(item.fields.title)} <small>{item.kind}{item.deleted?" · Missing from full supported inventory":""}</small></p><details><summary>Preserved fields &amp; capability gaps</summary><pre>{JSON.stringify(item.fields,null,2)}</pre></details><p>Cloud priority: {state.plans.find(p=>p.id===item.id)?.priority??"normal"}</p></div></article>)}
    {state?.next_cursor!=null?<Button disabled={busy} onClick={async()=>{setBusy(true);try{const next=await call<State>("state?cursor="+state.next_cursor);setState({...next,confirmed:[...state.confirmed,...next.confirmed]});}catch(e){setError(e instanceof Error?e.message:"Refresh before retrying.");}finally{setBusy(false);}}}>Load more cached records</Button>:null}</section>
    <section><h2>Propose one field change</h2><form onSubmit={e=>{e.preventDefault();if(!selected)return;void act(async()=>{
      const input={target,fields:{[field]:value},base_revisions:planning?{}:{[field]:selected.fields[field]?.revision},zone:Intl.DateTimeFormat().resolvedOptions().timeZone,...planning?{planning:true,plan_revision:state?.plans.find(p=>p.id===target)?.revision??0}:{}};
      const signature=JSON.stringify(input);if(attempt.current?.signature!==signature)attempt.current={signature,id:crypto.randomUUID()};
      await call("propose",{...input,id:attempt.current.id});attempt.current=null;
    });}}><label htmlFor="mirror-target">Task or project</label><select id="mirror-target" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose an item</option>{state?.confirmed.filter(i=>!i.deleted).map(i=><option key={i.id} value={i.id}>{text(i.fields.title)}</option>)}</select>
    <label htmlFor="mirror-field">Field</label><select id="mirror-field" value={field} onChange={e=>{setField(e.target.value);setValue(e.target.value==="planning_priority"?"focus":"");}}><option value="title">Title</option><option value="notes">Notes</option><option value="planning_priority">Cloud planning priority</option></select>
    <label htmlFor="mirror-value">Proposed value{planning?" (focus, normal or later)":""}</label><Input id="mirror-value" value={value} onChange={e=>setValue(e.target.value)} required={field!=="notes"}/><Button disabled={busy||!selected||!planning&&selected.fields[field]?.state!=="value"}>Save immutable proposal</Button></form></section>
    <section className="proposals"><h2>Pending overlay &amp; outcomes</h2>{state?.operations.slice().reverse().map(op=><article key={op.id} className="proposal-row"><h3>{op.state}{op.content.planning?" · cloud planning only":""}</h3><div className="change-diff"><p><span>Before</span>{JSON.stringify(op.content.base)}</p><p><span>Proposed</span>{JSON.stringify(op.content.fields)}</p></div><p className="revision">{op.revision}</p>
      {op.state==="draft"?<div className="decision-controls"><Button disabled={busy} onClick={()=>act(()=>call("approve",{id:op.id,revision:op.revision}))}>Approve this revision</Button><Button variant="outline" disabled={busy} onClick={()=>act(()=>call("reject",{id:op.id,revision:op.revision}))}>Reject</Button></div>:null}
      {op.state==="queued"?<p>Pending overlay only. The confirmed snapshot has not changed. Mac helper must reconnect and verify the result.</p>:null}
      {op.result?<pre>{JSON.stringify(op.result,null,2)}</pre>:null}</article>)}</section>
    <footer>Live writes require separate Mac setup approval. Things has no atomic conditional write across iPhone changes; no immediate iPhone sync is promised.</footer></div>{error?<p role="alert" className="feedback error">{error}</p>:null}
  </main>;
}
