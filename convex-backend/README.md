# LifeOS self-hosted Convex

Local backend foundation, verified on 6 October 2026. This does not replace the
installed LifeOS Sync app, the Cloudflare mirror, or Things/Calendar storage.
The integrated Swift build reads health records through the authenticated local
gateway. Ordinary design previews still use fixtures. Things and Calendar
continue to use their existing storage and sync services.

## Run

Requires Node, Python 3, Docker and Compose. Docker Desktop is used on this Mac
because Arcbox's daemon is running with `--no-linux-vm`; its existing Chemwatch
VM has not been interrupted.

```sh
cd /Users/avi/Developer/projects/lifeos-convex/convex-backend
npm ci
npm run start:local
npm test
npm run typecheck
npm run verify:local
npm run backup
```

To use an already functional Arcbox Docker daemon instead, set
`LIFEOS_DOCKER_CONTEXT=arcbox` in `.env` and `.env.local`. Stop this Compose stack
in its original context first. Contexts have separate volumes; switching runtimes
does not move the database. Export and explicitly restore it before switching.

Endpoints:

- Backend and CLI: `http://127.0.0.1:3210`
- Owner HTTP gateway: `http://127.0.0.1:3211/health/day`
- Recent days: `http://127.0.0.1:3211/health/days?source=google-health&limit=30`
- Dashboard: `http://127.0.0.1:6791`

The backend and dashboard images are pinned by digest. The database lives in
the `lifeos-convex_data` Docker volume. `restart: unless-stopped` restarts the
containers when their Docker engine starts; it does not launch Docker at login.

## Credentials and access

First startup generates a new admin key and a separate native gateway token in
a gitignored, mode-0600 `.env.local`. No Pulse secrets are copied. The native token
is installed in Convex through stdin, not a shell argument. Never put the admin
key in the native app. The Swift integration stores only the native token in
macOS Keychain and refuses HTTP redirects.

## Swift app

Build and open the isolated integrated app:

```sh
cd /Users/avi/Developer/projects/lifeos-convex/mac-sync
swift test
sh build-app.sh
open -n "build/LifeOS Sync.app" --args --desktop-preview --health-live
```

This launch enables real local health reads but disables task sync, so it cannot
start a second Things/Cloudflare sync owner alongside the installed app.
In Health > Sources, choose **Connect local backend…** and select this backend's
hidden `.env.local` file. Only `LIFEOS_NATIVE_TOKEN` is imported. The admin key
is never copied into the app. Disconnect deletes this connection from Keychain.

The app loads the latest 30 stored days and refreshes every 30 seconds while the
health view is open. It preserves last-loaded records with an offline label
when the backend becomes unavailable. Missing measurements remain missing.
Sleep stages and body-signal plots use stored intervals/samples, not fabricated
values. Google Health is the default source. Synthetic records are opt-in and
visibly labelled. Google OAuth and ingestion are not implemented yet.

For diagnostics, the built executable accepts `--health-check` and reports only
the connection result and record count. `--health-store-token` imports a native
token from stdin, never from a command-line argument. Add `--health-synthetic`
for synthetic-source checks or a clearly labelled UI test.

Database functions are internal, not unauthenticated public queries/mutations.
HTTP reads and writes require `Authorization: Bearer <LIFEOS_NATIVE_TOKEN>`.
This is a single-owner local gateway, not multi-user authentication. No browser
CORS access is enabled. Do not expose these ports to a LAN or the internet.
The dashboard is admin tooling and requires the local admin key.

## Data contract

`healthDays` is indexed by source and civil date. POST sends a **complete** day,
including its IANA timezone. Replacement removes obsolete optional values.
Missing metrics remain missing, not zero. Do not use this endpoint for partial
patches.

Sources are `google-health` and `synthetic`; there are no real records imported.
Pulse's schema informed the fields, but its biometric demo readings, Convex
database, OAuth credentials and AI keys are not copied. Pulse's calculated
`sleepScore` is named `sleepEfficiency` here. It is not a Google/Oura sleep score.
Unverified parser mappings must be fixed before real ingestion.

POST body limit is 512 KB. Large intraday streams will require chunked storage
before import. This foundation has no raw payload archive, sync scheduler,
agent component or reviewed Calendar/Things execution yet.

## Verification

`python3 scripts/verify_native.py` tests recent-day endpoint authentication,
parameter validation, ordering and packaged Swift decoding using two disposable
synthetic days. It also stops only this backend to check native connection
failure, restarts it and removes the fixtures. Requires the built app and its
gateway token already in Keychain. Add `--visual` for interactive UI inspection
before cleanup. No real health records are read into test output.

`verify:local` temporarily writes a synthetic day, verifies replacement and ID
stability, restarts **only this backend**, verifies persistence, checks access
denials and invalid input, then deletes the fixture. It refuses to overwrite an
existing fixture at its test date.

## Backup and recovery

`npm run backup` creates a private, gitignored snapshot ZIP in `backups/`. These
exports may contain private health records once ingestion is enabled. Keep an
encrypted off-machine copy. Docker volumes are persistent storage, not backups.

To recover, stop application writes, inspect the archive and target deployment,
then explicitly run:

```sh
npx convex import --replace-all /absolute/path/to/approved-backup.zip
```

That command replaces deployment data. It is not run by startup or verification.
Snapshot export was tested; destructive restore has not been tested.

To stop without deleting data:

```sh
docker --context desktop-linux compose stop
```

Never use `down -v` unless intentionally deleting this database.

## App-managed backend later

Convex documents a standalone macOS binary at:
https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/running_binary_directly.md

An app-managed companion process is a possible later packaging direction, not
an embedded Swift library. It needs codesigning, lifecycle supervision, private
Application Support storage, secret handling and a tested update/backup path.
This change uses the documented Compose deployment instead:
https://github.com/get-convex/convex-backend/tree/main/self-hosted
