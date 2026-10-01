# Why this design

I would ship a field-based three-way merge with an actual retained read basis and a cloud conflict fallback. The largest correctness improvement is repairing the base contract. Choosing a sophisticated merge function while keeping today's substituted base would produce confident decisions from evidence the caller never saw.

Cloudflare remains the authoritative queue and policy owner. Its value preference becomes the deterministic answer for competing changes. A local observation after a completed, confirmed operation can then become the new mirror value. This matches automatic resolution without turning each past cloud operation into a permanent veto on later Things changes.

I rejected universal cloud overwrite because it needlessly resets old no-op requests and obscures independent field edits. I rejected universal Things-wins because it reverses the user's explicit preference. I rejected timestamp last-writer-wins because upload times and phone clocks do not establish edit order. I rejected vector clocks presented as full causal knowledge because current Things observations carry no user-operation clock. Head tokens provide real cloud succession, while snapshot evidence provides only the narrower observed succession described in the design.

I rejected whole-task merging because a title conflict should not lose a completion or rewrite notes. I rejected title text merging because a syntactically valid splice can change the task's meaning. I rejected completion as a permanent monotone bit because Things supports reopening. I rejected permanent deletion and automatic restore because the current authorized write contract only supports recoverable Trash.

I rejected an operation log for every local user action because public Things automation does not expose one. Capturing private database changes would expand access and still fail to establish remote ThingsCloud authorship. Bulk public observations stay the source of truth for what the agent can currently see.

Interrupted setters are the difficult tradeoff. Blind replay gives better unattended catch-up but can overwrite a Things edit made after a successful setter whose receipt was lost. Version 3 therefore verifies the persisted result and reports uncertainty when it differs. Most operations still settle automatically. Only genuinely ambiguous crash windows require review. Trash keeps its stricter verification-only recovery.

The 90-day basis retention window bounds storage and defines offline support explicitly. Pinned accepted work remains replayable after expiry. An expired unaccepted request fails rather than quietly changing its base. The exact retention period can later change as a policy epoch without rewriting old operations.

Model the Domain shaped the separate basis, effective head, observation, and desired overlay records. Those are different facts and must not share a revision counter. Make Operations Idempotent shaped frozen preparation, exact receipt replay, head ownership checks, and verification-only recovery when the external setter's outcome is ambiguous. Both principle leaf skills were read for this candidate.

The repository inspection was read-only. I read the current native queue, owner coordinator, mirror-store fence logic, native writer, native journal execution path, and event-sync rollout document. I ran no live Things reads, mutations, tests, deployments, app restarts, or secret inspection. The matrix is a verification specification, not a claim that tests passed.

The recommended first release supports only title, completion, and recoverable Trash. Its value is fewer avoidable overwrites, an honest account of uncertainty, and a deterministic explanation for every automatic choice.
