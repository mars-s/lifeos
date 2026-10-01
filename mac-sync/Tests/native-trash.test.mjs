import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {test} from 'node:test';

const source=new URL('../Resources/native-trash.applescript',import.meta.url).pathname;
test('fixed public Trash writer compiles against the Things dictionary',{skip:process.platform!=='darwin'},()=>{
 const folder=mkdtempSync(join(tmpdir(),'lifeos-trash-compile-'));
 try{execFileSync('/usr/bin/osacompile',['-o',join(folder,'native-trash.scpt'),source],{stdio:'pipe'});}
 finally{rmSync(folder,{recursive:true,force:true});}
});

// Explicit opt-in creates only this test's synthetic tasks and moves them to recoverable Trash.
test('public compiled child handles completed targets, satisfied replay and verification-only recovery',{skip:!process.env.LIFEOS_TRASH_LIVE_APP},()=>{
 const appPath=process.env.LIFEOS_TRASH_LIVE_APP;
 const folder=mkdtempSync(join(tmpdir(),'lifeos-trash-live-')),script=join(folder,'native-trash.scpt');
 const owned=[];
 function jxa(code){return JSON.parse(execFileSync('/usr/bin/osascript',['-l','JavaScript','-e',code],{encoding:'utf8'}));}
 function apply(id,recovering=false){return JSON.parse(execFileSync('/usr/bin/osascript',[script,appPath,id,'cloud_wins','false',String(recovering)],{encoding:'utf8'}));}
 function create(completed){
  const id=jxa(`const app=Application(${JSON.stringify(appPath)});const t=app.ToDo({name:"LifeOS native public Trash regression fixture"});app.toDos.push(t);const id=t.id();if(${completed})app.toDos.byId(id).status="completed";JSON.stringify(id);`);
  owned.push(id);return id;
 }
 try{
  execFileSync('/usr/bin/osacompile',['-o',script,source],{stdio:'pipe'});
  const completed=create(true);
  assert.deepEqual(apply(completed),{state:'applied',observed_before:{state:'value',value:false},verified_after:{state:'value',value:true}});
  assert.equal(apply(completed).state,'satisfied');
  assert.equal(apply(completed,true).state,'satisfied');
  const interrupted=create(false);
  assert.deepEqual(apply(interrupted,true),{state:'uncertain',reason:'interrupted_delete',observed_before:{state:'value',value:false},verified_after:{state:'value',value:false}});
  assert.equal(apply(interrupted).state,'applied');
 }finally{
  for(const id of owned){assert.ok(['applied','satisfied'].includes(apply(id).state));}
  const metadata=jxa(`const app=Application(${JSON.stringify(appPath)});const owned=${JSON.stringify(owned)};const trash=app.lists.byId("TMTrashListSource").toDos().map(t=>t.id());const logbook=app.lists.byId("TMLogbookListSource").toDos().map(t=>t.id());JSON.stringify({count:owned.length,trashed:owned.filter(id=>trash.includes(id)).length,logbook:owned.filter(id=>logbook.includes(id)).length});`);
  assert.deepEqual(metadata,{count:owned.length,trashed:owned.length,logbook:0});
  rmSync(folder,{recursive:true,force:true});
 }
});
