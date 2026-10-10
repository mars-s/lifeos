# LifeOS Today, React and SwiftUI study

6 October 2026. Local-only design exploration, not a replacement for LifeOS Sync.

## Shared direction

Use the supplied LifeOS desktop mockup as the primary layout reference. Adapt Oura's calm daily narrative, generous spacing and progressive disclosure. Do not add health measurements or a made-up productivity score.

The desktop has a restrained charcoal sidebar, a cyan alpine hero fading into the content surface, three compact summaries, a focus opportunity, one next task and a connected day timeline. Use serif display type for the narrative and system sans-serif type for controls.

Both implementations use fictional sample data:

- Tuesday, 6 October 2026.
- Three of eight tasks completed, two hours fifteen minutes open, one journal entry.
- A fifty-minute focus opportunity.
- Next task: Shape the LifeOS first draft, Studio.
- Design catch-up at 10:30, priorities outlined at 09:10, journal at 08:45.

Interactions: collapse navigation, start/pause focus, inspect a task and create an editable draft capture. Other navigation should reveal relevant sample content rather than dead buttons.

## Safety

No production credentials, Things writes, calendar writes, recording permissions or inference calls. Demo data must be labelled. Never imply a real sync connection exists. A locally saved draft is not an applied task.

## Comparison

Judge the implementations, not framework stereotypes:

| Criterion | Weight |
| --- | ---: |
| Reference fidelity | 25 |
| Hierarchy and readability | 20 |
| Interaction quality | 20 |
| Accessibility and adaptation | 15 |
| Fit with the native macOS shell | 10 |
| Delivery and UI reuse | 10 |

Record build checks separately from observed runtime behaviour. Neither a successful build nor a screenshot proves complete keyboard accessibility, low battery consumption or real sync.

The requested Sol 6.1 judge is not exposed by this session's subagent tool. The independent review uses the inherited agent model instead and must not be described as a Sol 6.1 result.

## Shared image

`shared/mountain.png` is an original generated landscape, made with the built-in image-generation tool. Both implementations use the same file.

Prompt: cinematic snow-covered alpine mountain range at blue dawn, one central pyramidal snowy peak, dark nearer ridges, expansive cyan-teal sky; wide 16:9 photograph with quiet sky for interface overlays; cool diffused light, subdued contrast, charcoal foreground; no interface, words, numbers, people, logos or watermark.

## Framework references

- Apple NSHostingView documentation: SwiftUI can be hosted in an AppKit view hierarchy.
- React installation and Vite getting-started documentation: the React study is a web frontend, not a packaged Tauri application.
