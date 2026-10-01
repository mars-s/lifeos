# Rationale

The strongest useful meaning of smart merge in this system is precise evidence followed by a simple deterministic rule. Cloudflare remains the durable decision authority. A cloud preference resolves collisions. It should not erase unrelated work or keep reapplying a completed old command after the user changes Things again.

The design fixes the actual-base defect before introducing merge logic. It stores the exact state the caller observed, including displayed pending desires. This allows offline edits without pretending that a freshest-mirror base belonged to the offline caller. Retained field lineage catches recorded ABA while admitting hidden ABA is unknowable.

It distinguishes ordering from intent. FIFO ordinals establish cloud order. Native capture fences establish observation order. Neither timestamps nor Things snapshots identify explicit user operations. The design therefore promises observed causality, not impossible knowledge about phone edits. Cloud fallback covers concurrency and unknown divergence from a valid base. Unknown bases and unknown cells do not justify a write.

Whole-string title resolution is deliberate. “Buy oat milk” and “Buy milk today” do not safely imply “Buy oat milk today”. A text splice can be mechanically valid while changing the task's meaning. The current small fields do not earn a CRDT, an LLM or a semantic merge engine.

Unconditional cloud wins is rejected because it cannot distinguish a stale offline request, a future Things change and a same-field conflict. Things wins is rejected as a universal rule because it discards the user's explicit cloud edits. Last wall-clock writer wins is rejected because snapshots are delayed and clocks are not a causal graph. Prompting on every conflict is rejected because the known user preference is automatic resolution. A persistent desired-value repair loop is rejected because confirmation of a one-time command must eventually release that field to future edits.

The recovery policy is more conservative than initial conflict resolution. Before invocation, a fresh deterministic merge can legitimately choose cloud fallback. After an ambiguous invocation, a divergent value may be a later edit. Reapplying fallback would convert recovery into a fresh destructive decision. The same-value readback and guarded before-value replay permit ordinary idempotent recovery. Other divergence becomes uncertain. Trash retains its stricter verification-only rule.

Delete/edit conflict is resolved with existing capabilities. Explicit cloud Trash wins over competing supported edits, and their observed values remain inspectable. Existing native Trash blocks title and completion. No branch restores or recreates the target. This is compatible with recoverable Trash authority and does not expand consent to permanent deletion.

The principal implementation cost is a trustworthy base ledger plus decision dispositions. Those are necessary structures, not a second synchronization engine. The owner FIFO, D1 operation journal, native queue, public reader/writer and WebSocket hints remain. The receipt event and post-write reconciliation disposition remain separate so immutable history is never rewritten.

There is a deliberate tradeoff after a verified setter whose next fresh snapshot differs. The design preserves that new observation and stops enforcing the old desire. It may accept delayed ThingsCloud propagation as newer rather than proven human intent. The alternative is an unbounded overwrite loop that risks erasing later edits. The limitation is made visible in audit data, and automatic resolution remains the normal experience.

This proposal can ship for title, completion and Trash once both clients understand version 3 and exact bases are retained. Notes, tags, dates and project relationships require independent write contracts and merge semantics. Adding them now would make the merger look more capable than its supported automation.

The work is a read-only implementable design. Its scenario matrix is a concrete verification contract, not a claim that the implementation or live Things paths were tested.
