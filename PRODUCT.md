# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Delegated. The agent will choose the implementation stack after verifying the Things 3, EventKit, MCP, background-service, and future mobile requirements on real target systems. The product starts as a local MCP service and later adds a macOS application and a smaller mobile journal experience.

## Users

The only initial user is Avi. He balances two jobs and university study and does not have time to maintain a planning system manually.

## Product Purpose

LifeOS reduces the amount Avi must remember and organize himself. It turns free-form input into reviewed journal content, Things projects and tasks, and scheduled calendar time.

The first usable form is a local MCP service that lets ChatGPT and Claude inspect and organize Things 3, propose schedules, and apply approved changes to Things 3 and Apple Calendar. Its first end-to-end job is planning tomorrow and the following day from existing Things tasks and Calendar availability. A later macOS application adds a generative approval and planning canvas.

## Positioning

LifeOS does not replace Things 3 or Apple Calendar. It links their records, supplies agent-readable planning context, and coordinates reviewed changes across both systems.

## Operating Context

- Things 3 is the task system and synchronizes its records through Things Cloud.
- Apple Calendar aggregates personal, university, subscribed, and other calendars across Apple devices.
- LifeOS initially runs on Avi's MacBook for daily and weekly planning.
- ChatGPT and Claude connect through a local MCP interface.
- ChatGPT acts as an MCP client in the first phase. LifeOS does not embed a separate ChatGPT session merely to provide MCP access.
- Phone access initially relies on Things 3 and Apple Calendar for quick review.
- The future mobile surface prioritizes journal capture and retrieval.

## Capabilities and Constraints

- Things 3 is authoritative for task content, project membership, dates, and completion state.
- Apple Calendar is authoritative for precise timing.
- LifeOS stores the durable relationship between a Things Task and its Planned Work Blocks.
- A Calendar work block may mirror selected task context and contain a `things:///show?id=...` link.
- Things 3 has no native bidirectional synchronization between a to-do and a Calendar event. LifeOS owns reconciliation.
- Agents may organize the Things Inbox, create and update projects and tasks, improve task wording and context, and propose calendar changes.
- Meeting debriefs cross-check supplied notes against the transcript before deriving work. They show only tasks assigned to Avinaba, group those tasks by LifeOS area, and label the evidence behind each result.
- When meeting ownership is unclear or the notes and transcript disagree, LifeOS presents a question for review instead of creating a task. Work meetings normally route to the Paperless area unless the evidence supports another area.
- Meaningful changes require a visible proposal and user approval before LifeOS applies them.
- The long-term capability target is broad. Delivery proceeds through small, verified slices.
- Daily Journal Markdown remains readable and portable. Derived memory remains rebuildable.
- The journal should be able to synchronize through an Apple-compatible file location without making a home server mandatory.
- Exact app stack, ChatGPT authentication method, cloud AI data policy, and hosted sync architecture remain open decisions.

## Brand Commitments

- The working product name is LifeOS.
- The interface should feel calm, direct, and native to macOS.
- The ChatGPT Mac app and Cursor are explicit references for later visual exploration.
- No final palette, typography, component system, or visual world has been selected.

## Evidence on Hand

- The initial product and architecture brief is `/Users/avi/Downloads/ai_planner_product_architecture_spec.md`.
- The project glossary is `/Users/avi/Documents/ChatGPT/lifeos/CONTEXT.md`.
- There is no existing application code, logo, design system, user research corpus, or production usage data.
- Future work must not invent testimonials, benchmark results, or provider capabilities.

## Product Principles

- Preserve Things 3, Apple Calendar, and Markdown as usable systems outside LifeOS.
- Let agents propose broadly, but apply only the revision the user reviewed.
- Keep precise time in Calendar and task meaning in Things 3.
- Prefer one shared command model for MCP clients, deterministic controls, and the future application.
- Build for daily relief from planning overhead, not feature-count completeness.

## Accessibility & Inclusion

The macOS application must support keyboard operation, clear focus states, readable contrast, reduced motion, and screen-reader labels for approval controls.
