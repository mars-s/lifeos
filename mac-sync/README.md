# LifeOS native sync

Swift6.3 menu-bar agent for the existing Cloudflare mirror. This version queues task completion and title changes through dot, and applies them through supported Things automation on an awake Mac. New cloud_wins operations prefer explicit cloud intent for their specific supported fields and retain displaced values in immutable audit receipts. Historical operations retain their original policy. Newer unclaimed title edits supersede older queued titles. Unsupported writes are rejected.

## What is built

- Authenticated hibernating WebSocket with revision catch-up. No periodic queue polling or full-inventory timer. Failures use one-shot backoff retries.
- Debounced narrow metadata-only FSEvents invalidation and day-boundary refresh. No private database parsing.
- Bounded bulk public inventory child process with two complete matching passes. Exact live parity measured 1.782 seconds versus 14.948 seconds for the old reader in one stable run.

- Native menu-bar status, pause/resume, sync now, wake/network refresh, background launch of Things when needed and optional start at login.
- App-scoped Keychain credential with no recurring interactive retrieval and no Python or 1Password dependency for native sync. The optional unified local-tools bridge starts the retained Python service for individual tool calls.
- Application Support journal, single-instance lock, persisted upload retries, intents before writes and receipts before cloud acknowledgement.
- Read-before-write and read-back verification through fixed bundled public Things scripts. No private Things database access by the native agent.
- Existing mirror journal migration, preserving its sequence and making an online SQLite backup. Undelivered legacy uploads block migration; the old helper is restored rather than losing them.
- Worker/D1 operation journal and pending overlay. Existing read grants cannot write, including after refresh. A separate native key can consume only native sync routes; the old upload key cannot claim writes.

## Native LifeOS window

The existing AppKit menu bar now includes **Open LifeOS**. It presents a SwiftUI
window in this same app and process. Reopening reuses one window. Closing it does
not stop sync or quit the menu-bar app. The existing owner and journal remain
unchanged.

The window observes the owning agent's status, connection, pending queue count
and last-sync time. It does not create another engine or start another service.
The Oura-inspired Today view includes a local focus timer and session drafts.
On macOS 26, navigation and floating controls use native Liquid Glass. Content
panels use regular material rather than stacking glass on glass. Older systems
fall back to regular material; Reduce Transparency and increased contrast use
solid surfaces with stronger outlines. The scene extends behind the sidebar so
its material has a real background to sample.
The timer only wakes while running. Drafts are explicitly temporary and are not
yet connected to the durable LifeOS journal, Things or Calendar. Task and calendar
destinations are labelled as not connected, rather than showing invented records.

For an isolated preview, after building:

```sh
'build/LifeOS Sync.app/Contents/MacOS/LifeOSSync' --desktop-preview
```

Preview mode skips engine, watcher, network monitor and credential setup. Do not
mistake its status for a live sync result. Quit the preview before running the
normal app from that same bundle.

The isolated lifecycle check uses the real window controller without creating
an Agent or SyncEngine:

```sh
'build/LifeOS Sync.app/Contents/MacOS/LifeOSSync' --desktop-check
```

An optional `--snapshot /absolute/path.png` exports its initial view. The output
directory must already exist. The background artwork was generated for the
LifeOS design study and is bundled locally, with no font or image downloads.

## Build and synthetic verification

```sh
cd mac-sync
swift test
node --test Tests/native-write.test.mjs
python3 -m unittest discover -s Tests
sh build-app.sh
```

From `cloud-mirror/cloudflare`, run `npm run typecheck`, `npm run test:native`, `npm run test:mcp` and `npm test`. Tests use synthetic tasks and identity; they do not establish real Things writes or iPhone visibility.

The built app is `mac-sync/build/LifeOS Sync.app`. Set `LIFEOS_CODESIGN_IDENTITY` or save an installed identity fingerprint in ignored `mac-sync/.codesign-identity` for stable signing. The current local installation uses an existing Apple Development identity. With neither configured, signing is ad-hoc. Configured signing failure is fatal. Ad-hoc rebuilds may require renewed permission or Keychain approval. This has not been notarized for distribution.

## Secure owner activation

The existing installation is already provisioned. Do not rerun provisioning or create another OAuth app. The owner alone enters credentials and performs secure consent. The commands below document first-time setup; they are not an upgrade procedure.

Personally run in a secure Terminal from this repository:

```sh
python3 mac-sync/setup_native_sync.py
```

It asks for action-time approval and hidden GitHub credentials, installs the reviewed app, takes a private D1 export, applies the additive migration, stores a new native agent key in Keychain, configures only its hash in the existing Worker, and activates the typed write routes. It stops only `com.lifeos.workers.mirror`, imports and backs up its existing journal, restores the old helper if import fails, and opens the native app for normal Things permission. Enable Start at login in its menu. The original local LifeOS MCP/Calendar services are retained.

Reconnect the existing **LifeOS Cloud Mirror Reader** plugin with `things:read things:write offline_access` and approve its new consent. The old reader grant stays read-only. Refresh its tools through Manage app. Write tools advertise their OAuth scopes and return an authorization challenge rather than executing under an old read grant. Do not select the empty private-cache test plugin. Use `read_things_mirror` and `queue_things_edit`; the latter needs a stable operation ID, target ID, title/status field, desired value and the confirmed field revision. Completing a task uses status=`completed`. `queue_things_trash` accepts a to-do target and its confirmed `in_trash_list` revision, and queues a recoverable move to Things Trash. It cannot empty Trash or delete projects.

After an ad-hoc app update, Keychain may require trust for the new build. Routine access fails quietly and reports its status instead of opening a dialog or blocking the menu. Select **Authorize Keychain access once** yourself and approve the specific installed app through macOS. Use Always Allow if you want this build trusted for unattended retrieval. Denial retains the journal and stops syncing. Locally ad-hoc signed updates can need renewed trust; a stable signing identity preserves trust across updates. The current installation uses Apple Development signing and is not a notarized Developer ID distribution.

If the menu bar cannot be reached, run `/Applications/LifeOS Sync.app/Contents/MacOS/LifeOSSync --authorize-keychain` with the application path quoted. This explicit command opens the normal Keychain approval and then checks a quiet read. It prints no credential and exits unsuccessfully if unattended access is still unavailable. Restart the menu-bar app after this command completes.

The secure setup intentionally refuses to replace an already-installed app or reset an existing native journal. If setup stops after installation, inspect the named stage, preserve the app and both journals, and finish the interrupted stage. Do not rerun provisioning blindly or delete journals. A native journal loss must stop execution. A pending legacy upload should be drained by the original helper before trying journal migration again.

## Live verification

Create a disposable task. With the Mac asleep, ask dot to change its title or complete it. Dot must report pending. Wake the Mac and approve any normal automation permission. Verify the durable receipt is applied, confirmed cloud data reflects Things, and the iPhone receives it through ThingsCloud. Repeat a same-field conflict to confirm explicit cloud intent wins while unrelated local fields survive. Do not infer this path from build success or health responses.

The native agent does not access Documents/Desktop or another app's private files. Supported automation still needs permission. The older local Python LifeOS adapter remains installed and still uses its own reader, so this replacement does not establish that prompts from unrelated or retained Python processes disappear.

The source journal and cloud queue contain private data. Repository source backup excludes them. The existing local legacy backup and pre-upgrade app/journal checkpoint are recovery assets. The optional remote D1 export was denied by the current credential during this upgrade, and no remote backup was created. Recurring encrypted backup retention is not configured.
