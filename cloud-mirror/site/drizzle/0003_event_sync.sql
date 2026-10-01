CREATE TABLE IF NOT EXISTS native_desired_fields (
  owner TEXT NOT NULL,
  target TEXT NOT NULL,
  field TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY(owner,target,field)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS native_receipt_audit (
  owner TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  metadata TEXT NOT NULL,
  PRIMARY KEY(owner,operation_id)
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_audit_no_update BEFORE UPDATE ON native_receipt_audit
BEGIN SELECT RAISE(ABORT,'immutable receipt audit'); END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS native_audit_no_delete BEFORE DELETE ON native_receipt_audit
BEGIN SELECT RAISE(ABORT,'immutable receipt audit'); END;
