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
with owner-only read/write access. `GoogleOAuthConfiguration.load()` reads this
file directly without 1Password or Keychain. The app can check it with
`LifeOSSync --google-oauth-check`; this prints no credential values and sends
no network requests. The file must have owner-only permissions (`chmod 600`).

Keep downloaded credential files, client secrets and refresh tokens out of Git.
The repository ignores `.env*` files. Google credentials use the private local
file by preference, including when launched from Finder or at login. A shell
environment is not needed. Future Google refresh-token storage should follow
the same private-file preference. Existing local Convex and task-sync credentials
are separate and their storage has not changed.

The health screens currently read stored local Convex records. Creating an OAuth
client alone does not implement sign-in, consent, health imports or background
refresh. Those remain the next integration steps.
