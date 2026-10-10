# LifeOS desktop design comparison

Two isolated, interactive studies based on the supplied LifeOS and Oura references.
Both use the same original mountain artwork and fictional day for 6 October 2026.

## Try them

React:

```sh
cd /Users/avi/Developer/projects/lifeos/prototypes/oura-study/react
npm install
npm run dev
```

Open `http://127.0.0.1:49371/`.

SwiftUI:

```sh
cd /Users/avi/Developer/projects/lifeos/prototypes/oura-study/swiftui
zsh build-app.sh
open 'LifeOS Design Study.app'
```

The SwiftUI bundle is a separate design-study app. It does not replace LifeOS Sync.
The React study is a browser app, not a packaged Tauri app.

## Design direction

- A quiet Today screen with one useful next action.
- A shared cyan mountain scene fading into charcoal.
- Small summary rings, a focus arc and restrained serif headings.
- Tasks, Calendar, Journal and Review remain one layer away.
- Collapsible navigation, focus countdowns, task details and session-only capture.

## Verification

Both studies built successfully. Live browser checks covered React focus start
and pause, task details, capture into Journal and sidebar collapse and expansion.
Native checks covered SwiftUI focus start and pause and its task-detail sheet.
SwiftUI also exports a deterministic initial-screen image in `screenshots/swiftui.png`.

These checks do not establish battery use, production accessibility compliance,
sync reliability or equivalent behaviour across every screen.

No Things, Calendar, memory or microphone service is connected. All changes are
temporary demo state. Nothing was committed, pushed or deployed as part of this study.

See `BRIEF.md` for the comparison rubric and artwork provenance, and
`JUDGEMENT.md` for the independent review. The requested Sol 6.1 model was not
available as a selectable judge, so the review uses the available inherited agent
model and must not be described as a Sol 6.1 verdict.
