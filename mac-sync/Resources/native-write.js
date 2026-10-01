// Fixed supported automation. All cloud input is parsed as data, never code.
function run() {
  ObjC.import('Foundation');
  const raw=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const req=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(raw,$.NSUTF8StringEncoding)));
  const p=req.payload;
  const trash=p&&p.field==='in_trash_list';
  const cloud=p&&p.conflict_policy==='cloud_wins'&&p.version===2;
  const smart=p&&p.conflict_policy==='smart_merge_v1'&&p.version===3;
  if(req.allow_write!==true||!p||!['todo','project'].includes(p.kind)||!['title','status','in_trash_list'].includes(p.field)||(!trash&&typeof p.value!=='string')||!/^[A-Za-z0-9_-]{1,128}$/.test(p.target)||!p.base||p.base.state!=='value'||(!cloud&&!smart&&p.conflict_policy!=='things_wins')||smart&&!['explicit_set','derived_patch'].includes(p.intent_kind)||p.field==='status'&&(p.kind!=='todo'||p.value!=='completed')||trash&&(p.kind!=='todo'||p.value!==true||typeof p.base.value!=='boolean'))throw Error('unsupported typed operation');
  let obj,current,observedFields;
  const app=Application(req.app_path);
  function decision(classification){const d={algorithm:'supported_fields_v1',intent_kind:p.intent_kind,classification,base:p.base,local:current===undefined?{state:'unknown',reason:'target_unavailable'}:{state:'value',value:current},desired:p.value};if(smart&&trash&&observedFields)d.observed_fields=observedFields;return d;}
  function receipt(state,reason,after,classification){const r={state};if(reason)r.reason=reason;if(cloud||smart){r.observed_before=smart?decision(classification).local:{state:'value',value:current};if(after!==undefined)r.verified_after={state:'value',value:after};}if(smart)r.merge_decision=decision(classification||'cloud_only');return JSON.stringify(r);}
  if(!app.running())return smart?receipt('failed','automation_denied',undefined,'unavailable'):JSON.stringify({state:'failed',reason:'automation_denied'});
  try {
    const inTrash=app.lists.byId('TMTrashListSource').toDos().some(t=>t.id()===p.target);
    if(trash&&inTrash){current=true;return receipt('satisfied',null,true,'same_value');}
    if(trash&&cloud&&p.recovering===true){current=false;return receipt('uncertain','interrupted_delete',false);}
    if(inTrash)return smart?receipt('skipped','target_unavailable',undefined,'unavailable'):JSON.stringify({state:'skipped',reason:'target_unavailable'});
    obj=(p.kind==='todo'?app.toDos:app.projects).byId(p.target);
    if(obj.id()!==p.target)return smart?receipt('skipped','target_unavailable',undefined,'unavailable'):JSON.stringify({state:'skipped',reason:'target_unavailable'});
    current=trash?inTrash:p.field==='title'?obj.name():obj.status();
    if(smart&&trash)observedFields={title:{state:'value',value:obj.name()},status:{state:'value',value:obj.status()}};
  }catch(_){return smart?receipt('failed','automation_denied',undefined,'unavailable'):JSON.stringify({state:'failed',reason:'automation_denied'});}
  if(smart){
    if(p.recovering===true)return receipt(current===p.value?'satisfied':'uncertain',current===p.value?null:trash?'interrupted_delete':'interrupted_write',current,'interrupted');
    if(trash&&!p.base_fields)throw Error('unsupported typed Trash basis');
    const sameVector=trash&&['title','status'].every(key=>p.base_fields[key]&&p.base_fields[key].state==='value'&&p.base_fields[key].value===observedFields[key].value);
    const classification=current===p.value?'same_value':p.intent_kind==='derived_patch'&&p.value===p.base.value?'no_change':trash?(sameVector&&!p.recorded_divergence?'cloud_only':'delete_edit_cloud_fallback'):current===p.base.value&&!p.recorded_divergence?'cloud_only':'cloud_fallback';
    if(p.prepare_only===true)return receipt('satisfied',null,undefined,classification);
    if(!p.prepared_decision||p.prepared_decision.algorithm!=='supported_fields_v1'||p.prepared_decision.local.state!=='value'||p.prepared_decision.local.value!==current)return receipt('uncertain','verification_failed',current,'interrupted');
    if(classification==='same_value'||classification==='no_change')return receipt('satisfied',null,current,classification);
    if(trash)return receipt('failed','automation_denied',undefined,'unavailable');
  }
  if(current===p.value)return receipt('satisfied',null,current,'same_value');
  if(!cloud&&!smart&&current!==p.base.value)return JSON.stringify({state:'skipped',reason:'things_changed'});
  try {
    if(trash)app.delete(obj);else if(p.field==='title')obj.name=p.value;else obj.status=p.value;
    const after=trash?app.lists.byId('TMTrashListSource').toDos().some(t=>t.id()===p.target):p.field==='title'?obj.name():obj.status();
    return receipt(after===p.value?'applied':'uncertain',after===p.value?null:'verification_failed',after,smart?p.prepared_decision.classification:undefined);
  }catch(_){return receipt('uncertain','verification_failed');}
}
