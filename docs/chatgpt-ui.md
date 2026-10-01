# ChatGPT day-plan UI

LifeOS exposes a versioned MCP Apps component at `ui://lifeos/day-plan-v3.html`.

The UI follows a decoupled flow:

1. ChatGPT reads Things and Calendar context.
2. ChatGPT calls `plan_day` to compute a deterministic preview.
3. ChatGPT calls `render_day_plan` with the exact returned blocks and unscheduled tasks.
4. ChatGPT renders the inline component.
5. The component can ask ChatGPT to adjust the plan or prepare a proposal.

`render_day_plan` is read-only. The component does not call approval or application tools. Preparing a proposal still uses the existing immutable proposal flow, and applying it still requires a separately approved revision.

The component uses the open MCP Apps resource link, `_meta.ui.resourceUri`, and the `text/html;profile=mcp-app` MIME type. It consumes the standard `ui/notifications/tool-result` notification and ChatGPT's `openai:set_globals` compatibility event, and feature-detects optional ChatGPT helpers for follow-up messages, external links, and intrinsic-height reporting.

## Manual check

After reconnecting the plugin in ChatGPT, try:

> Read my Things Today list and tomorrow's calendar. Make a realistic plan for tomorrow, then show it as a LifeOS day-plan card. Do not change anything yet.

The result should show a timeline, scheduled duration, unscheduled tasks, and `Adjust plan` and `Prepare proposal` actions. `Adjust plan` enters a draft-only edit mode: blocks can be dragged, resized from their lower edge, or changed with the keyboard in 15-minute steps. Edited times are passed into the proposal request without directly writing to Things or Calendar.

## Multi-day planning

For requests spanning more than one date, LifeOS exposes `plan_week` and the
`ui://lifeos/week-plan-v1.html` component. The caller supplies one usable daytime window per date;
overnight gaps are never treated as free time. Tasks are ordered once across the range, and a
splittable task can continue on a later day while retaining its part numbers.

ChatGPT should pass the exact `plan_week` result to `render_week_plan`. The widget uses a compact
day strip instead of squeezing a full calendar grid into the chat. Each day opens into the same
editable timeline used by the daily planner. `Adjust week` enables drag, keyboard movement, and
bottom-edge duration editing. `Prepare proposal` sends the exact reviewed multi-day JSON into the
existing immutable proposal flow and never writes directly to Things or Calendar.

Manual prompt:

> Read my Things tasks and Calendar availability for the next three days. Use plan_week to make a
> realistic plan, then show it as a LifeOS week-plan card. Do not change anything yet.

## Brain-dump canvas

LifeOS also exposes `ui://lifeos/brain-dump-canvas-v4.html`. After an exact brain dump is captured and semanticized, ChatGPT calls `render_brain_dump_canvas` with a calm review sheet. It presents task candidates as the primary reading rail, keeps Calendar ideas and unresolved questions in a supporting column, then places notes and an optional Mermaid visualization below. Source order is preserved and content always determines height, so generated placement hints cannot overlap or clip the review.

`review_brain_dump_memory(capture_id)` opens `ui://lifeos/memory-review-v1.html`. It compares the unaltered capture with Supermemory's extracted claims and labels every claim unreviewed. It makes no Things, Calendar, journal, or memory mutation. Meeting-debrief diagrams follow the small, provenance-aware layout guidance in `plugins/lifeos/skills/meeting-debrief/references/meeting-diagrams.md`; the raw transcript remains the source of record.

The preferred diagram node is `mermaid`. The widget loads the pinned Mermaid 11.17.2 ESM build from the CSP-allowlisted jsDelivr origin, strips diagram frontmatter, applies a host-aware light or dark theme, and renders at Mermaid's strict security level. A `custom_html` node remains as a legacy escape hatch for bespoke interactions Mermaid cannot express. Its HTML, CSS, and JavaScript run inside a nested `sandbox="allow-scripts"` iframe with a unique origin and an inner CSP that blocks network access, forms, navigation, storage access, and the parent LifeOS tool bridge. Normal canvas nodes never interpret model text as markup.

The canvas is a preview surface. Its action sends a follow-up prompt that enters the normal proposal workflow; it does not approve or apply external changes.

## Proposal review

LifeOS exposes `ui://lifeos/proposal-review-v1.html` for the immutable review boundary. After
`propose_changes` or `get_proposal`, ChatGPT calls `render_proposal_review` with that exact result.
The card shows every proposed Things and Calendar mutation, the source-snapshot count, and the
revision fingerprint. Its Approve and Reject controls call the corresponding LifeOS tools with the
exact visible `proposal_id` and `revision_hash`.

Approval still does not change Things or Calendar. The approved card offers a separate follow-up
action that asks ChatGPT to call `apply_approved_proposal`; ChatGPT remains responsible for the
destructive-action confirmation before any external write.
