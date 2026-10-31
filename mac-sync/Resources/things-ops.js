// Fixed public Things dictionary boundary. Values arrive on stdin as JSON.
// No URL auth-token storage pattern exists in this app. Checklist, evening and
// heading placement are refused before writing, rather than silently dropped.
// JXA command spellings mirror the documented AppleScript dictionary; command
// bridging, especially schedule/restore, still needs verification on a Mac.
function run() {
  ObjC.import('Foundation');
  const raw=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const req=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(raw,$.NSUTF8StringEncoding)));
  const p=req.payload, app=Application(req.app_path), val=value=>({state:'value',value}), absent=()=>({state:'absent'}), unsupported=()=>({state:'unsupported'});
  if(req.allow_write!==true||!p||p.version!==4||p.protocol!=='things_ops_v1'||!['todo','project'].includes(p.kind)||!['read','write','finish_create'].includes(p.v4_action))throw Error('invalid operation');
  const f=p.fields||{}, container=p.container;
  function out(value){return JSON.stringify(value);}
  if(!app.running())return out({reason:'automation_denied'});
  // Validate the complete operation before changing any field.
  if(f.checklist!==undefined||f.when==='evening')return out({reason:'unsupported_by_things'});
  if(container&&container.type==='heading')return out({reason:'container_unavailable'});
  function civil(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
  function date(s){const d=new Date(s+'T12:00:00');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(d.getTime())||civil(d)!==s)throw Error('invalid date');return d;}
  function cell(fn,convert){try{const v=fn();return v===null||v===undefined?absent():val(convert?convert(v):v);}catch(_){return {state:'unknown'};}}
  const listIDs={Inbox:'TMInboxListSource',Today:'TMTodayListSource',Anytime:'TMNextListSource',Someday:'TMSomedayListSource',Trash:'TMTrashListSource',Logbook:'TMLogbookListSource'};
  function list(name){return app.lists.byId(listIDs[name]);}
  function inList(name,id){return list(name).toDos().some(o=>o.id()===id);}
  function destination(){
    if(!container)return null;
    let dest;
    if(container.type==='inbox')dest=list('Inbox');
    else if(container.type==='none')dest=list('Anytime');
    else if(container.type==='area')dest=app.areas.byId(container.id);
    else if(container.type==='project')dest=app.projects.byId(container.id);
    else throw Error('container unavailable');
    // Force resolution before make or any property write.
    dest.id();return dest;
  }
  let dest;
  try{dest=destination();}catch(_){return out({reason:'container_unavailable'});}
  const id=p.created_id||p.target;
  let obj;
  if(p.op!=='create'||p.created_id){
    try{
      // Trash members are not necessarily in the top-level to-do collection.
      obj=p.kind==='project'?app.projects.byId(id):app.toDos.byId(id);
      // Completed items may only resolve through Logbook; reopening them is
      // supported. Resolve Trash explicitly for restore and satisfied deletes.
      let found=false;
      try{found=obj.id()===id;}catch(_){}
      for(const name of (p.op==='restore'||p.op==='trash'?['Trash','Logbook']:['Logbook'])){
        if(found&&name==='Logbook')continue;
        const collection=p.kind==='project'?list(name).projects():list(name).toDos();
        const member=collection.find(o=>o.id()===id);
        if(member){obj=member;found=true;}
      }
      if(!found||obj.id()!==id)throw Error('missing');
      if(p.op!=='restore'&&p.op!=='trash'&&inList('Trash',id))return out({reason:'target_unavailable'});
    }catch(_){return out({reason:'target_unavailable'});}
  }
  function read(){
    if(!obj)return {};
    const fields={title:cell(()=>obj.name()),notes:cell(()=>obj.notes()),deadline:cell(()=>obj.dueDate(),civil),
      activation_date:cell(()=>obj.activationDate(),civil),tags:cell(()=>obj.tags(),tags=>tags.map(t=>t.name())),
      status:cell(()=>obj.status()),area_id:cell(()=>obj.area(),o=>o.id()),
      checklist:unsupported(),heading_id:unsupported(),evening:unsupported()};
    if(p.kind==='todo')fields.project_id=cell(()=>obj.project(),o=>o.id());
    fields.in_trash_list=cell(()=>inList('Trash',obj.id()));
    // Today is public list placement; the evening subsection is unsupported.
    fields.when=unsupported();
    const activation=fields.activation_date;
    if(inList('Someday',obj.id()))fields.when=val('someday');
    else if(inList('Today',obj.id()))fields.when=val('today');
    else if(activation.state==='value')fields.when=val(activation.value===civil(new Date())?'today':activation.value);
    else if(activation.state==='absent'&&!inList('Today',obj.id()))fields.when=val('anytime');
    const project=fields.project_id, area=fields.area_id;
    if(project&&project.state==='value')fields.container=val({type:'project',id:project.value});
    else if(area.state==='value')fields.container=val({type:'area',id:area.value});
    else if(area.state==='absent'&&(!project||project.state==='absent')&&(p.kind==='project'||inList('Inbox',obj.id())))fields.container=val({type:p.kind==='project'?'none':'inbox'});
    else fields.container={state:'unknown'};
    return fields;
  }
  if(p.v4_action==='read')return out({fields:read()});
  function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
  if(p.v4_action==='write'&&obj&&p.expected_before){
    const now=read();
    if(Object.keys(p.expected_before).some(k=>canonical(now[k])!==canonical(p.expected_before[k])))
      return out({state:p.conflict_policy==='things_wins'?'skipped':'uncertain',reason:p.conflict_policy==='things_wins'?'things_changed':'verification_failed'});
  }
  // Read-back is deliberately a separate invocation so Swift can persist a new
  // ID immediately after make, even if a later setter or verification fails.
  if(p.op==='create'&&p.v4_action==='write'){
    const props={name:f.title};
    if(f.notes!==undefined)props.notes=f.notes;
    if(f.deadline!==undefined&&f.deadline!==null)props.dueDate=date(f.deadline);
    if(f.tags!==undefined)props.tagNames=f.tags.join(',');
    // Return immediately after make. Remaining properties are applied by the
    // 'finish_create' request after the ID is durable in the Swift journal.
    obj=app.make({new:p.kind==='todo'?'to do':'project',withProperties:props});
    return out({created_id:obj.id()});
  }
  if(p.op==='trash'){app.delete(obj);return out({});}
  if(p.op==='restore'){
    try{app.move(obj,{to:list('Inbox')});return out({});}
    catch(_){return out({reason:'unsupported_by_things'});}
  }
  if(p.op==='set_status')obj.status=p.status;
  if((p.op==='move'||p.v4_action==='finish_create')&&dest){
    // Parent setters are Things-documented. Clearing via JXA null is a bridge
    // assumption and must be verified; never delete the parent object itself.
    if(container.type==='area')obj.area=dest;
    else if(container.type==='project')obj.project=dest;
    else if(container.type==='none')obj.area=null;
    else app.move(obj,{to:dest});
  }
  if(p.op==='update'||p.v4_action==='finish_create'){
    if(f.title!==undefined)obj.name=f.title;
    if(f.notes!==undefined)obj.notes=f.notes;
    if(f.deadline!==undefined)obj.dueDate=f.deadline===null?null:date(f.deadline);
    if(f.tags!==undefined)obj.tagNames=f.tags.join(',');
    if(f.when!==undefined){
      if(['today','someday','anytime'].includes(f.when))app.move(obj,{to:list({today:'Today',someday:'Someday',anytime:'Anytime'}[f.when])});
      else app.schedule(obj,{for:date(f.when)});
    }
  }
  return out({});
}
