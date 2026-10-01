# LifeOS native sync

Swift6.3 menu-bar agent for the existing Cloudflare mirror. This version queues task completion and title changes through dot, and applies them through supported Things automation on an awake Mac. Same-field conflicts automatically prefer Things and retain a skipped receipt. Newer unclaimed title edits supersede older queued titles. Unsupported writes are rejected.

## What is built

- Native menu-bar status, pause/resume, sync now, wake/network refresh and optional start at login.
- App-scoped Keychain credential with no recurring interactive retrieval, no Python runtime and no 1Password runtime dependency.
- Application Support journal, single-instance lock, persisted upload retries, intents before writes and receipts before cloud acknowledgement.
- Read-before-write and read-back verification through fixed bundled public Things scripts. No private Things database access by the native agent.
- Existing mirror journal migration, preserving its sequence and making an online SQLite backup. Undelivered legacy uploads block migration; the old helper is restored rather than losing them.
- Worker/D1 operation journal and pending overlay. Existing read grants cannot write, including after refresh. A separate native key can consume only native sync routes; the old upload key cannot claim writes.

## Build and synthetic verification

```sh
cd mac-sync
swift test
node --test Tests/native-write.test.mjs
python3 -m unittest discover -s Tests
sh build-app.sh
```

From `cloud-mirror/cloudflare`, run `npm run typecheck`, `npm run test:native`, `npm run test:mcp` and `npm test`. Tests use synthetic tasks and identity; they do not establish real Things writes or iPhone visibility.

The built app is `mac-sync/build/LifeOS Sync.app`. Default signing is local ad-hoc signing. Set `LIFEOS_CODESIGN_IDENTITY` to your installed Developer ID identity for a stable signed distribution. Ad-hoc rebuilds may require renewed permission or Keychain approval. This has not been notarized for distribution.

## Secure owner activation

The agent must not run the credential workflow. First rotate the exposed secret of the existing **LifeOS cloud mirror reader** GitHub app, ID3895657. Keep its credentials out of chat. No new OAuth app or ThingsCloud credential is needed.

Personally run in a secure Terminal from this repository:

```sh
python3 mac-sync/setup_native_sync.py
```

It asks for action-time approval and hidden GitHub credentials, installs the reviewed app, takes a private D1 export, applies the additive migration, stores a new native agent key in Keychain, configures only its hash in the existing Worker, and activates the typed write routes. It stops only `com.lifeos.workers.mirror`, imports and backs up its existing journal, restores the old helper if import fails, and opens the native app for normal Things permission. Enable Start at login in its menu. The original local LifeOS MCP/Calendar services are retained.

Reconnect the existing **LifeOS Cloud Mirror Reader** plugin with `things:read things:write offline_access` and approve its new consent. The old reader grant stays read-only. The existing plugin may need its MCP tool list refreshed through its supported settings. Do not select the empty private-cache test plugin. Use `read_things_mirror` and `queue_things_edit`; the latter needs a stable operation ID, target ID, title/status field, desired value and the confirmed field revision. Completing a task uses status=`completed`.

The secure setup intentionally refuses to replace an already-installed app or reset an existing native journal. If setup stops after installation, inspect the named stage, preserve the app and both journals, and finish the interrupted stage. Do not rerun provisioning blindly or delete journals. A native journal loss must stop execution. A pending legacy upload should be drained by the original helper before trying journal migration again.

## Live verification still required

Create a disposable task. With the Mac asleep, ask dot to change its title or complete it. Dot must report pending. Wake the Mac and approve any normal automation permission. Verify the durable receipt is applied, confirmed cloud data reflects Things, and the iPhone receives it through ThingsCloud. Repeat a same-field conflict to confirm the Things value survives and the cloud edit becomes skipped. Do not infer this path from build success or health responses.

The native agent does not access Documents/Desktop or another app's private files. Supported automation still needs permission. The older local Python LifeOS adapter remains installed and still uses its own reader, so this replacement does not establish that prompts from unrelated or retained Python processes disappear.

The source journal and cloud queue contain private data. Repository source backup excludes them. The activation export and legacy backup are recovery checkpoints; recurring encrypted backup retention is not configured yet.
