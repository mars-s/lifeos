# LifeOS React design study

An isolated, interactive Today-screen prototype. This is not the production app.
It uses the shared mountain artwork and sample data for 6 October 2026.

## Run

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:49371`.

For the production-style build:

```sh
npm run build
npm run preview
```

## What works

- Sidebar navigation and collapsing.
- A real start, pause and resume focus countdown.
- Complete or reopen the sample task.
- Task, meeting, journal and priority detail dialogs.
- Search sample records.
- Capture a text thought into the session-only Journal view.
- Date navigation, with the sample itinerary explicitly illustrative.
- Keyboard-accessible dialogs with Escape, focus containment and focus restoration.
- Reduced motion, reduced transparency and increased contrast preferences.

No Things, Calendar, microphone, memory or sync service is connected. Captures and
completion changes are held in React state and disappear on reload. The sidebar
states this explicitly.

The body font falls back to macOS system type and the display font to Georgia if
the optional Google Fonts stylesheet is unavailable. The main artwork is local.
