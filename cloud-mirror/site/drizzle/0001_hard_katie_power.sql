CREATE TABLE `mirror_items` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`fields` text NOT NULL,
	`deleted` integer NOT NULL,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mirror_meta` (
	`owner` text PRIMARY KEY NOT NULL,
	`sequence` integer NOT NULL,
	`manifest_hash` text NOT NULL,
	`observed_at` text NOT NULL,
	`received_at` text NOT NULL,
	`zone` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mirror_operations` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`revision` text NOT NULL,
	`content` text NOT NULL,
	`state` text NOT NULL,
	`claim` text,
	`result` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mirror_pages` (
	`owner` text NOT NULL,
	`sequence` integer NOT NULL,
	`page` integer NOT NULL,
	`items` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`owner`, `sequence`, `page`)
);
--> statement-breakpoint
CREATE TABLE `mirror_plans` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`priority` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE TABLE `mirror_uploads` (
	`owner` text NOT NULL,
	`sequence` integer NOT NULL,
	`manifest` text NOT NULL,
	`manifest_hash` text NOT NULL,
	`committed` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`owner`, `sequence`)
);
--> statement-breakpoint
CREATE TRIGGER mirror_immutable_content BEFORE UPDATE OF owner,id,revision,content,created_at ON mirror_operations
BEGIN SELECT RAISE(ABORT,'immutable mirror operation'); END;
--> statement-breakpoint
CREATE TRIGGER mirror_immutable_final BEFORE UPDATE ON mirror_operations
WHEN OLD.state IN ('applied','applied_cloud','conflict','failed','uncertain','rejected')
BEGIN SELECT RAISE(ABORT,'immutable final mirror receipt'); END;
--> statement-breakpoint
CREATE TRIGGER mirror_immutable_claim BEFORE UPDATE OF claim ON mirror_operations
WHEN OLD.claim IS NOT NULL AND NEW.claim IS NOT OLD.claim
BEGIN SELECT RAISE(ABORT,'immutable claim'); END;
--> statement-breakpoint
CREATE TRIGGER mirror_no_delete BEFORE DELETE ON mirror_operations
BEGIN SELECT RAISE(ABORT,'immutable operation journal'); END;
--> statement-breakpoint
CREATE TRIGGER mirror_proposed AFTER INSERT ON mirror_operations
BEGIN INSERT INTO audit(owner,operation_id,event,detail,at)
VALUES(NEW.owner,'mirror:'||NEW.id,'proposed',NEW.content,NEW.created_at); END;
--> statement-breakpoint
CREATE TRIGGER mirror_transition AFTER UPDATE OF state ON mirror_operations
WHEN OLD.state<>NEW.state
BEGIN INSERT INTO audit(owner,operation_id,event,detail,at)
VALUES(NEW.owner,'mirror:'||NEW.id,NEW.state,json_object('revision',NEW.revision,'previous_state',OLD.state,'result',json(NEW.result)),NEW.updated_at); END;
--> statement-breakpoint
CREATE TRIGGER mirror_immutable_manifest BEFORE UPDATE OF manifest,manifest_hash,owner,sequence ON mirror_uploads
BEGIN SELECT RAISE(ABORT,'immutable upload'); END;
--> statement-breakpoint
CREATE TRIGGER mirror_immutable_page BEFORE UPDATE ON mirror_pages
BEGIN SELECT RAISE(ABORT,'immutable page'); END;
