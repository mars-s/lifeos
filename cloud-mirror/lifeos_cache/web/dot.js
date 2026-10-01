'use strict';
let credential = '', state = null;
const el = id => document.getElementById(id);
async function request(path, body) {
  const response = await fetch(path, {method:body ? 'POST' : 'GET',headers:{Authorization:'Bearer '+credential,'Content-Type':'application/json'},body:body ? JSON.stringify(body):undefined});
  const value = await response.json();
  if (!response.ok) throw Error(value.error || 'Request failed');
  return value;
}
function node(tag, value, cls) {const n=document.createElement(tag);n.textContent=value;if(cls)n.className=cls;return n;}
async function action(fn) {el('error').textContent='';try{await fn();}catch(error){el('error').textContent=error.message;}}
async function refresh() {
  state=await request('/state');el('workspace').hidden=false;
  const age=state.sync_age_seconds===null?'never':Math.round(state.sync_age_seconds)+'s ago';
  const pending=state.operations.filter(op=>['queued','executing'].includes(op.state)).length;
  el('status').textContent=`Last Things sync: ${age} · ${state.adapter_status==='recent'?'recent snapshot':'Mac offline or snapshot stale'} · ${pending} pending`;
  el('tasks').replaceChildren();el('target').replaceChildren();
  for(const task of state.confirmed) {
    const item=node('div',`${task.fields.title}${task.deleted?' · Deleted (tombstone)':''}`,'item');
    el('tasks').append(item);
    if(!task.deleted){const option=node('option',task.fields.title);option.value=task.id;el('target').append(option);}
  }
  el('operations').replaceChildren();
  for(const op of state.operations) {
    const item=node('div','', 'item');item.append(node('strong',op.state.toUpperCase()));
    const base=op.content.base?.title??'(new task)';
    item.append(node('p',`Title: ${base} → ${op.content.fields.title??'(unchanged)'}`));
    item.append(node('p',`Reviewed timezone: ${op.content.zone}`,'muted'));
    item.append(node('p',`Revision: ${op.revision}`,'muted'));
    if(op.state==='draft')for(const decision of ['approve','reject']) {
      const button=node('button',decision==='approve'?'Approve this revision':'Reject');
      button.onclick=()=>action(async()=>{button.disabled=true;try{await request('/'+decision,{op_id:op.id,revision:op.revision});await refresh();}finally{button.disabled=false;}});item.append(button);
    }
    if(op.state==='queued')item.append(node('p','Pending overlay only. Waiting for Mac reconnect.'));
    if(op.result)item.append(node('pre',JSON.stringify(op.result,null,2)));
    el('operations').append(item);
  }
}
el('dot').onclick=()=>{el('review').hidden=!el('review').hidden;el('dot').setAttribute('aria-expanded',String(!el('review').hidden));};
el('connect').onsubmit=event=>{event.preventDefault();credential=el('token').value;el('token').value='';action(refresh);};
el('edit').onsubmit=event=>{event.preventDefault();action(async()=>{
  const task=state.confirmed.find(task=>task.id===el('target').value);
  if(!task)throw Error('Choose a confirmed task');
  await request('/proposals',{op_id:crypto.randomUUID(),kind:'patch',fields:{title:el('title').value},zone:el('zone').value,target:task.id,base_revision:task.revision});await refresh();
});};
el('refresh').onclick=()=>action(refresh);
el('reconnect').onclick=()=>action(async()=>{await request('/demo/reconnect',{});await refresh();});
