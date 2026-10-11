# Google Health OAuth setup

The existing Google Cloud project is `fitbit-dashboard-504911` (display name
`fitbit-dashboard`). Google Health API is enabled in that project.

The existing `fitbit dash` client is a web application. LifeOS's native macOS
app should use a separate desktop client named `LifeOS Mac`. Its creation form
was prepared on 11 October 2026, but creation is awaiting confirmation.

Keep downloaded credential files, client secrets and refresh tokens out of Git.
The repository ignores `.env*` files. Store tokens in macOS Keychain when the
native connection flow is implemented.

The health screens currently read stored local Convex records. Creating an OAuth
client alone does not implement sign-in, consent, health imports or background
refresh. Those remain the next integration steps.
