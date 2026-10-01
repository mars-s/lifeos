// site/lib/demo-store.ts
var DemoError = class extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
};
var now = () => (/* @__PURE__ */ new Date()).toISOString();
var operation = (row) => ({
  ...row,
  content: JSON.parse(row.content),
  result: row.result ? JSON.parse(row.result) : null
});
async function hash(value) {
  const data = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(data)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
var DemoStore = class {
  constructor(db, owner) {
    this.db = db;
    this.owner = owner;
    if (!owner) throw new DemoError("Sign in to access this private demo.", 401);
  }
  stmt(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  async seed() {
    const at2 = now();
    await this.db.batch([
      this.stmt("INSERT OR IGNORE INTO sync_state VALUES(?,1,?,'offline')", this.owner, at2),
      ...[
        { id: "demo-flight", title: "Check flight details", notes: "Synthetic sample task", deadline: "2026-10-03" },
        { id: "demo-pack", title: "Pack travel adapter", notes: "Synthetic sample task", deadline: null }
      ].flatMap((t) => [
        this.stmt("INSERT OR IGNORE INTO mock_tasks VALUES(?,?,?,1,?,?,0,NULL)", this.owner, t.id, t.title, t.notes, t.deadline),
        this.stmt("INSERT OR IGNORE INTO snapshots VALUES(?,?,?,1,?,?,0)", this.owner, t.id, t.title, t.notes, t.deadline)
      ])
    ]);
    return this.state();
  }
  async state() {
    const [sync, tasks, ops, count] = await Promise.all([
      this.stmt("SELECT * FROM sync_state WHERE owner=?", this.owner).first(),
      this.stmt("SELECT id,title,title_rev,notes,deadline,deleted FROM snapshots WHERE owner=? ORDER BY id", this.owner).all(),
      this.stmt("SELECT id,revision,content,state,result,created_at FROM operations WHERE owner=? ORDER BY created_at,id", this.owner).all(),
      this.stmt("SELECT count(*) AS n FROM audit WHERE owner=?", this.owner).first()
    ]);
    return {
      mode: "synthetic",
      last_sync_at: sync?.observed_at ?? null,
      sequence: sync?.sequence ?? 0,
      sync_age_seconds: sync ? Math.max(0, Math.floor((Date.now() - Date.parse(sync.observed_at)) / 1e3)) : null,
      adapter_status: sync?.adapter_status ?? "offline",
      confirmed: tasks.results,
      operations: ops.results.map(operation),
      audit_count: count?.n ?? 0
    };
  }
  async get(id) {
    const row = await this.stmt("SELECT * FROM operations WHERE owner=? AND id=?", this.owner, id).first();
    if (!row) throw new DemoError("Proposal not found in your demo.", 404);
    return operation(row);
  }
  async propose(input) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(input.id) || !input.target || !input.title?.trim() || input.title.length > 300 || !Number.isInteger(input.base_title_rev))
      throw new DemoError("Choose a task and enter a title of 1\u2013300 characters.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.zone });
    } catch {
      throw new DemoError("Use a valid IANA timezone.");
    }
    const existing = await this.stmt("SELECT * FROM operations WHERE owner=? AND id=?", this.owner, input.id).first();
    if (existing) {
      const op = operation(existing);
      if (op.content.target !== input.target || op.content.fields.title !== input.title || op.content.zone !== input.zone || op.content.base.title_rev !== input.base_title_rev)
        throw new DemoError("This request ID was already used for different content.");
      return op;
    }
    const task = await this.stmt("SELECT * FROM snapshots WHERE owner=? AND id=? AND deleted=0", this.owner, input.target).first();
    if (!task || task.title_rev !== input.base_title_rev) throw new DemoError("The snapshot changed. Refresh and review a new proposal.");
    const content = { kind: "patch", target: input.target, fields: { title: input.title }, base: { title: task.title, title_rev: task.title_rev }, zone: input.zone };
    const revision = await hash({ id: input.id, content });
    const at2 = now();
    await this.stmt(
      "INSERT OR IGNORE INTO operations(owner,id,revision,content,state,result,created_at,updated_at) SELECT ?,?,?,?,'draft',NULL,?,? FROM snapshots WHERE owner=? AND id=? AND title_rev=? AND deleted=0",
      this.owner,
      input.id,
      revision,
      JSON.stringify(content),
      at2,
      at2,
      this.owner,
      input.target,
      input.base_title_rev
    ).run();
    const saved = await this.get(input.id);
    if (saved.revision !== revision) throw new DemoError("This request ID was already used for different content.");
    return saved;
  }
  async decide(id, revision, approve) {
    const desired = approve ? "queued" : "rejected";
    await this.stmt("UPDATE operations SET state=?,updated_at=? WHERE owner=? AND id=? AND revision=? AND state='draft'", desired, now(), this.owner, id, revision).run();
    const op = await this.get(id);
    if (op.revision !== revision || op.state !== desired) throw new DemoError("Decision must match the exact draft revision. Refresh to see its current state.");
    return op;
  }
  async setOffline() {
    await this.stmt("UPDATE sync_state SET adapter_status='offline' WHERE owner=?", this.owner).run();
    return this.state();
  }
  async conflict(target) {
    const result = await this.stmt("UPDATE mock_tasks SET title=title||' \xB7 changed on mock iPhone',title_rev=title_rev+1 WHERE owner=? AND id=? AND deleted=0", this.owner, target).run();
    if (!result.meta.changes) throw new DemoError("Sample task not found.", 404);
    return this.state();
  }
  async reconnect() {
    const pending = (await this.stmt("SELECT * FROM operations WHERE owner=? AND state='queued' ORDER BY created_at,id", this.owner).all()).results.map(operation);
    for (const op of pending) {
      const c = op.content, at2 = now();
      await this.db.batch([
        this.stmt(
          "UPDATE mock_tasks SET title=?,title_rev=title_rev+1,last_op=? WHERE owner=? AND id=? AND title=? AND title_rev=? AND deleted=0 AND EXISTS(SELECT 1 FROM operations WHERE owner=? AND id=? AND state='queued')",
          c.fields.title,
          op.id,
          this.owner,
          c.target,
          c.base.title,
          c.base.title_rev,
          this.owner,
          op.id
        ),
        this.stmt(
          "UPDATE operations SET state=CASE WHEN EXISTS(SELECT 1 FROM mock_tasks WHERE owner=? AND id=? AND last_op=?) THEN 'applied' ELSE 'conflict' END,result=CASE WHEN EXISTS(SELECT 1 FROM mock_tasks WHERE owner=? AND id=? AND last_op=?) THEN ? ELSE ? END,updated_at=? WHERE owner=? AND id=? AND state='queued'",
          this.owner,
          c.target,
          op.id,
          this.owner,
          c.target,
          op.id,
          JSON.stringify({ before: c.base.title, after: c.fields.title, verified_at: at2, scope: "synthetic D1 source only" }),
          JSON.stringify({ reason: "The same field changed after review. No mock overwrite occurred." }),
          at2,
          this.owner,
          op.id
        )
      ]);
    }
    await this.db.batch([
      this.stmt("UPDATE snapshots SET deleted=1 WHERE owner=? AND NOT EXISTS(SELECT 1 FROM mock_tasks WHERE mock_tasks.owner=snapshots.owner AND mock_tasks.id=snapshots.id AND mock_tasks.deleted=0)", this.owner),
      this.stmt("INSERT INTO snapshots SELECT owner,id,title,title_rev,notes,deadline,deleted FROM mock_tasks WHERE owner=? ON CONFLICT(owner,id) DO UPDATE SET title=excluded.title,title_rev=excluded.title_rev,notes=excluded.notes,deadline=excluded.deadline,deleted=excluded.deleted", this.owner),
      this.stmt("UPDATE sync_state SET sequence=sequence+1,observed_at=?,adapter_status='recent' WHERE owner=?", now(), this.owner)
    ]);
    return this.state();
  }
};

// site/lib/demo-api.ts
function identity(request) {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) throw new DemoError("Sign in to access this private demo.", 401);
  return id;
}
var reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function demoAPI(request, db) {
  try {
    const owner = identity(request), url = new URL(request.url), action = url.pathname.split("/").pop();
    const store = new DemoStore(db, owner);
    if (request.method === "GET" && action === "state") return reply(await store.state());
    if (request.method !== "POST") return reply({ error: "Route not found" }, 404);
    if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) throw new DemoError("Request origin does not match this Site.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new DemoError("Use a JSON request.", 415);
    const raw = await request.text();
    if (raw.length > 16384) throw new DemoError("Request is too large.", 413);
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoError("JSON object required.", 400);
    if (action === "seed") return reply(await store.seed());
    if (action === "propose") return reply(await store.propose(body));
    if (action === "approve" || action === "reject") return reply(await store.decide(body.id, body.revision, action === "approve"));
    if (action === "reconnect") return reply(await store.reconnect());
    if (action === "offline") return reply(await store.setOffline());
    if (action === "conflict") return reply(await store.conflict(body.target));
    return reply({ error: "Route not found" }, 404);
  } catch (error) {
    if (error instanceof DemoError) return reply({ error: error.message }, error.status);
    if (error instanceof SyntaxError || error instanceof TypeError) return reply({ error: "Invalid request. Refresh and try again." }, 400);
    return reply({ error: "Demo storage is unavailable. Your submitted changes may have been saved; refresh before retrying." }, 503);
  }
}

// site/lib/mirror-store.ts
var kinds = /* @__PURE__ */ new Set(["todo", "project", "area", "tag", "heading"]);
var at = () => (/* @__PURE__ */ new Date()).toISOString();
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ":" + canonical(v)).join(",") + "}";
  return JSON.stringify(value);
}
async function fingerprint(v) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(v))))).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function decoded(row) {
  return { ...row, content: JSON.parse(String(row.content)), result: row.result ? JSON.parse(String(row.result)) : null };
}
function fail(message) {
  throw new DemoError(message);
}
function validID(id) {
  if (typeof id !== "string" || !id || id.length > 128) fail("Invalid ID.");
}
var MirrorStore = class {
  constructor(db, owner) {
    this.db = db;
    this.owner = owner;
    if (!owner) throw new DemoError("Owner context required.", 401);
  }
  stmt(sql, ...args) {
    return this.db.prepare(sql).bind(...args);
  }
  async meta() {
    return this.stmt("SELECT * FROM mirror_meta WHERE owner=?", this.owner).first();
  }
  async upload(sequence) {
    const row = await this.stmt("SELECT * FROM mirror_uploads WHERE owner=? AND sequence=?", this.owner, sequence).first();
    if (!row) fail("Begin this inventory first.");
    return row;
  }
  async begin(input) {
    const { sequence, manifest: m } = input;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || !m || !Number.isInteger(m.count) || m.count < 0 || m.count > 1e4 || !Array.isArray(m.page_hashes) || m.page_hashes.length < 1 || m.page_hashes.length > 100 || m.page_hashes.some((h) => !/^[a-f0-9]{64}$/.test(h)) || !Array.isArray(m.scopes) || !m.scopes.length || new Set(m.scopes).size !== m.scopes.length || m.scopes.some((s) => !kinds.has(s))) fail("Invalid complete inventory manifest.");
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(m.observed_at) || !Number.isFinite(Date.parse(m.observed_at)) || Date.parse(m.observed_at) > Date.now() + 3e4) fail("Invalid observation timestamp.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: m.zone });
    } catch {
      fail("IANA timezone required.");
    }
    const prior = await this.meta();
    if (prior && (sequence < prior.sequence || Date.parse(m.observed_at) < Date.parse(prior.observed_at))) fail("Stale inventory or lost helper journal; reconcile rather than resetting sequence.");
    const hash2 = await fingerprint(m);
    await this.stmt("INSERT OR IGNORE INTO mirror_uploads VALUES(?,?,?,?,0)", this.owner, sequence, canonical(m), hash2).run();
    const saved = await this.upload(sequence);
    if (saved.manifest_hash !== hash2) fail("Sequence already used for a different manifest.");
    return { committed: !!saved.committed };
  }
  async page(input) {
    const upload = await this.upload(input.sequence), m = JSON.parse(upload.manifest);
    if (!Number.isInteger(input.page) || input.page < 0 || input.page >= m.page_hashes.length || !Array.isArray(input.items) || input.items.length > 100) fail("Invalid snapshot page.");
    const hash2 = await fingerprint(input.items);
    if (hash2 !== m.page_hashes[input.page]) fail("Page does not match the manifest.");
    await this.stmt("INSERT OR IGNORE INTO mirror_pages VALUES(?,?,?,?,?)", this.owner, input.sequence, input.page, canonical(input.items), hash2).run();
    const saved = await this.stmt("SELECT hash FROM mirror_pages WHERE owner=? AND sequence=? AND page=?", this.owner, input.sequence, input.page).first();
    if (saved?.hash !== hash2) fail("Page number already used for different content.");
    return { received: true };
  }
  async commit(sequence) {
    const upload = await this.upload(sequence);
    if (upload.committed) return { duplicate: true };
    const m = JSON.parse(upload.manifest), prior = await this.meta();
    if (prior && sequence <= prior.sequence) fail("A newer snapshot was already committed.");
    const pages = await this.stmt("SELECT page,items,hash FROM mirror_pages WHERE owner=? AND sequence=? ORDER BY page", this.owner, sequence).all();
    if (pages.results.length !== m.page_hashes.length || pages.results.some((p, n) => p.page !== n || p.hash !== m.page_hashes[n])) fail("Missing inventory pages; confirmed snapshot has not changed.");
    const items = pages.results.flatMap((p) => JSON.parse(p.items));
    if (items.length !== m.count || new Set(items.map((i) => i.id)).size !== items.length) fail("Inventory count/IDs do not match.");
    const old = (await this.stmt("SELECT * FROM mirror_items WHERE owner=?", this.owner).all()).results;
    const priorItems = new Map(old.map((i) => [i.id, i]));
    const updates = [];
    for (const item of items) {
      validID(item.id);
      if (!m.scopes.includes(item.kind) || !item.fields || typeof item.fields !== "object" || Array.isArray(item.fields)) fail("Invalid inventory item scope/fields.");
      const previous = priorItems.get(item.id);
      if (previous && previous.kind !== item.kind) fail("Item kind changed for an existing ID.");
      const fields = previous ? JSON.parse(previous.fields) : {};
      for (const [key, incoming] of Object.entries(item.fields)) {
        if (key.length > 100 || !incoming || !["value", "absent", "unsupported", "unknown"].includes(incoming.state) || incoming.state === "value" && !("value" in incoming) || incoming.state !== "value" && "value" in incoming) fail("Invalid field cell.");
        const prev = fields[key], cell = { state: incoming.state, ...incoming.state === "value" ? { value: incoming.value } : {} };
        if (["unknown", "unsupported"].includes(cell.state) && prev) cell.last_known = prev.state === "value" ? { state: prev.state, value: prev.value } : prev.last_known ?? prev;
        const comparable = (c) => c ? { state: c.state, ...c.state === "value" ? { value: c.value } : {}, ...c.last_known !== void 0 ? { last_known: c.last_known } : {} } : null;
        cell.revision = canonical(comparable(prev)) === canonical(comparable(cell)) ? prev?.revision ?? 1 : (prev?.revision ?? 0) + 1;
        fields[key] = cell;
      }
      updates.push(this.stmt("INSERT INTO mirror_items SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=? ON CONFLICT(owner,id) DO UPDATE SET fields=excluded.fields,deleted=0,observed_at=excluded.observed_at", this.owner, item.id, item.kind, canonical(fields), 0, m.observed_at, this.owner, prior?.sequence ?? 0));
      priorItems.delete(item.id);
    }
    for (const item of priorItems.values()) if (m.scopes.includes(item.kind)) updates.push(this.stmt("UPDATE mirror_items SET deleted=1,observed_at=? WHERE owner=? AND id=? AND COALESCE((SELECT sequence FROM mirror_meta WHERE owner=?),0)=?", m.observed_at, this.owner, item.id, this.owner, prior?.sequence ?? 0));
    updates.push(this.stmt("INSERT INTO mirror_meta VALUES(?,?,?,?,?,?) ON CONFLICT(owner) DO UPDATE SET sequence=excluded.sequence,manifest_hash=excluded.manifest_hash,observed_at=excluded.observed_at,received_at=excluded.received_at,zone=excluded.zone WHERE mirror_meta.sequence=? AND mirror_meta.sequence<excluded.sequence", this.owner, sequence, upload.manifest_hash, m.observed_at, at(), m.zone, prior?.sequence ?? 0));
    updates.push(this.stmt("UPDATE mirror_uploads SET committed=1 WHERE owner=? AND sequence=? AND EXISTS(SELECT 1 FROM mirror_meta WHERE owner=? AND sequence=? AND manifest_hash=?)", this.owner, sequence, this.owner, sequence, upload.manifest_hash));
    await this.db.batch(updates);
    if (!(await this.upload(sequence)).committed) fail("Inventory raced another upload; refresh.");
    return { duplicate: false };
  }
  async get(id) {
    const row = await this.stmt("SELECT * FROM mirror_operations WHERE owner=? AND id=?", this.owner, id).first();
    if (!row) throw new DemoError("Operation not found.", 404);
    return decoded(row);
  }
  async propose(input) {
    validID(input.id);
    validID(input.target);
    const fields = input.fields, keys = Object.keys(fields ?? {}), planning = input.planning === true;
    if (keys.length !== 1 || keys.some((k) => !(planning ? ["planning_priority"] : ["title", "notes"]).includes(k))) fail("First phase permits one title/notes field or a separate cloud planning priority.");
    const key = keys[0], value = fields[key];
    if (typeof value !== "string" || value.length > (key === "notes" ? 1e4 : 4e3) || key === "title" && !value.trim() || planning && !["focus", "normal", "later"].includes(value)) fail("Invalid field value.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.zone });
    } catch {
      fail("IANA timezone required.");
    }
    const existing = await this.stmt("SELECT * FROM mirror_operations WHERE owner=? AND id=?", this.owner, input.id).first();
    if (existing) {
      const op2 = decoded(existing);
      if (canonical(op2.content.request) !== canonical(input)) fail("ID reused for different content.");
      return op2;
    }
    const row = await this.stmt("SELECT * FROM mirror_items WHERE owner=? AND id=? AND deleted=0", this.owner, input.target).first();
    if (!row) fail("Confirmed target missing.");
    if (!planning && !["todo", "project"].includes(row.kind)) fail("This kind is read-only in phase one.");
    const cells = JSON.parse(row.fields), base = {};
    if (!planning) {
      const cell = cells[key];
      if (!cell || cell.state !== "value" || cell.revision !== input.base_revisions?.[key]) fail("Field is unobserved, unsupported, or has changed. Refresh.");
      base[key] = { state: "value", value: cell.value };
    }
    const plan = await this.stmt("SELECT revision FROM mirror_plans WHERE owner=? AND id=?", this.owner, input.target).first();
    if (planning && (plan?.revision ?? 0) !== (input.plan_revision ?? 0)) fail("Cloud plan changed. Refresh.");
    const content = { request: input, target: input.target, kind: row.kind, fields, base, zone: input.zone, planning, plan_revision: plan?.revision ?? 0 };
    const revision = await fingerprint({ id: input.id, content }), date = at();
    await this.stmt("INSERT OR IGNORE INTO mirror_operations VALUES(?,?,?,?,'draft',NULL,NULL,?,?)", this.owner, input.id, revision, canonical(content), date, date).run();
    const op = await this.get(input.id);
    if (op.revision !== revision) fail("Concurrent proposal ID reuse.");
    return op;
  }
  async decide(id, revision, approved) {
    const op = await this.get(id);
    if (op.revision !== revision) fail("Review the exact immutable revision.");
    if (op.content.planning && approved) {
      const c = op.content, p = c.fields.planning_priority;
      await this.db.batch([
        this.stmt("INSERT INTO mirror_plans SELECT ?,?,?,1 WHERE ?=0 AND EXISTS(SELECT 1 FROM mirror_operations WHERE owner=? AND id=? AND state='draft') ON CONFLICT(owner,id) DO UPDATE SET priority=excluded.priority,revision=mirror_plans.revision+1 WHERE mirror_plans.revision=?", this.owner, c.target, p, c.plan_revision, this.owner, id, c.plan_revision),
        this.stmt("UPDATE mirror_plans SET priority=?,revision=revision+1 WHERE owner=? AND id=? AND revision=? AND ?>0 AND EXISTS(SELECT 1 FROM mirror_operations WHERE owner=? AND id=? AND state='draft')", p, this.owner, c.target, c.plan_revision, c.plan_revision, this.owner, id),
        this.stmt("UPDATE mirror_operations SET state=CASE WHEN EXISTS(SELECT 1 FROM mirror_plans WHERE owner=? AND id=? AND revision=? AND priority=?) THEN 'applied_cloud' ELSE 'conflict' END,result=?,updated_at=? WHERE owner=? AND id=? AND revision=? AND state='draft'", this.owner, c.target, c.plan_revision + 1, p, canonical({ scope: "cloud planning only; no Things priority property" }), at(), this.owner, id, revision)
      ]);
    } else await this.stmt("UPDATE mirror_operations SET state=?,updated_at=? WHERE owner=? AND id=? AND revision=? AND state='draft'", approved ? "queued" : "rejected", at(), this.owner, id, revision).run();
    const saved = await this.get(id);
    if (saved.revision !== revision || ![approved ? op.content.planning ? "applied_cloud" : "queued" : "rejected", "conflict"].includes(saved.state)) fail("Decision no longer matches a draft.");
    return saved;
  }
  async pending() {
    return (await this.stmt("SELECT * FROM mirror_operations WHERE owner=? AND state IN ('queued','executing') ORDER BY CASE state WHEN 'queued' THEN 0 ELSE 1 END,created_at,id LIMIT 10", this.owner).all()).results.map(decoded);
  }
  async claim(id, claim) {
    validID(claim);
    await this.stmt("UPDATE mirror_operations SET state='executing',claim=?,updated_at=? WHERE owner=? AND id=? AND state='queued'", claim, at(), this.owner, id).run();
    const op = await this.get(id);
    if (op.claim !== claim || op.state !== "executing") fail("Operation belongs to another claim or is final.");
    return op;
  }
  async ack(id, claim, result) {
    if (!result || !["applied", "conflict", "failed", "uncertain"].includes(result.state)) fail("Invalid outcome.");
    const op = await this.get(id);
    if (op.claim !== claim) fail("Claim mismatch.");
    if (op.state !== "executing") {
      if (canonical(op.result) !== canonical(result)) fail("Final receipt cannot change.");
      return op;
    }
    await this.stmt("UPDATE mirror_operations SET state=?,result=?,updated_at=? WHERE owner=? AND id=? AND state='executing' AND claim=?", result.state, canonical(result), at(), this.owner, id, claim).run();
    const saved = await this.get(id);
    if (canonical(saved.result) !== canonical(result)) fail("Concurrent acknowledgement mismatch.");
    return saved;
  }
  async state(cursor = 0) {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > 1e4) fail("Invalid page cursor.");
    const [meta, rows, operations, plans, count, pending] = await Promise.all([this.meta(), this.stmt("SELECT * FROM mirror_items WHERE owner=? ORDER BY kind,id LIMIT 100 OFFSET ?", this.owner, cursor).all(), this.stmt("SELECT * FROM mirror_operations WHERE owner=? ORDER BY created_at DESC,id DESC LIMIT 100", this.owner).all(), this.stmt("SELECT * FROM mirror_plans WHERE owner=?", this.owner).all(), this.stmt("SELECT count(*) AS n FROM mirror_items WHERE owner=?", this.owner).first(), this.pending()]);
    const ops = operations.results.map(decoded);
    return {
      mode: "mirror",
      last_sync_at: meta?.observed_at ?? null,
      sequence: meta?.sequence ?? 0,
      zone: meta?.zone ?? null,
      sync_age_seconds: meta ? Math.max(0, (Date.now() - Date.parse(meta.observed_at)) / 1e3) : null,
      confirmed: rows.results.map((r) => ({ ...r, fields: JSON.parse(r.fields) })),
      total_items: count?.n ?? 0,
      next_cursor: cursor + rows.results.length < (count?.n ?? 0) ? cursor + rows.results.length : null,
      pending_overlay: [...new Map([...ops.filter((o) => o.state === "uncertain"), ...pending].map((o) => [o.id, o])).values()].map((o) => ({ id: o.id, target: o.content.target, fields: o.content.fields, state: o.state })),
      operations: ops.reverse(),
      plans: plans.results,
      journal_view: "latest 100 operations; complete journal retained",
      pending_view: "next 10 runnable/claimed operations plus recent uncertain outcomes"
    };
  }
};

// site/lib/mirror-api.ts
var reply2 = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function mirrorAPI(request, db, service) {
  try {
    const url = new URL(request.url), action = url.pathname.split("/").pop();
    let owner;
    if (service) {
      if (service.enabled !== "true" || !service.owner || !service.adapter || !service.keyHash) throw new DemoError("Mac sync access is not configured.", 503);
      const key = request.headers.get("x-lifeos-sync-key") ?? "";
      const hash2 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))).map((x) => x.toString(16).padStart(2, "0")).join("");
      let diff = hash2.length ^ service.keyHash.length;
      for (let n = 0; n < hash2.length; n++) diff |= hash2.charCodeAt(n) ^ (service.keyHash.charCodeAt(n) || 0);
      if (key.length < 32 || diff) throw new DemoError("Sync authentication required.", 401);
      owner = service.owner;
      if (!["begin", "page", "commit", "pending", "claim", "ack"].includes(action ?? "")) throw new DemoError("Service route not allowed.", 403);
    } else owner = identity(request);
    const store = new MirrorStore(db, owner);
    if (request.method === "GET" && action === "state" && !service) return reply2({ ...await store.state(Number(url.searchParams.get("cursor") ?? 0)), owner_binding_id: owner });
    if (request.method === "GET" && action === "pending" && service) return reply2(await store.pending());
    if (request.method !== "POST") return reply2({ error: "Route not found." }, 404);
    if (request.headers.get("origin") && request.headers.get("origin") !== url.origin) throw new DemoError("Origin mismatch.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new DemoError("JSON required.", 415);
    const reader = request.body?.getReader();
    if (!reader) throw new DemoError("Body required.", 400);
    let size = 0;
    const chunks = [];
    for (; ; ) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 256 * 1024) {
        await reader.cancel();
        throw new DemoError("Request too large.", 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, pos);
      pos += chunk.length;
    }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new DemoError("Object required.", 400);
    if (!service) {
      if (action === "propose") return reply2(await store.propose(body));
      if (action === "approve" || action === "reject") return reply2(await store.decide(body.id, body.revision, action === "approve"));
    } else {
      if (action === "begin") return reply2(await store.begin(body));
      if (action === "page") return reply2(await store.page(body));
      if (action === "commit") return reply2(await store.commit(body.sequence));
      if (action === "claim") return reply2(await store.claim(body.id, body.claim));
      if (action === "ack") return reply2(await store.ack(body.id, body.claim, body.result));
    }
    return reply2({ error: "Route not found." }, 404);
  } catch (error) {
    if (error instanceof DemoError) return reply2({ error: error.message }, error.status);
    if (error instanceof SyntaxError || error instanceof TypeError) return reply2({ error: "Invalid request." }, 400);
    return reply2({ error: "Storage request failed; refresh before retrying." }, 503);
  }
}
export {
  DemoError,
  DemoStore,
  MirrorStore,
  canonical,
  demoAPI,
  fingerprint,
  hash,
  identity,
  mirrorAPI
};
