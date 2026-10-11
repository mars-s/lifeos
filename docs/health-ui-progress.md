# Health UI progress

## 11 October 2026

Goal: complete native Today and health journeys, with Oura-inspired styling,
working controls, accessible materials and isolated visual verification.

Boundaries: preserve existing changes. No commits, deployments, credential or
permission changes, production data writes or installed sync app replacement.

Initial audit:
- Live health always selects the latest day. No day or period selection.
- Metric cards have no detail navigation.
- Live health polls every 30 seconds. Preview uses a separate static view.
- Existing background scenes and native glass should be retained.
- Existing tree is dirty, including the health implementation.

Next: shared history selection and comparison logic, explicit refresh lifecycle,
metric detail, preview parity, then native interaction and visual checks.

Completion remains unproven until all six requested journeys, small-window and
accessibility behaviour, build/tests and screenshots have been checked.

First implementation pass:
- Added calendar-window history selection for 7, 14 and 30 days with missing-data-aware averages.
- Added metric detail sheets with units, source, record update time, history and previous-period comparisons.
- Added accessible minute-by-minute sleep scrubbing and filtered stage totals.
- Preview now uses the same Health view as live records, with in-memory labelled fixtures.
- Sources offers Recorded days, Empty and Offline preview states. Preview never reads Keychain.
- Removed 30-second polling. Explicit refresh and stale-on-activation refresh remain.
- Adaptive metric layout retains existing scenes and sidebar glass.

Evidence so far:
- Swift test/build passed after the main implementation. Latest text fixes re-tested.
- Backend: six Node tests and TypeScript checking passed.
- Native AX verified Overview -> HRV detail, 7/14-day history change and Escape dismissal.
- Native AX verified Sleep Deep filter totals (1h 28m), slider Increment (12:01am), and recorded-stage feedback.
- Native AX verified Sources -> Empty -> Overview with an Open Sources recovery button.
- Native screenshot exposed a wrapped period-picker label. Fixed by hiding its visual label while retaining accessibility naming.
- An initial ScreenCaptureKit capture failed; reconnecting after preview rebuild restored screenshots.
- The older fixture Sources/empty copy implied backend connectivity. Corrected in source; needs refreshed UI verification.

Still needed: visual hierarchy refinement, compact window and keyboard traversal,
loading/error preview coverage, richer chart selection, retained selection across
Today/Health, all page/day/retry journeys, screenshots and final requirement audit.
Do not mark complete from the existing build/tests or synthetic records alone.

Second implementation pass:
- Removed CometMark's continuous 30fps decorative TimelineView.
- Desktop owns the health store, selected day and comparison period across Today/Health navigation.
- Sources now provides typed Recorded, Empty, Offline, Loading and Error preview scenarios.
- Retry restores the isolated error/offline preview. Loading is bounded and generation-checked.
- Added health-store tests for transitions, preview credential no-ops and obsolete-load suppression.
- Sidebar navigation scrolls in shorter windows. Added Command-1 through Command-6 destination shortcuts.
- Health toolbar has a page menu usable while the sidebar is collapsed.
- Window minimum is 760x560. Preview frame persistence is separate from the production frame.
- Compact preview explicitly overrides restored frame size after an observed sizing bug.
- Moved measurements above summary, shortened status presentation, and made Movement metrics inspectable.
- Body-signal charts report the nearest recorded sample rather than interpolating missing measurements.
- Native screenshot saved at artifacts/health-ui/native-overview.png.

Verification:
- 48 Swift tests passed, including the new health-store target. Latest sizing/export guard changes re-tested.
- Signed local app build succeeded. Installed production app untouched.
- Native inspection confirms the corrected period picker no longer wraps its label.
- The attempted NSHostingView bitmap export produced black images. A pixel-content guard now fails that path instead of reporting success.
- Files named today.*.png from the offscreen export are NOT valid visual evidence yet.

Next actions:
1. Rebuild and reopen only the named project preview with --preview-compact. Confirm actual compact dimensions via screenshot.
2. Verify day selection retained across Today, collapsed-menu navigation, Error -> Retry, Loading -> recorded, and all page journeys.
3. Save real native screenshots via cua_repl getScreenshot bytes and node:fs/promises, which worked without changing permissions.
4. Repair or clearly replace the offscreen snapshot option. Do not claim the black exports as evidence.
5. Verify Reduce Motion/Transparency in isolated preview overrides, keyboard traversal, chart interactions and scrolling.
6. Run the completion audit, final Swift/backend checks and document exact limitations.

Do NOT run npm run verify:local against the shared backend: its script writes a synthetic record and restarts Docker. Use isolated checks or existing pure Node tests/typecheck under the no-production-write boundary.

Third implementation and native verification pass:
- Rebuilt the signed project bundle. Confirmed the real compact preview is 760x560, with scrolling Health content and sidebar navigation.
- Native interaction verified historical day 2026-10-10 remains selected after Command-1 Today and Command-2 Health.
- Collapsed sidebar Health menu reaches Sources and Sleep. Native menu activation requires Return after choosing its item in AX automation.
- Sources Error -> Retry restores 14 labelled synthetic days, without credentials or backend writes.
- Historical Sleep shows an explicit missing-session state rather than invented stages or efficiency.
- Added preview-only Reduce Motion/Transparency switches with custom environment values. SwiftUI's system accessibility environment values are read-only, so overrides combine with them instead of attempting to overwrite them.
- Native screenshot confirms the sidebar and status surfaces become solid and readable under Reduce Transparency. System preferences were not changed.
- Added a test for opt-in accessibility overrides. Backend checks re-run: six Node tests and TypeScript checking pass.
- README now warns that offscreen exports are unreliable and points to actual native preview screenshots.
- New valid native evidence: native-compact.png, native-error.png and native-reduced-transparency.png under artifacts/health-ui.

Still incomplete: full keyboard traversal (Tab currently leaves window focus unchanged), all-page screenshots and metric/chart interaction audit, loading visual evidence, and a reliable replacement for offscreen snapshot export. The completion goal remains active. No production app, records, credentials, permissions, commits, pushes or deployments changed.

Keyboard follow-up:
- Reproduced the missing Tab focus on custom-styled navigation buttons.
- Explicit focusability alone reached the control but swallowed Space/Return activation.
- Added KeyboardActionButton with Tab focus and explicit Space/Return activation, respecting disabled state.
- Applied it to sidebar navigation, metric cards, refresh/retry, sleep navigation and selected-date inspection.
- Native test: Tab twice, Space opens Health from Today. Two more Tabs and Return opens Sleep. No OS keyboard preference changes.
- Latest prior verification: 49 Swift tests pass, signed build passes, --desktop-check passes. Re-running after the keyboard changes.
- Remaining keyboard work: metric-sheet traversal, native pickers/sliders and recovery controls, plus visible focus-ring audit.
- Saved native-sleep-keyboard.png after scrolling to stages at compact size. The chart, stage picker and scrubber fit without overlap, and the focused Sleep navigation row shows a clear blue focus ring.
- Final checks for this pass: 49 Swift tests passed. Signed release build passed. Existing Keychain deprecation warnings remain unrelated to this UI work.

Fourth pass, keyboard and charts:
- Added shared RecordedSelectionControls for previous/next recorded history days and signal samples. It never interpolates measurements.
- Native metric-sheet verification: Tab reaches controls, Space selects a recorded value, Shift-Tab and Right change the period from 7 to 14 days.
- Native chart review exposed truncated axis labels (20...). Replaced with sparse day/month labels such as 5 Oct and 11 Oct.
- History selection now highlights the selected bar. Sleep inspection has a visible time rule. Selected signal points grow without filling gaps.
- Added focusable arrow-key handling to native day, period, stage and preview-state controls, plus minute-by-minute sleep scrubbing.
- All custom Today actions, capture actions and collapsed-sidebar controls now use keyboard-aware buttons. Disabled controls ignore keyboard activation.
- Corrected failure and loading empty-state messages, which previously described both as an empty preview.
- Native Movement verification: green scenery, readable dates and selected 2026-10-05 value (6,240 synthetic steps). Inspect opens that date's records.
- Native signal verification: Next selects 52 bpm at 00:00, then 53 bpm at 00:30. Missing HRV/oxygen series stay explicitly empty.
- Valid screenshot: artifacts/health-ui/native-movement-history.png.
- 49 Swift tests passed before the final chart-highlight tweak. Latest signed build passed before that tweak; re-run required.

Next: native loading screenshot, sleep pointer and keyboard scrubbing, missing metric detail, updated signal screenshot and all-page navigation audit. Then audit daily-planning placeholders against the full goal rather than claiming them as implemented journeys. Production task/calendar writes remain forbidden.

Fifth pass, 11 October:
- Preview Loading is now held until Finish preview load is activated. This is an inspectable fixture, not an artificial delay or a live-network test.
- Loading -> Sources -> Finish preview load restores the 14 synthetic days. Failure does not claim a successful last-loaded timestamp.
- Earlier/Later minute buttons provide a keyboard alternative to the native sleep slider. Native Space activation advances 00:00 to 00:01 with matching stage feedback and a visible focus ring.
- Native missing oxygen detail says Not recorded and still shows available history. Escape returns to the originating metric.
- Actual window zoom expanded the 760x560 preview to a wide desktop layout. Sleep stages, minute controls, history and the translucent sidebar remained readable without overlap.
- Pointer drag attempts did not change the slider. This remains unverified, not a passed interaction. No global pointer fallback or permission changes were used.
- Corrected sidebar selection accessibility traits and removed bounce from button press feedback.
- Fresh checks: 50 Swift tests passed, six backend Node tests passed, TypeScript checking passed.
- Valid native captures include native-loading-active.png, native-missing-metric.png and native-sleep-minute-controls.png.
- Scope audit: Today has a focus timer and session drafts, but Tasks and Calendar remain unconnected. These are not finished daily-planning journeys. The sync owner's LocalReplica already stores canonical task items; inspect a read-only typed projection for the next implementation, without constructing another sync engine or polling.

Remaining: verify pointer chart interactions, repeat accessibility checks on the latest build, connect read-only daily-planning journeys, and finish the requirement-by-requirement audit. Goal remains active.

Latest signed build completed in 10.73 seconds. The isolated --desktop-check passed. Native AX verification confirms Health and Sleep are selected, while Tasks is no longer incorrectly announced as selected. Saved native-sleep-wide.png shows the actual expanded window, not an offscreen export. Existing Keychain deprecation warnings remain unrelated to these changes.

Sixth pass, native task planning:
- Added PlanningSnapshot and a SELECT-only LocalReplica accessor. It reads only a fully committed replica, not partial bootstrap data, and does not advance cursors or command flags.
- Existing sync owner supplies the snapshot through DesktopModel. Reads are skipped when its revision is unchanged. No inventory call, network call, timer or second sync engine was added.
- Today now shows recorded open Today-list tasks. Native Tasks supports Today/Open/All stored filters, search, empty-search recovery and read-only details.
- Titles, notes, status, project, area, activation date, deadline and update are shown only when stored. Unknown status/membership never guesses an open Today task. Deleted and explicitly trashed items are excluded.
- Detail sheets freeze the selected task and source revision. Preview/live use the same views, with labelled demo tasks supplied only in preview.
- Fixed selected sidebar rows being clipped after keyboard shortcuts by scrolling the selection into view. Added a dark source badge for contrast against the mountain.
- Native compact checks: Command-3 opens Tasks, Open reveals both demo tasks, a nonmatching search shows recovery, Show all stored clears it, task inspection opens, scrolling reveals source, Escape returns focus to the originating row. Tab and Space also open task details without mouse input.
- Valid captures: native-tasks.png and native-task-provenance.png. These are synthetic UI evidence, not real Things integration proof.
- Checks before final ordering consistency change: 55 Swift tests passed, signed build passed in 10.80 seconds, --desktop-check passed, six backend tests passed and TypeScript checking passed. Re-run Swift/build after ordering change.

Next: verify task model update caching and latest ordering build; add a real read-only calendar journey only through existing authorised access, with no permission request or production event write. Calendar is still explicitly unconnected. Finish Health pointer/accessibility audit. Full goal remains active, and installed production sync has not been restarted or replaced.

Final ordering change checked: 55 Swift tests passed again. Latest signed build and isolated lifecycle check passed. Preview and live snapshots now use the same deterministic alphabetical ordering, with stable-ID tie breaks.

Seventh pass, read-only Calendar:
- Added a bounded one-day EventKit reader. It checks existing full access, never requests access, never saves/removes events, and runs off the main actor. No recurring timer or sync engine was added.
- Added Calendar day selection, Previous/Today/Next, refresh, event details, source/read time, empty/disconnected/loading/error states and retry. Event details freeze the original event/read time.
- Added a Calendar usage-description declaration to the project bundle, not a permission grant. No system permissions were checked or changed during preview verification.
- Preview uses labelled illustrative data and never invokes the real reader. One task identity combines day/scenario so initial preview loading is not duplicated.
- Five new tests cover preview isolation, unavailable access versus empty data, failure timestamps, day stepping and a genuinely suspended older response that cannot overwrite a newer day.
- Native compact verification: Command-4 opens Calendar. Next selects 12 October, which survives Today and back. Detail shows 12 October 10:00-11:00 and illustrative provenance. Empty shows no events; Error -> Retry restores the illustrative event. Tab/Space opens details, Escape returns focus to the event row.
- Before the final invalid-event guard: 60 Swift tests passed, signed build passed in 11.69 seconds, isolated --desktop-check passed, plist validation passed. Re-run after that guard.
- Valid screenshot: native-calendar-details.png. This is synthetic evidence, not proof of real EventKit access or health ingestion.

Remaining goal work: latest checks and native calendar state screenshots, Health pointer/accessibility audit, and a full requirement matrix. Do not expand Calendar permissions or restart the installed sync app to obtain live proof. Existing authorised access can remain unavailable as an explicit limitation.

Sidebar follow-up: both immediate and post-mount scroll requests failed to keep Calendar visible after sidebar expansion. Removed the extra scheduling attempt. Health sub-navigation now appears only while Health is selected, so other destinations do not inherit five unrelated rows in a compact window. Verify this structural change natively before claiming it fixed.

Native follow-up passed: Calendar remains fully visible after collapse/expand, and Command-2 restores all five Health pages. Updated native-calendar.png records the simplified sidebar. Calendar Loading -> Finish preview load also passed, captured in native-calendar-loading.png. All 60 Swift tests passed after the structural fix, the signed build passed in 11.45 seconds, --desktop-check passed, six backend tests and TypeScript checking passed. Final small accessibility-hint correction needs a rebuild before handoff.

Final hint correction rechecked: 60 Swift tests passed, latest signed build passed in 11.44 seconds and --desktop-check passed. Project-local preview reopened. No production app, records, permissions, credentials, commits, pushes or deployments changed. Continue with the full completion audit and remaining Health interaction verification, not additional dashboard tiles.

Sleep session isolation, 11 October:
- Replaced the shared scrub date with session-keyed inspection state. Changing the recorded day clears all scrub positions.
- Added a second, explicitly illustrative sleep session on 10 October. Tests check unique session identities and that the daily duration equals the session total.
- Native preview confirms main sleep stays at 00:01 while the nap advances independently to 14:01. Both chart domains remain correct. Compact scrolling and stage feedback were visually inspected.
- Captures: native-sleep-nap.png and native-sleep-main-independent.png.
- Signed build passed in 15.92 seconds. All 60 Swift tests passed. Desktop lifecycle check passed. Six backend tests and TypeScript checking passed.
- Pointer dragging through the native automation still produces no value change. Accessibility increments and keyboard controls work, but pointer scrubbing remains unverified. Full completion audit remains outstanding. No production changes.

Pointer follow-up:
- Direct slider clicks work. Default chart selection did not respond to clicks, so added a reusable zero-distance Swift Charts gesture for sleep, sample and history charts.
- Native sleep click selected 05:15/REM. Drag selected 02:34/DEEP, with a matching marker and slider position. This closes the sleep-chart pointer gap. Native slider thumb dragging itself remains unverified.
- Native Movement history click selected 6 October, drag selected 9 October, and the Inspect action followed the selected date. Saved native-sleep-pointer.png and native-history-pointer.png.
- Latest signed build passed in 11.82 seconds. All 60 Swift tests and the isolated lifecycle check passed. Backend checks remain unchanged and passed in the preceding pass.
- Remaining audit: latest sample-chart gesture, final journey matrix and final deliverables. No production changes.

Final journey audit, 11 October:

| Requirement | Evidence |
| --- | --- |
| Today and every Health page | Native sidebar and collapsed Health menu exercised. Command-1/2 return to Today/Health. Selected day and period survive navigation. |
| Metric inspection | Native HRV sheet shows 42 ms, source, record update time and history. Escape dismisses. Missing oxygen remains Not recorded. |
| Sleep exploration | Native click and drag select REM/Deep stages. Filters show recorded duration totals. Main sleep and nap keep independent positions. Keyboard minute controls work. |
| Historical days and periods | Native recorded-day picker, 7/14/30-day controls and Inspect selected day exercised. Latest 30-day HRV view counts only 14 stored days and reports no previous-period data. Calendar-window tests pass. |
| Empty, offline, loading and failures | Native scenarios and retained loading state exercised; store tests distinguish these states and prevent stale loads overwriting newer state. |
| Retry and Sources | Latest Error -> Overview -> Retry restores 14 illustrative days. Open Sources and Finish preview load were exercised in earlier passes. |
| Mac layout and accessibility | Compact 760x560 and wide native windows inspected. Native keyboard actions, focus return, scrolling and sidebar collapse/expand checked. Opaque Reduce Transparency capture inspected; effective Reduce Motion/Transparency wiring and tests checked. |
| Pointer sample inspection | Latest native click selects 53 bpm at 03:00, drag selects 56 bpm at 04:30. Only nearest recorded samples are shown, with no interpolation. Capture native-samples-pointer.png. |
| Runtime safety | Preview lifecycle check confirms no engine. Source uses cached scenery, static decorative mark and refresh on demand, with no continuous decorative loop or new polling timer. Installed app and production data untouched. |

Checks: latest signed build 11.82 seconds; Swift Testing 60/60; desktop lifecycle passed; backend Node tests 6/6 and tsc --noEmit passed in the preceding pass, with no backend source changes since. Native captures, not offscreen exports, provide the visual evidence.

Scope limitations: Google OAuth/health ingestion is not connected. Native preview evidence is synthetic, not live provider verification. Task and Calendar inspection is read-only; real EventKit access was not requested or exercised. Native slider thumb dragging could not be demonstrated by automation, but timeline dragging, slider clicking and keyboard scrubbing are verified. Existing legacy Keychain deprecation warnings remain. No commits, pushes, deployment, credential or permission changes.

Launch: `open -n 'mac-sync/build/LifeOS Sync.app' --args --desktop-preview --preview-compact` from the lifeos-convex repository.

Files worked on during this goal, including existing uncommitted files:
- Health UI: `mac-sync/Sources/LifeOSSync/DesktopConvexHealthView.swift`, `ConvexHealthStore.swift`, `HealthMetric.swift`, `HealthInspectionControls.swift`.
- App shell and accessibility: `mac-sync/Sources/LifeOSSync/DesktopWindow.swift`, `MicroInteractions.swift`, `main.swift`.
- Read-only planning: `mac-sync/Sources/LifeOSSync/DesktopPlanningView.swift`, `DesktopCalendarView.swift`, `DesktopCalendarStore.swift`; `mac-sync/Sources/SyncCore/PlanningSnapshot.swift`, `LocalReplica.swift`, `SyncCore.swift`.
- Health models and fixtures: `mac-sync/Sources/SyncCore/HealthDay.swift`, `HealthHistory.swift`, `HealthPreview.swift`.
- Tests: `mac-sync/Tests/HealthUITests/HealthStoreTests.swift`, `CalendarStoreTests.swift`; `mac-sync/Tests/SyncCoreTests/HealthDayTests.swift`, `HealthHistoryTests.swift`, `PlanningSnapshotTests.swift`.
- Build and documentation: `mac-sync/Package.swift`, `mac-sync/Resources/Info.plist`, `mac-sync/build-app.sh`, `mac-sync/README.md`, this log, and native screenshots under `artifacts/health-ui/`.
Existing unrelated changes remain preserved. This list is not a claim that every dirty file was created by this goal.
