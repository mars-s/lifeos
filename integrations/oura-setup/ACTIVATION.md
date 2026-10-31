# Oura connection

Infrastructure activation is complete; user consent remains pending.

1. Open https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/connect .
2. Use the private owner-key file chooser. On this Mac, press Command-Shift-G in the chooser and enter `/Users/avi/Library/Application Support/LifeOS/credentials/oura/owner-access-key.txt`. Do not share the contents.
3. Review the data-flow notice, continue, and approve the requested scopes at Oura yourself.
4. Add remote MCP URL `https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/mcp` to your client with OAuth. Verify the exact client redirect shown on the consent screen, select the same owner-key file, and authorize that client yourself.

Redirect registered with Oura must be exactly `https://lifeos-app-setup.lifeos-read-mirror-worker.workers.dev/oura/callback`.

The owner key can authorize health-read clients. The Worker retains its hash only. The private file is not a shareable artifact. OAuth token encryption uses a separate Worker secret. Existing Oura client secret was preserved. No password manager was used.

Seven explicit Oura health-read scopes: personal, daily, heartrate, workout, tag, session, spo2. Email and write access excluded. Client tokens last one hour; refresh access up to 30 days. Oura terms remain applicable; this is not official or endorsed Oura MCP.
