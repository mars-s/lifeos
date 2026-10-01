// Fixed supported automation. All cloud input is parsed as data, never code.
function run() {
  ObjC.import('Foundation');
  const raw=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const req=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(raw,$.NSUTF8StringEncoding)));
  const p=req.payload;
  const trash=p&&p.field==='in_trash_list';
  if(req.allow_write!==true||!p||!['todo','project'].includes(p.kind)||!['title','status','in_trash_list'].includes(p.field)||(!trash&&typeof p.value!=='string')||!/^[A-Za-z0-9_-]{1,128}$/.test(p.target)||!p.base||p.base.state!=='value'||p.conflict_policy!=='things_wins'||p.field==='status'&&(p.kind!=='todo'||p.value!=='completed')||trash&&(p.kind!=='todo'||p.value!==true||typeof p.base.value!=='boolean'))throw Error('unsupported typed operation');
  const app=Application(req.app_path);if(!app.running())return JSON.stringify({state:'failed',reason:'automation_denied'});
  let obj,current;
  try {
    obj=(p.kind==='todo'?app.toDos:app.projects).byId(p.target);
    if(obj.id()!==p.target)return JSON.stringify({state:'skipped',reason:'target_unavailable'});
    const inTrash=app.lists.byId('TMTrashListSource').toDos().some(t=>t.id()===p.target);
    if(inTrash&&!trash)return JSON.stringify({state:'skipped',reason:'target_unavailable'});
    current=trash?inTrash:p.field==='title'?obj.name():obj.status();
  }catch(_){return JSON.stringify({state:'failed',reason:'automation_denied'});}
  if(current===p.value)return JSON.stringify({state:'satisfied'});
  if(current!==p.base.value)return JSON.stringify({state:'skipped',reason:'things_changed'});
  try {
    if(trash)app.delete(obj);else if(p.field==='title')obj.name=p.value;else obj.status=p.value;
    const after=trash?app.lists.byId('TMTrashListSource').toDos().some(t=>t.id()===p.target):p.field==='title'?obj.name():obj.status();
    return JSON.stringify(after===p.value?{state:'applied'}:{state:'uncertain',reason:'verification_failed'});
  }catch(_){return JSON.stringify({state:'uncertain',reason:'verification_failed'});}
}
