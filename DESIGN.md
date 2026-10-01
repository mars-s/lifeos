---
name: LifeOS
description: A calm, native-feeling planning instrument for reviewable plans and planning canvases.
colors:
  panel-light: "#ffffff"
  panel-dark: "#20201f"
  panel-muted-light: "#efefec"
  panel-muted-dark: "#292927"
  panel-raised-light: "#e9e9e5"
  panel-raised-dark: "#323230"
  text-light: "#191918"
  text-dark: "#f3f3ef"
  muted-light: "#6b6b66"
  muted-dark: "#b0b0aa"
  faint-light: "#656560"
  faint-dark: "#a1a19a"
  line-light: "#ddddda"
  line-dark: "#3a3a37"
  accent-light: "#2559d6"
  accent-dark: "#789cff"
  accent-text-light: "#ffffff"
  accent-text-dark: "#101423"
  focus-light: "#6e96f6"
  focus-dark: "#9ab4ff"
  warning-light: "#9b4c09"
  warning-dark: "#f3b56e"
  warning-bg-light: "#fff1df"
  warning-bg-dark: "#3b2a1b"
  task-blue-light: "#e6ecff"
  task-blue-dark: "#25345a"
  task-blue-text-light: "#17377e"
  task-blue-text-dark: "#dbe5ff"
  task-green-light: "#e5f2ea"
  task-green-dark: "#203f2e"
  task-green-text-light: "#245438"
  task-green-text-dark: "#d8f4e2"
  task-plum-light: "#f2e8f7"
  task-plum-dark: "#442a4c"
  task-plum-text-light: "#5b2b72"
  task-plum-text-dark: "#f3dcf8"
  status-green: "#3da46a"
typography:
  display:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "clamp(20px, 4.5vw, 27px)"
    fontWeight: 670
    lineHeight: 1.08
    letterSpacing: "-0.025em"
  metric:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.2
  title:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 680
    lineHeight: 1.2
  body:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  control:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 650
    lineHeight: 1.2
  label:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.25
rounded:
  control: "10px"
  timeline: "12px"
  shell: "14px"
  pill: "999px"
  circle: "50%"
spacing:
  tight: "8px"
  control: "10px"
  compact: "12px"
  content: "16px"
  section: "20px"
components:
  button-primary:
    backgroundColor: "{colors.accent-light}"
    textColor: "{colors.accent-text-light}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-primary-dark:
    backgroundColor: "{colors.accent-dark}"
    textColor: "{colors.accent-text-dark}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.panel-muted-light}"
    textColor: "{colors.text-light}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "44px"
  status-pill:
    backgroundColor: "{colors.panel-muted-light}"
    textColor: "{colors.muted-light}"
    rounded: "{rounded.pill}"
    padding: "0 10px"
    height: "30px"
  metadata-chip:
    backgroundColor: "{colors.panel-raised-light}"
    textColor: "{colors.muted-light}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "21px"
  metadata-chip-dark:
    backgroundColor: "{colors.panel-raised-dark}"
    textColor: "{colors.muted-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 7px"
    height: "21px"
  day-plan-shell:
    backgroundColor: "{colors.panel-light}"
    textColor: "{colors.text-light}"
    rounded: "{rounded.shell}"
    width: "760px"
  timeline:
    backgroundColor: "{colors.panel-muted-light}"
    textColor: "{colors.faint-light}"
    rounded: "{rounded.timeline}"
    height: "300px"
  task-block-blue:
    backgroundColor: "{colors.task-blue-light}"
    textColor: "{colors.task-blue-text-light}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 34px 9px 11px"
  task-block-green:
    backgroundColor: "{colors.task-green-light}"
    textColor: "{colors.task-green-text-light}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 34px 9px 11px"
  task-block-plum:
    backgroundColor: "{colors.task-plum-light}"
    textColor: "{colors.task-plum-text-light}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "9px 34px 9px 11px"
  warning-item:
    backgroundColor: "{colors.warning-bg-light}"
    textColor: "{colors.warning-light}"
    rounded: "{rounded.control}"
    padding: "10px 11px"
---

# Design System: LifeOS

## Overview

**Creative North Star: "The Calm Planning Instrument"**

LifeOS should feel like a precise planning surface embedded naturally inside the conversation. The interface is compact, quiet, and immediately legible: the plan itself carries the visual weight, while status, summary, and actions form a restrained frame around it.

The world borrows the neutral material, fine separators, system typography, and controlled density of ChatGPT and Cursor. It avoids decorative dashboard chrome. Brand character comes from exact spacing, gentle geometry, an adaptive light/dark palette, and a small family of muted task hues rather than ornament.

**Key Characteristics:**

- Calm, direct, and native-feeling on macOS.
- One blue action color, reserved for consequential interaction.
- Neutral surfaces divided by fine lines instead of stacked cards.
- Soft blue, green, and plum task fills that clarify without competing.
- Dense information with clear hierarchy and no detached metric tiles.
- Bounded work surfaces that move from a desktop grid to one source-ordered mobile column.
- Mermaid relationship views that clarify a brain dump without displacing its structured review.
- Quiet, centered meeting documents that organize debriefs into Summary, My tasks, Relations, and Transcript without borrowing another product's surrounding chrome.
- Full light and dark appearances, visible keyboard focus, and reduced-motion support.

## Colors

The palette is neutral-first and appearance-aware. Light and dark tokens are paired by semantic role; implementations switch the complete role set with the user's color-scheme preference rather than inverting isolated colors.

### Primary

- **Deliberate Blue** (`accent-light`, `accent-dark`): the only primary action color. Use it for the final forward action and browser-native accent behavior.
- **Clear Focus Blue** (`focus-light`, `focus-dark`): a distinct, lighter blue used only for the three-pixel focus-visible outline.

### Secondary

- **Task Blue** (`task-blue-light`, `task-blue-dark`, with paired text): a quiet grouping surface for candidate tasks and schedule blocks.
- **Task Green** (`task-green-light`, `task-green-dark`, with paired text): a restrained grouping surface for calendar context, not a success state.
- **Task Plum** (`task-plum-light`, `task-plum-dark`, with paired text): a restrained grouping surface for journal context and the third schedule-block family.

### Tertiary

- **Attention Amber** (`warning-light`, `warning-dark`, with paired background): reserved for work that still needs time.
- **Ready Green** (`status-green`): the small status dot only. Do not spread it across actions or task categories.

### Neutral

- **Panel** (`panel-light`, `panel-dark`): the main shell surface.
- **Muted Panel** (`panel-muted-light`, `panel-muted-dark`): timeline field, secondary controls, and status capsule.
- **Raised Panel** (`panel-raised-light`, `panel-raised-dark`): compact metadata tags and neutral controls that must remain distinct inside muted or tinted fields.
- **Primary Ink** (`text-light`, `text-dark`): headings, metric values, and control labels.
- **Muted Ink** (`muted-light`, `muted-dark`): supporting explanation and secondary state.
- **Faint Ink** (`faint-light`, `faint-dark`): time labels and scrollbars where lower emphasis is intentional.
- **Hairline** (`line-light`, `line-dark`): one-pixel section boundaries and timeline rules.

### Named Rules

**The One Blue Action Rule.** Blue signals the deliberate next step. Secondary actions stay neutral, and category color never borrows the action blue's authority.

**The Restrained Spectrum Rule.** Blue, green, plum, and amber may group schedule blocks or review zones, but their low-saturation surfaces must keep the instrument calm. Every hue remains paired with a plain-language label or icon; never make color carry an unsupported status, priority, or risk promise.

## Typography

**Display Font:** the platform UI sans stack, led by `ui-sans-serif` and San Francisco on Apple devices.

**Body Font:** the same platform UI sans stack.

**Character:** One system family carries the complete interface. Hierarchy comes from compact size changes, dense weights, negative display tracking, muted color, and tabular numerals—not from mixing typefaces.

### Hierarchy

- **Display** (`display`): the date only. It uses a responsive size, tight leading, and slightly negative tracking so the header feels confident without becoming promotional.
- **Metric** (`metric`): compact numeric summaries with tabular figures for steady alignment.
- **Title** (`title`): section headings such as “Proposed schedule.”
- **Body** (`body`): explanatory copy and empty/error states.
- **Control** (`control`): task titles and action labels; short, direct, and semibold.
- **Label** (`label`): metric labels, task times, and supporting metadata. Time values use tabular numerals.

### Named Rules

**The System Voice Rule.** Stay in the platform UI sans stack. LifeOS should read like a trusted tool inside the host application, not a branded editorial page.

**The Numeric Stability Rule.** Time and duration values use tabular numerals so scanning does not produce visual jitter.

## Layout

The day plan is one bounded shell, centered at full available width up to 760px. Its sections form a single reading path: date and preview state, three-column summary, schedule rail, unscheduled disclosure, then actions. Section boundaries are one-pixel hairlines; metrics are segments of one row, not separate cards.

Desktop spacing is compact but comfortable: 20px section insets, an 18px top inset around the main content, and 8–14px gaps inside controls and rows. The timeline reserves a 66px rail for time labels and uses the remaining width for blocks. Its rendered height scales with the planning window but stays between 300px and 520px.

At 520px and below, the outer inset tightens to 6px, section padding contracts to 16px, metrics use 12px horizontal padding, and the two actions share the row equally. The secondary timeline annotation hides, while the three summary columns remain intact and labels are allowed to wrap.

Meeting debriefs use a quiet, centered document surface rather than a multi-zone dashboard. A compact header establishes the meeting and preview state, followed by a single tab row in this fixed order: Summary, My tasks, Relations, Transcript. The content remains one readable column; the footer preserves the preview boundary and proposal actions. On narrow screens, metadata wraps naturally, the tab row remains horizontally usable, and actions retain full touch targets without changing the information order.

**The Single-Rail Rule.** Keep the schedule as the dominant object. Supporting facts may frame it, but must not fracture into a dashboard grid of competing cards.

**The Centered Debrief Rule.** Meeting review should feel like reading one composed document. Keep surrounding brand navigation, sidebars, and capture composers out of the surface; LifeOS owns only the debrief and its safe next actions.

**The Structured Truth Before Relationships Rule.** Tasks, Calendar support, questions, and journal evidence remain the primary review record. Mermaid is the first-class way to show relationships between them, but it follows and never replaces the structured content.

## Elevation & Depth

Depth is structural and quiet. The shell is the only lifted surface; everything inside it is separated with tone and hairlines. Task blocks use tinted fills and a one-pixel hover lift instead of shadows. This keeps hierarchy obvious without stacking floating panels.

### Shadow Vocabulary

- **Shell, light:** a broad, low-opacity ambient shadow that separates the component from the host canvas.
- **Shell, dark:** a slightly larger, darker ambient shadow that survives against a dark host surface.
- **Status glow:** a tiny green halo on the ready dot; it communicates live preview state without becoming decoration.

### Named Rules

**The One Lifted Surface Rule.** Only the outer shell owns ambient elevation. Interior sections stay flat and derive structure from tone, spacing, and hairlines.

## Shapes

The form language is gently curved and compact. The outer shell uses the largest corner, the timeline a slightly smaller one, and buttons, task blocks, and warning items share the same 10px control radius. The preview status is a full pill and its indicator is circular. One-pixel borders appear only as separators; controls do not receive decorative outlines at rest.

**The Nested Radius Rule.** Radii step down with containment: shell, timeline, then controls. Avoid mixing sharp cards or exaggerated capsules into the same hierarchy.

## Components

### Buttons

- **Shape:** compact rounded rectangle (`control`) with a 44px minimum height and short horizontal padding.
- **Primary:** deliberate blue with its paired high-contrast text; use for the final proposal-preparation action.
- **Secondary:** muted panel fill with primary ink; use for revising or stepping sideways.
- **Hover / Focus:** hover darkens through a subtle brightness filter, active presses down by one pixel, and focus uses the dedicated three-pixel focus ring. Disabled controls reduce opacity and remove the pointer cursor.
- **Responsive:** on compact widths, paired actions grow equally to fill the footer.

### Chips

- **Preview status:** a 30px-tall neutral pill with compact semibold type, a small green status dot, and no border.
- **Role:** communicate non-destructive preview state. It is informational, not interactive.
- **Metadata tag:** a 21px-tall raised-neutral pill with compact label type. Use it for provenance, context, or timing qualifiers inside a task or review zone; never style it like an action.

### Cards / Containers

- **Day-plan shell:** the only elevated container, capped at 760px with a 14px corner.
- **Timeline field:** a flat muted surface with a 12px corner, a fixed time rail, faint horizontal rules, and clipped overflow.
- **Summary strip:** three equal segments divided by hairlines. Do not render each metric as its own floating card.
- **Review zone:** a flat 12px container with a sticky 42px header, one-pixel internal separators, and compact rows. Muted semantic fills may group task, calendar, journal, or question content only when the header names the category explicitly.

### Timeline Task Blocks

- **Shape:** 10px corners, at least 36px tall, and a right inset reserved for the external-open mark.
- **Color:** rotate through the blue, green, and plum surface/text pairs. These are quiet grouping cues, not priority or status badges.
- **Type:** semibold task title above smaller tabular time metadata; long titles truncate to one line.
- **Interaction:** the complete block is a button. Hover applies a slight darkening and one-pixel lift; focus remains explicit; reduced-motion mode removes the transition.

### Unscheduled Work

- **Disclosure row:** a neutral, full-width summary beneath a hairline; the count leads and a plain plus mark closes the row.
- **Warning item:** amber text on a paired soft amber surface, with a compact title and reason. It appears only after disclosure.

### Mermaid Relationship View

- **Role:** Mermaid is the first-class relationship visualization for a brain dump. Use it for flows, dependencies, timelines, journeys, and mind maps that are materially easier to understand as a diagram.
- **Hierarchy:** place it in the Relations tab after the structured Summary and My tasks views. Treat the diagram as an explanatory layer, not the source of truth or a competing hero surface.
- **Canvas:** use a subtle dotted field with visible connectors and distinct low-saturation pastel node families. Color distinguishes kinds of information but never carries unsupported status by itself.
- **Interaction:** support pointer dragging, keyboard panning, bounded zoom controls, fit-to-view, and an expandable view. Restore focus when the expanded view closes and keep the diagram operable without pointer input.
- **Theme:** derive Mermaid's theme from the host's light or dark appearance. Reserve the strong action color for consequential actions and explicit focus treatment.
- **Narrow screens:** keep the diagram at a legible intrinsic width and pan inside its own bounded region rather than shrinking labels into unreadability.
- **Accessible equivalent:** every Mermaid node needs a meaningful plain-language summary in its body. The rendered SVG must contain a title and description that identify the diagram and repeat its relationship summary for assistive technology.

### Meeting Debrief

- **Navigation:** use exactly four document tabs—Summary, My tasks, Relations, Transcript—with counts only where they aid scanning.
- **Task evidence:** group Avinaba's tasks by LifeOS area and pair each task with an explicit evidence label. Unclear ownership belongs in Summary as a question, not in My tasks.
- **Safety:** keep the preview state and “nothing has changed” message visible. Continue planning and prepare proposal may advance review, but neither implies that Things or Calendar has already changed.

## Do's and Don'ts

### Do:

- **Do** keep the plan as one continuous instrument with a clear top-to-bottom reading path.
- **Do** reserve blue for the deliberate forward action and explicit focus treatment.
- **Do** pair every semantic color with its light and dark counterpart.
- **Do** preserve visible focus, 44px action targets, readable contrast, and reduced-motion behavior.
- **Do** keep meeting debriefs on one centered document surface with Summary, My tasks, Relations, and Transcript tabs.
- **Do** make relationship canvases draggable, keyboard-pannable, zoomable, expandable, and readable at mobile widths.
- **Do** label task evidence and keep ambiguous ownership in a review question.
- **Do** give every Mermaid node a plain-language body summary and its rendered SVG a title and description.
- **Do** use hairlines, tonal fields, and precise spacing before adding another container.

### Don't:

- **Don't** turn summary facts into detached dashboard cards.
- **Don't** add gradients, glossy glass, ornamental illustrations, or extra accent colors.
- **Don't** use task-block hues as unsupported priority, completion, or risk semantics.
- **Don't** let a Mermaid diagram replace structured tasks, Calendar ideas, questions, or journal evidence.
- **Don't** reproduce reference-product brand marks, sidebars, navigation, or composer chrome around a LifeOS meeting debrief.
- **Don't** use strong blue to decorate Mermaid nodes or edges; reserve it for primary actions and explicit focus treatment.
- **Don't** elevate interior sections with competing shadows.
- **Don't** hide the review boundary: preview copy and proposal actions must continue to make clear that nothing has changed yet.
