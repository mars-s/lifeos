CREATE TABLE `audit` (
	`n` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`operation_id` text NOT NULL,
	`event` text NOT NULL,
	`detail` text NOT NULL,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mock_tasks` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`title_rev` integer NOT NULL,
	`notes` text NOT NULL,
	`deadline` text,
	`deleted` integer DEFAULT 0 NOT NULL,
	`last_op` text,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`revision` text NOT NULL,
	`content` text NOT NULL,
	`state` text NOT NULL,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`title` text NOT NULL,
	`title_rev` integer NOT NULL,
	`notes` text NOT NULL,
	`deadline` text,
	`deleted` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`owner` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`observed_at` text NOT NULL,
	`adapter_status` text NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER immutable_operation_content BEFORE UPDATE OF owner,id,revision,content,created_at ON operations
BEGIN SELECT RAISE(ABORT,'immutable operation'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_terminal_result BEFORE UPDATE OF state,result ON operations
WHEN OLD.state IN ('applied','conflict','rejected')
BEGIN SELECT RAISE(ABORT,'immutable terminal operation'); END;
--> statement-breakpoint
CREATE TRIGGER audit_proposal AFTER INSERT ON operations
BEGIN INSERT INTO audit(owner,operation_id,event,detail,at) VALUES(NEW.owner,NEW.id,'proposed',NEW.content,NEW.created_at); END;
--> statement-breakpoint
CREATE TRIGGER audit_decision AFTER UPDATE OF state ON operations WHEN OLD.state <> NEW.state
BEGIN INSERT INTO audit(owner,operation_id,event,detail,at) VALUES(NEW.owner,NEW.id,NEW.state,json_object('revision',NEW.revision,'previous_state',OLD.state,'result',json(NEW.result)),NEW.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER immutable_audit_update BEFORE UPDATE ON audit
BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_audit_delete BEFORE DELETE ON audit
BEGIN SELECT RAISE(ABORT,'immutable audit'); END;
