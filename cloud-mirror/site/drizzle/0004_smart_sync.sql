CREATE TABLE IF NOT EXISTS native_changes (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS native_changes_owner ON native_changes(owner,revision);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_changes_bounded BEFORE INSERT ON native_changes
WHEN length(CAST(NEW.payload AS BLOB))>196608
BEGIN SELECT RAISE(ABORT,'projection event too large'); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS native_bases (
  token TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  target TEXT NOT NULL,
  field TEXT NOT NULL,
  revision INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  source TEXT NOT NULL,
  ordinal INTEGER NOT NULL DEFAULT 0,
  cell TEXT NOT NULL,
  target_fields TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(owner,target,field,source,revision,ordinal,sequence,target_fields)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS native_bases_lookup ON native_bases(owner,target,field,source,revision);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS native_reconciliations (
  owner TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  disposition TEXT NOT NULL,
  observed TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  PRIMARY KEY(owner,operation_id)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_reconciliations_immutable BEFORE UPDATE ON native_reconciliations
BEGIN SELECT RAISE(ABORT,'immutable reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_reconciliations_retained BEFORE DELETE ON native_reconciliations
BEGIN SELECT RAISE(ABORT,'reconciliation retained'); END;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS native_bootstrap_pages (
  cursor TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  feed_revision INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  operation_revision INTEGER NOT NULL,
  items TEXT NOT NULL,
  next_cursor TEXT,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO native_bases(token,owner,target,field,revision,sequence,source,cell,target_fields,created_at)
SELECT lower(hex(randomblob(24))),i.owner,i.id,f.key,COALESCE(json_extract(f.value,'$.revision'),1),COALESCE((SELECT sequence FROM mirror_meta WHERE owner=i.owner),0),'confirmed',json_remove(f.value,'$.revision','$.last_known'),json_object('title',json_extract(i.fields,'$.title'),'status',json_extract(i.fields,'$.status'),'in_trash_list',json_extract(i.fields,'$.in_trash_list')),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM mirror_items i,json_each(i.fields) f WHERE i.deleted=0 AND f.key IN ('title','status','in_trash_list') AND json_extract(f.value,'$.state')='value';
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_item_insert AFTER INSERT ON mirror_items
BEGIN
 INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'item',NEW.id,json_object('item',json_object('id',NEW.id,'kind',NEW.kind,'fields',json(NEW.fields),'deleted',NEW.deleted,'observed_at',NEW.observed_at)));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_item_update AFTER UPDATE ON mirror_items
WHEN OLD.fields<>NEW.fields OR OLD.deleted<>NEW.deleted OR OLD.kind<>NEW.kind
BEGIN
 INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'item',NEW.id,json_object('item',json_object('id',NEW.id,'kind',NEW.kind,'fields',json(NEW.fields),'deleted',NEW.deleted,'observed_at',NEW.observed_at)));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_bases_meta_insert AFTER INSERT ON mirror_meta
BEGIN
 INSERT INTO native_bases(token,owner,target,field,revision,sequence,source,cell,target_fields,created_at)
 SELECT lower(hex(randomblob(24))),i.owner,i.id,f.key,COALESCE(json_extract(f.value,'$.revision'),1),NEW.sequence,'confirmed',json_remove(f.value,'$.revision','$.last_known'),json_object('title',json_extract(i.fields,'$.title'),'status',json_extract(i.fields,'$.status'),'in_trash_list',json_extract(i.fields,'$.in_trash_list')),strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM mirror_items i,json_each(i.fields) f WHERE i.owner=NEW.owner AND i.deleted=0 AND f.key IN ('title','status','in_trash_list') AND json_extract(f.value,'$.state')='value'
 AND NOT EXISTS(SELECT 1 FROM native_bases b WHERE b.owner=i.owner AND b.target=i.id AND b.field=f.key AND b.source='confirmed' AND b.revision=COALESCE(json_extract(f.value,'$.revision'),1) AND b.target_fields=json_object('title',json_extract(i.fields,'$.title'),'status',json_extract(i.fields,'$.status'),'in_trash_list',json_extract(i.fields,'$.in_trash_list')));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_bases_meta_update AFTER UPDATE ON mirror_meta
WHEN OLD.sequence<>NEW.sequence
BEGIN
 INSERT INTO native_bases(token,owner,target,field,revision,sequence,source,cell,target_fields,created_at)
 SELECT lower(hex(randomblob(24))),i.owner,i.id,f.key,COALESCE(json_extract(f.value,'$.revision'),1),NEW.sequence,'confirmed',json_remove(f.value,'$.revision','$.last_known'),json_object('title',json_extract(i.fields,'$.title'),'status',json_extract(i.fields,'$.status'),'in_trash_list',json_extract(i.fields,'$.in_trash_list')),strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM mirror_items i,json_each(i.fields) f WHERE i.owner=NEW.owner AND i.deleted=0 AND f.key IN ('title','status','in_trash_list') AND json_extract(f.value,'$.state')='value'
 AND NOT EXISTS(SELECT 1 FROM native_bases b WHERE b.owner=i.owner AND b.target=i.id AND b.field=f.key AND b.source='confirmed' AND b.revision=COALESCE(json_extract(f.value,'$.revision'),1) AND b.target_fields=json_object('title',json_extract(i.fields,'$.title'),'status',json_extract(i.fields,'$.status'),'in_trash_list',json_extract(i.fields,'$.in_trash_list')));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_operation_insert AFTER INSERT ON native_operations
BEGIN
 INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'operation',NEW.id,json_object('operation',json_object('id',NEW.id,'state',NEW.state,'claim',NEW.claim,'ordinal',NEW.ordinal,'payload',json(NEW.payload),'result',json(NEW.result),'created_at',NEW.created_at,'updated_at',NEW.updated_at),'command_changed',json(CASE WHEN NEW.state='queued' THEN 'true' ELSE 'false' END)));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_operation_update AFTER UPDATE ON native_operations
WHEN OLD.state<>NEW.state OR OLD.claim IS NOT NEW.claim OR OLD.result IS NOT NEW.result
BEGIN
 INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'operation',NEW.id,json_object('operation',json_object('id',NEW.id,'state',NEW.state,'claim',NEW.claim,'ordinal',NEW.ordinal,'payload',json(NEW.payload),'result',json(NEW.result),'created_at',NEW.created_at,'updated_at',NEW.updated_at),'command_changed',json(CASE WHEN NEW.state='queued' OR NEW.state='superseded' OR (OLD.state='executing' AND NEW.state<>'executing' AND EXISTS(SELECT 1 FROM native_operations o WHERE o.owner=NEW.owner AND o.state='queued' AND json_extract(o.payload,'$.target')=json_extract(NEW.payload,'$.target'))) THEN 'true' ELSE 'false' END)));
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_desired_insert AFTER INSERT ON native_desired_fields
BEGIN
 INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'desired',NEW.operation_id,json_object('target',NEW.target,'field',NEW.field,'operation_id',NEW.operation_id,'ordinal',NEW.ordinal,'value',json(NEW.value)));
 INSERT OR IGNORE INTO native_bases(token,owner,target,field,revision,sequence,source,ordinal,cell,target_fields,created_at)
 SELECT lower(hex(randomblob(24))),NEW.owner,NEW.target,NEW.field,COALESCE(json_extract(i.fields,'$.'||NEW.field||'.revision'),1),COALESCE((SELECT sequence FROM mirror_meta WHERE owner=NEW.owner),0),'desired',NEW.ordinal,json_object('state','value','value',json(NEW.value)),i.fields,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM mirror_items i WHERE i.owner=NEW.owner AND i.id=NEW.target;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_desired_update AFTER UPDATE ON native_desired_fields
WHEN OLD.operation_id<>NEW.operation_id
BEGIN
 INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'desired',NEW.operation_id,json_object('target',NEW.target,'field',NEW.field,'operation_id',NEW.operation_id,'ordinal',NEW.ordinal,'value',json(NEW.value)));
 INSERT OR IGNORE INTO native_bases(token,owner,target,field,revision,sequence,source,ordinal,cell,target_fields,created_at)
 SELECT lower(hex(randomblob(24))),NEW.owner,NEW.target,NEW.field,COALESCE(json_extract(i.fields,'$.'||NEW.field||'.revision'),1),COALESCE((SELECT sequence FROM mirror_meta WHERE owner=NEW.owner),0),'desired',NEW.ordinal,json_object('state','value','value',json(NEW.value)),i.fields,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM mirror_items i WHERE i.owner=NEW.owner AND i.id=NEW.target;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_desired_delete AFTER DELETE ON native_desired_fields
BEGIN INSERT INTO native_changes(owner,kind,id,payload) VALUES(OLD.owner,'desired',OLD.operation_id,json_object('target',OLD.target,'field',OLD.field,'operation_id',OLD.operation_id,'ordinal',OLD.ordinal,'removed',json('true'))); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_receipt_insert AFTER INSERT ON native_receipt_audit
BEGIN INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'receipt',NEW.operation_id,json_object('audit',json(NEW.metadata))); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_review_insert AFTER INSERT ON native_reconciliations
BEGIN INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'review',NEW.operation_id,json_object('ordinal',NEW.ordinal,'sequence',NEW.sequence,'disposition',NEW.disposition,'observed',json(NEW.observed),'receipt_hash',NEW.receipt_hash)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_meta_insert AFTER INSERT ON mirror_meta
BEGIN INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'meta','snapshot',json_object('sequence',NEW.sequence)); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS smart_meta_update AFTER UPDATE ON mirror_meta
WHEN OLD.sequence<>NEW.sequence
BEGIN INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'meta','snapshot',json_object('sequence',NEW.sequence)); END;
