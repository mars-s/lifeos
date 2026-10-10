# LifeOS desktop study: independent judgement

6 October 2026. Local design study, not a production-readiness assessment.

## Verdict

**React wins this prototype round, 82/100 versus SwiftUI's 79/100.** Its advantage is interaction completeness and reuse, not an inherent visual advantage of React.

**For the finished Mac app, recommend SwiftUI with the existing AppKit menu bar and native sync engine.** Keep web technology for the ChatGPT GenUI components. Borrow the React study's interaction details and supporting screens for the native app.

**Visual verdict: provisional draw.** Both implement the requested mountain-led, charcoal, serif-and-system-type direction. The inspected SwiftUI rendering closely matches the supplied desktop composition. There is not enough equivalent screenshot evidence here to claim that React is prettier, or that SwiftUI is prettier. Compare both at the same window size before making a final visual selection.

The requested **Sol 6.1 judge was not available** in this session. This is an independent review by the available inherited-model agent, not a Sol 6.1 evaluation.

## Evidence and method

The judge independently read both complete implementations, the shared brief, package/build configuration and prototype documentation. Both `npm run build` and `swift build` were independently rerun successfully.

The judge directly inspected `screenshots/swiftui.png`, a deterministic 1200 × 800 SwiftUI view rendering. This is not an operating-system window screenshot and does not show native title-bar controls.

The parent agent supplied these live observations:

- React: focus start/pause, task detail dialog, capture saved into the session Journal, sidebar collapse/expand, fresh reload and no warning/error console output.
- SwiftUI: focus start/pause, task detail sheet and closing it. Native capture was not live-verified.
- The parent viewed React at approximately 787 pixels wide, not at the SwiftUI snapshot's 1200-pixel width.

The judge's browser surface was unavailable. The available Helium window was an unrelated meeting, so the judge did not navigate it or interrupt it. React visual marks therefore have lower confidence than the independently inspected SwiftUI rendering.

Scores below are comparative design judgements, not measured accessibility, performance or energy results. Source evidence supports intended behaviour, while live observations support only the paths explicitly listed above.

## Weighted scorecard

| Criterion | Maximum | React | SwiftUI | Reason |
| --- | ---: | ---: | ---: | --- |
| Reference fidelity | 25 | 22 | 22 | Both reproduce the mountain fade, thin focus arc, compact summary circles, restrained sidebar and next-task/timeline composition. No equal-viewport visual tie-break was available. |
| Hierarchy and readability | 20 | 18 | 18 | One focus opportunity is the clear primary action. Both avoid a crowded task dashboard. Small secondary text remains a concern. |
| Interaction quality | 20 | 18 | 14 | React has working metric navigation, richer record detail, search, multiple session captures and more complete secondary screens. SwiftUI offers the essential focus/task/capture structure but several controls only change destinations. |
| Accessibility and adaptation | 15 | 11 | 10 | React includes focus-visible treatment, dialog focus containment/restoration, Escape handling and three preference media queries. SwiftUI includes native controls, a real Command-N shortcut and reduced-motion-aware sidebar animation. Neither has a complete accessibility audit. |
| Fit with native macOS shell | 10 | 4 | 9 | SwiftUI has a running standalone app, native sheets and actual window behaviour. React is a browser study with decorative traffic lights, not a desktop shell. Neither is integrated with LifeOS Sync yet. |
| Delivery and UI reuse | 10 | 9 | 6 | Both build. React's components and visual language are better placed for the existing web/ChatGPT UI work. SwiftUI fits the Mac direction but its views cannot directly become ChatGPT web widgets. |
| **Total** | **100** | **82** | **79** | **Small React lead for the current prototypes.** |

The three-point margin is small. The scoring should not be used to justify a costly framework migration.

## What is working

Both studies understand the reference well. The alpine scene provides atmosphere without becoming the main task. The focus button is calm but obvious. One next task, one capture prompt and a compact timeline communicate the day's story. Neither invents a health or productivity score.

Both correctly label their data and service limitations. A demo capture is not presented as a Things task or a synced record.

The SwiftUI screenshot demonstrates that a native implementation can achieve the intended visual character. There is no need to adopt React solely to get this aesthetic.

React has the stronger exploration of what happens after the first click. Meetings, priorities and journals have actual detail content. Its Journal can display multiple captured thoughts. Its Review explains that an illustrated relationship is not a generated insight.

## Changes before selecting a production direction

### Shared

1. **Use matched comparison screens.** Capture both at 1200 × 800 and at a smaller supported size, with the same state and loaded fonts. Inspect focus, task details and capture as well as Today.
2. **Increase small text.** Supporting labels frequently use 8–10-pixel or point sizes. Enlarge them and test contrast against the actual mountain scene. No contrast ratios were measured in this study.
3. **Make date navigation honest.** Both date arrows change the header while retaining the same sample itinerary. A production date change must reload the corresponding day. In the study, an explicit on-screen “same illustrative schedule” notice would avoid ambiguity.
4. **Audit keyboard and assistive technology behaviour.** Check VoiceOver names, selected navigation, focus order, sheet/dialog exit, larger text and window resizing. Native controls or ARIA attributes alone do not prove the whole experience is accessible.
5. **Keep trust state prominent after navigation collapses.** The full sidebar's demo/status wording disappears in the compact layout. Production saved, proposed, applied and offline states need another visible home.

### React

- The sidebar displays `⌘N`, but no matching keyboard handler exists. Implement the shortcut or remove the hint.
- Traffic lights are decorative. A desktop wrapper needs genuine close/minimise/zoom behaviour rather than controls that merely look native.
- The optional Google Fonts import makes exact typography network-dependent. Bundle licensed fonts or deliberately accept and test the fallback.
- State is intentionally lost on reload. Do not connect this capture flow to production until durable local saving, pending state and failure handling exist.

### SwiftUI

- Summary rings are informational, whereas the React rings navigate. Decide on one consistent interaction contract.
- The search icon browses Tasks rather than searching. It is help-labelled honestly, but the icon still suggests a different action.
- A kept capture replaces one `draft`; the Journal summary remains `1`. Use a draft collection and update related counts when connecting real records.
- Today has fixed-size regions and no scrolling container. Test its 860 × 680 minimum window, enlarged text and sheet sizes for clipping. This is a source-level risk, not a reproduced failure.
- Icon-only controls need deliberate accessible labels and keyboard checks. Tooltips are not a substitute for auditing their spoken names.
- The one-second publisher is connected even when focus is paused. Make the timer active only during a session before an energy review. This observation does not establish meaningful battery drain.

## Recommended next step

Take **SwiftUI as the Mac app shell** and close its interaction gaps using the React study as the behaviour reference. First implement a native Today window with readable supporting text, actionable summaries, true capture collection, honest date loading and explicit connection/proposal state. Keep it attached to the existing app lifecycle rather than creating a second always-running sync owner.

Keep the same artwork, semantic colours, typography hierarchy and task/journal/timeline vocabulary in React for ChatGPT widgets. Share data contracts and design tokens where practical, not necessarily view code.

Before wiring real writes, verify one read-only day from the existing LifeOS service. Then verify capture persistence and a reviewed proposal using the existing exact-revision approval path.

## Limits

- No battery, idle wake-up, memory, CPU or startup benchmark.
- No packaged Tauri application or Rust/native bridge.
- No SwiftUI integration with the production sync engine.
- No real Things, Calendar, microphone or memory access.
- No completed VoiceOver or keyboard-only audit.
- No matched-window visual comparison.
- No signed distribution assessment. The SwiftUI study bundle is locally ad-hoc signed.
- No Sol 6.1 model judgement.
