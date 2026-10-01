// Fixed supported automation. All cloud input is parsed as data, never code.
function run() {
  ObjC.import('Foundation');
  const raw=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const req=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(raw,$.NSUTF8StringEncoding)));
  const p=req.payload;
  const trash=p&&p.field==='in_trash_list';
  const cloud=p&&p.conflict_policy==='cloud_wins'&&p.version===2;
  if(req.allow_write!==true||!p||!['todo','project'].includes(p.kind)||!['title','status','in_trash_list'].includes(p.field)||(!trash&&typeof p.value!=='string')||!/^[A-Za-z0-9_-]{1,128}$/.test(p.target)||!p.base||p.base.state!=='value'||(!cloud&&p.conflict_policy!=='things_wins')||p.field==='status'&&(p.kind!=='todo'||p.value!=='completed')||trash&&(p.kind!=='todo'||p.value!==true||typeof p.base.value!=='boolean'))throw Error('unsupported typed operation');
  const app=Application(req.app_path);if(!app.running())return JSON.stringify({state:'failed',reason:'automation_denied'});
  let obj,current;
  function receipt(state,reason,after){const r={state};if(reason)r.reason=reason;if(cloud){r.observed_before={state:'value',value:current};if(after!==undefined)r.verified_after={state:'value',value:after};}return JSON.stringify(r);}
  try {
    const inTrash=app.lists.byId('TMTrashListSource').toDos().some(t=>t.id()===p.target);
    if(trash&&inTrash){current=true;return receipt('satisfied',null,true);}
    if(trash&&cloud&&p.recovering===true){current=false;return receipt('uncertain','interrupted_delete',false);}
    if(inTrash)return JSON.stringify({state:'skipped',reason:'target_unavailable'});
    obj=(p.kind==='todo'?app.toDos:app.projects).byId(p.target);
    if(obj.id()!==p.target)return JSON.stringify({state:'skipped',reason:'target_unavailable'});
    current=trash?inTrash:p.field==='title'?obj.name():obj.status();
  }catch(_){return JSON.stringify({state:'failed',reason:'automation_denied'});}
  if(current===p.value)return receipt('satisfied',null,current);
  if(!cloud&&current!==p.base.value)return JSON.stringify({state:'skipped',reason:'things_changed'});
  try {
    if(trash)app.delete(obj);else if(p.field==='title')obj.name=p.value;else obj.status=p.value;
    const after=trash?app.lists.byId('TMTrashListSource').toDos().some(t=>t.id()===p.target):p.field==='title'?obj.name():obj.status();
    return receipt(after===p.value?'applied':'uncertain',after===p.value?null:'verification_failed',after);
  }catch(_){return receipt('uncertain','verification_failed');}
}
