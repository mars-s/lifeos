# Meeting relationship diagrams

The [Diagram Design skill](https://github.com/cathrynlavery/diagram-design/tree/main/skills/diagram-design) is an optional authoring aid for a polished static export. The LifeOS canvas still uses its own Mermaid renderer. Apply the following choices to the *content* of that renderer; do not copy Diagram Design's default skin into LifeOS.

Choose one question for each figure. For transcript-to-debrief, use the [unstructured input → structured artifact pattern](https://github.com/cathrynlavery/diagram-design/blob/main/skills/diagram-design/references/semantic-patterns.md): show one short transcript excerpt, the user-owned task or decision it supports, and any unresolved owner or timing. A provenance arrow means “derived from this utterance,” not “verified true.” Notes-only claims have no transcript provenance arrow.

For the meeting relationship map, use a simple tree only when relationships are parent-child. Use a dependency graph when tasks depend on decisions, attendees, or shared blockers. Keep an overview to nine named nodes, with no more than three evidence links. Split a busy meeting into an overview and focused detail views. Group other attendees' actions as context, not as the user's tasks.

Make every edge label concrete: `assigned to`, `depends on`, `said in transcript`, or `unresolved`. Show `Unknown` rather than filling a missing deadline or owner. The meeting title, full transcript, and raw notes remain in the Brain Dump Capture; the diagram is a derived, replaceable view.

For a standalone static HTML/SVG export, load the full Diagram Design skill and its selected type reference. Resolve its style profile first, use the approved LifeOS theme rather than the shipped sample palette, avoid external font/network requests for private meeting content, and keep the diagram accessible in a single static frame.
