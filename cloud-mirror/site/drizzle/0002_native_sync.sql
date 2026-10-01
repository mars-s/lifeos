CREATE TABLE IF NOT EXISTS native_operations (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  claim TEXT,
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner,id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS native_pending ON native_operations(owner,state,ordinal);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_immutable_payload BEFORE UPDATE OF owner,id,request_hash,payload,created_at ON native_operations
BEGIN SELECT RAISE(ABORT,'immutable operation'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_immutable_final BEFORE UPDATE ON native_operations
WHEN OLD.state IN ('applied','satisfied','skipped','superseded','failed','uncertain')
BEGIN SELECT RAISE(ABORT,'immutable receipt'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_immutable_claim BEFORE UPDATE OF claim ON native_operations
WHEN OLD.claim IS NOT NULL AND NEW.claim IS NOT OLD.claim
BEGIN SELECT RAISE(ABORT,'immutable claim'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_no_delete BEFORE DELETE ON native_operations
BEGIN SELECT RAISE(ABORT,'operation journal retained'); END;
