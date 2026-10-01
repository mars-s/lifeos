// Fixed public JXA boundary. Never evaluated from cloud-supplied script text.
function run(argv) {
  ObjC.import('Foundation');
  const data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const req=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding))), app=Application(req.app_path);
  if (!app.running()) throw Error('Things must be running; no automatic launch');
  const unsupported=()=>({state:'unsupported'});
  function cell(fn, convert) {
    try { const v=fn(); if(v===null||v===undefined)return {state:'absent'};
      return {state:'value',value:convert?convert(v):v};
    } catch(_) {return {state:'unknown'};}
  }
  const instant=d=>d.toISOString();
  const civil=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const idOf=o=>o.id();
  const groups=[['todo',app.toDos],['project',app.projects],['area',app.areas],['tag',app.tags]];
  function fields(o,kind,index) {
    const f={title:cell(()=>o.name()),collection_index:{state:'value',value:index}};
    if(kind==='todo'||kind==='project')Object.assign(f,{
      notes:cell(()=>o.notes()),deadline:cell(()=>o.dueDate(),civil),activation_date:cell(()=>o.activationDate(),civil),
      status:cell(()=>o.status()),creation_date:cell(()=>o.creationDate(),instant),modification_date:cell(()=>o.modificationDate(),instant),
      completion_date:cell(()=>o.completionDate(),instant),cancellation_date:cell(()=>o.cancellationDate(),instant),
      area_id:cell(()=>o.area(),idOf),tags:cell(()=>o.tags(),a=>a.map(idOf)),
      checklist:unsupported(),reminder:unsupported(),recurrence:unsupported(),heading_id:unsupported(),evening:unsupported(),
    });
    if(kind==='todo')f.project_id=cell(()=>o.project(),idOf);
    if(kind==='area')f.tags=cell(()=>o.tags(),a=>a.map(idOf));
    if(kind==='tag')f.parent_tag_id=cell(()=>o.parentTag(),idOf);
    return f;
  }
  if(req.action==='patch') {
    if(!req.allow_write||!['todo','project'].includes(req.kind))throw Error('write disabled');
    const keys=Object.keys(req.fields);if(keys.length!==1||!['title','notes'].includes(keys[0]))throw Error('only one text field per operation');
    const collection=req.kind==='todo'?app.toDos:app.projects, obj=collection.byId(req.target);
    const key=keys[0], property=key==='title'?'name':'notes';
    if(JSON.stringify(cell(()=>obj[property]()))!==JSON.stringify(req.base[key]))return JSON.stringify({state:'conflict'});
    obj[property]=req.fields[key]; // Supported single property setter; there is no cross-device CAS.
    const after=cell(()=>obj[property]());
    return JSON.stringify({state:after.state==='value'&&after.value===req.fields[key]?'applied':'uncertain',after});
  }
  if(req.action==='read') {
    const pair=groups.find(g=>g[0]===req.kind);if(!pair)throw Error('invalid kind');
    const o=pair[1].byId(req.target);return JSON.stringify({id:o.id(),kind:req.kind,fields:fields(o,req.kind,0)});
  }
  if(req.action!=='inventory')throw Error('unsupported action');
  const classes=req.classifications;
  if(!classes||typeof classes!=='object'||Array.isArray(classes))throw Error('public class probe required');
  const builtinIds=['TMInboxListSource','TMTodayListSource','TMCalendarListSource','TMNextListSource','TMSomedayListSource','TMLogbookListSource','TMTrashListSource'];
  function scan() {
    const rows=new Map(),taskIds=new Set(),listIds=new Set();let edges=0;
    function add(o,kind,index,membership) {
      const id=o.id();if(typeof id!=='string'||!id)throw Error('record ID unavailable');
      if(kind==='todo'||kind==='project') {
        const classified=classes[id];if(!['todo','project'].includes(classified))throw Error('record classification missing');
        if(kind==='project'&&classified!=='project')throw Error('project class mismatch');
        kind=classified;taskIds.add(id);
      }
      let row=rows.get(id);
      if(row&&row.kind!==kind)throw Error('stable ID class collision');
      if(!row){if(rows.size>=10000)throw Error('inventory exceeds safety budget; not truncated');
        row={id,kind,fields:fields(o,kind,index)};rows.set(id,row);
        if(kind==='todo'||kind==='project')row.fields.list_memberships={state:'value',value:[]};
      }
      if(membership) {
        if(++edges>50000)throw Error('membership budget exceeded; not truncated');
        row.fields.list_memberships.value.push(membership);
      }
    }
    for(const [kind,collection] of groups){const objects=collection();for(let n=0;n<objects.length;n++)add(objects[n],kind,n);}
    for(const list of app.lists()) {
      const listId=list.id();if(typeof listId!=='string'||!listId||listIds.has(listId))throw Error('list identity unavailable/duplicate');listIds.add(listId);
      const objects=list.toDos(),withinList=new Set();for(let n=0;n<objects.length;n++) {
        const id=objects[n].id();if(withinList.has(id))throw Error('duplicate stable ID within one list');withinList.add(id);
        add(objects[n],'todo',n,{list_id:listId,index:n});
      }
    }
    // Public AppleScript also enumerates project/area children. Resolve any
    // child absent from list collections by its supported stable-ID accessor.
    for(const id of Object.keys(classes).sort())if(!taskIds.has(id)) {
      const kind=classes[id];if(!['todo','project'].includes(kind))throw Error('unsupported public class');
      add((kind==='project'?app.projects:app.toDos).byId(id),kind,0);
    }
    if(builtinIds.some(id=>!listIds.has(id)))throw Error('required built-in list missing; no complete inventory');
    if(taskIds.size!==Object.keys(classes).length||Object.keys(classes).some(id=>!taskIds.has(id)))throw Error('public class probe coverage changed');
    let bytes=0;const items=Array.from(rows.values()).sort((a,b)=>a.id.localeCompare(b.id));
    for(const row of items) {
      const membership=row.fields.list_memberships;
      if(membership) {
        membership.value.sort((a,b)=>a.list_id.localeCompare(b.list_id));
        row.fields.in_logbook_list={state:'value',value:membership.value.some(m=>m.list_id==='TMLogbookListSource')};
        row.fields.in_trash_list={state:'value',value:membership.value.some(m=>m.list_id==='TMTrashListSource')};
      }
      bytes+=JSON.stringify(row).length*3;if(bytes>8*1024*1024)throw Error('inventory exceeds safety budget; not truncated');
    }
    return {items,list_ids:Array.from(listIds).sort()};
  }
  const first=scan(),second=scan();
  if(JSON.stringify(first)!==JSON.stringify(second))throw Error('public inventory changed while reading; retry later');
  return JSON.stringify({items:first.items,scopes:groups.map(g=>g[0]),zone:Intl.DateTimeFormat().resolvedOptions().timeZone,
    coverage:'public-top-level-and-all-lists-v2',coverage_evidence:{list_ids:first.list_ids,classified_records:Object.keys(classes).length,consistent_passes:2}});
}
