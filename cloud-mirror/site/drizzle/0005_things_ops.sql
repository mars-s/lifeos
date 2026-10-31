-- Offline Things operations (payload version 4): client temporary IDs for queued
-- creates and the real Things IDs reported by verified Mac receipts.
CREATE TABLE IF NOT EXISTS native_temp_ids (
  owner TEXT NOT NULL,
  temp_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  real_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  PRIMARY KEY(owner,temp_id),
  UNIQUE(owner,operation_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS native_temp_ids_real ON native_temp_ids(owner,real_id) WHERE real_id IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_temp_ids_identity BEFORE UPDATE OF owner,temp_id,operation_id,kind,created_at ON native_temp_ids
BEGIN SELECT RAISE(ABORT,'immutable temporary id'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_temp_ids_resolved_once BEFORE UPDATE OF real_id ON native_temp_ids
WHEN OLD.real_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'temporary id already resolved'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_temp_ids_retained BEFORE DELETE ON native_temp_ids
BEGIN SELECT RAISE(ABORT,'temporary id retained'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_temp_ids_feed AFTER UPDATE OF real_id ON native_temp_ids
WHEN NEW.real_id IS NOT NULL
BEGIN INSERT INTO native_changes(owner,kind,id,payload) VALUES(NEW.owner,'temp_id',NEW.temp_id,json_object('temp_id',NEW.temp_id,'operation_id',NEW.operation_id,'kind',NEW.kind,'real_id',NEW.real_id)); END;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS native_operations_target ON native_operations(owner,json_extract(payload,'$.target'));
