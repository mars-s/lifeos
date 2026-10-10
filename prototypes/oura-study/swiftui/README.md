# LifeOS SwiftUI design study

A standalone macOS 14+ SwiftUI prototype. It does not link to the running sync app, read private data, or write to Things or Calendar.

```sh
cd /Users/avi/Developer/projects/lifeos/prototypes/oura-study/swiftui
swift run LifeOSStudy
```

For a standalone app bundle:

```sh
zsh build-app.sh
open 'LifeOS Design Study.app'
```

Export the initial 1200 × 800 view deterministically without screen capture:

```sh
swift run LifeOSStudy --snapshot ../screenshots/swiftui.png
```

The shared background is loaded from `../shared/mountain.png`. Override it with `LIFEOS_STUDY_MOUNTAIN=/absolute/path/to/image.png`.

Controls:

- Collapse or expand the sidebar.
- Start, pause and resume the 50-minute focus countdown.
- Open the sample task and mark it complete.
- Switch between Today, Tasks, Calendar, Journal and Review.
- Use New capture or Command-N to keep a text draft for the session.
- Change the sample date using the toolbar arrows.

All records are explicitly sample data. Capture drafts disappear when the app quits. The microphone icon opens text capture, it does not record audio. There are no network calls.
