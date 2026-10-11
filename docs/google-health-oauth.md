# Google Health OAuth setup

The existing Google Cloud project is `fitbit-dashboard-504911` (display name
`fitbit-dashboard`). Google Health API is enabled in that project.

The existing `fitbit dash` client is a web application. LifeOS's native macOS
app has a separate desktop client named `LifeOS Mac`, created and verified
on 11 October 2026. OAuth access is currently restricted to the project's
configured test users.

Client ID: `204730760465-5q5in476f1reccljukl9o03ibgcv8ttp.apps.googleusercontent.com`.

The downloaded credential JSON is stored outside the checkout at
`~/Library/Application Support/LifeOS/credentials/google-health-desktop.json`,
with owner-only read/write access. It has not yet been imported into the app.

Keep downloaded credential files, client secrets and refresh tokens out of Git.
The repository ignores `.env*` files. Store tokens in macOS Keychain when the
native connection flow is implemented.

The health screens currently read stored local Convex records. Creating an OAuth
client alone does not implement sign-in, consent, health imports or background
refresh. Those remain the next integration steps.
