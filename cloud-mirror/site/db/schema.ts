import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const snapshots = sqliteTable("snapshots", {
  owner: text("owner").notNull(), id: text("id").notNull(), title: text("title").notNull(),
  titleRev: integer("title_rev").notNull(), notes: text("notes").notNull(),
  deadline: text("deadline"), deleted: integer("deleted").notNull().default(0),
}, t => [primaryKey({columns: [t.owner, t.id]})]);

export const mockTasks = sqliteTable("mock_tasks", {
  owner: text("owner").notNull(), id: text("id").notNull(), title: text("title").notNull(),
  titleRev: integer("title_rev").notNull(), notes: text("notes").notNull(),
  deadline: text("deadline"), deleted: integer("deleted").notNull().default(0), lastOp: text("last_op"),
}, t => [primaryKey({columns: [t.owner, t.id]})]);

export const operations = sqliteTable("operations", {
  owner: text("owner").notNull(), id: text("id").notNull(), revision: text("revision").notNull(),
  content: text("content").notNull(), state: text("state").notNull(), result: text("result"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [primaryKey({columns: [t.owner, t.id]})]);

export const syncState = sqliteTable("sync_state", {
  owner: text("owner").primaryKey(), sequence: integer("sequence").notNull(),
  observedAt: text("observed_at").notNull(), adapterStatus: text("adapter_status").notNull(),
});

export const audit = sqliteTable("audit", {
  n: integer("n").primaryKey({autoIncrement:true}), owner: text("owner").notNull(),
  operationId: text("operation_id").notNull(), event: text("event").notNull(),
  detail: text("detail").notNull(), at: text("at").notNull(),
});

// Separate from demo tables so sample simulation can never alter the Things mirror.
export const mirrorItems = sqliteTable("mirror_items", {
  owner:text("owner").notNull(), id:text("id").notNull(), kind:text("kind").notNull(),
  fields:text("fields").notNull(), deleted:integer("deleted").notNull(), observedAt:text("observed_at").notNull(),
},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const mirrorMeta = sqliteTable("mirror_meta", {
  owner:text("owner").primaryKey(), sequence:integer("sequence").notNull(), manifestHash:text("manifest_hash").notNull(),
  observedAt:text("observed_at").notNull(), receivedAt:text("received_at").notNull(), zone:text("zone").notNull(),
});
export const mirrorUploads = sqliteTable("mirror_uploads", {
  owner:text("owner").notNull(), sequence:integer("sequence").notNull(), manifest:text("manifest").notNull(),
  manifestHash:text("manifest_hash").notNull(), committed:integer("committed").notNull().default(0),
},t=>[primaryKey({columns:[t.owner,t.sequence]})]);
export const mirrorPages = sqliteTable("mirror_pages", {
  owner:text("owner").notNull(), sequence:integer("sequence").notNull(), page:integer("page").notNull(),
  items:text("items").notNull(), hash:text("hash").notNull(),
},t=>[primaryKey({columns:[t.owner,t.sequence,t.page]})]);
export const mirrorOperations = sqliteTable("mirror_operations", {
  owner:text("owner").notNull(), id:text("id").notNull(), revision:text("revision").notNull(), content:text("content").notNull(),
  state:text("state").notNull(), claim:text("claim"), result:text("result"), createdAt:text("created_at").notNull(), updatedAt:text("updated_at").notNull(),
},t=>[primaryKey({columns:[t.owner,t.id]})]);
export const mirrorPlans = sqliteTable("mirror_plans", {
  owner:text("owner").notNull(), id:text("id").notNull(), priority:text("priority").notNull(), revision:integer("revision").notNull(),
},t=>[primaryKey({columns:[t.owner,t.id]})]);
