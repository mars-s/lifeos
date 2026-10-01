# Native cloud sync implementation checkpoint

October 1, 2026. Branch: `feat/native-cloud-sync`.

The user authorized implementation and automatic conflict priority. The first release supports title changes and completing to-dos. A changed Things field wins automatically, retaining the skipped cloud edit. Newer unclaimed cloud title edits supersede earlier queued ones. Claimed or uncertain operations cannot be stolen or blindly repeated.

## Built and verified locally

- Swift6.3 menu-bar application, native Keychain credential, Application Support journal, wake/network polling, start-at-login control and single-instance lock.
- Supported Things reader and fixed typed writer. The native sync path uses no Python, 1Password CLI or private Things database.
- Worker/D1 queue, pending overlay, claim and immutable receipt endpoints, independent native agent credential, OAuth write scope and explicit write consent. Old reader grants remain read-only, including on refresh.
- Durable local intent before mutation, verified receipt before acknowledgement, exact snapshot retry, no replay after an interrupted write, and automatic handling of a superseded prepared edit.
- Online backup and sequence-preserving migration of the existing read-only mirror journal. Pending legacy uploads block migration rather than disappear.
- User-operated activation script with hidden GitHub credential entry, app installation, private D1 export, additive native schema migration, separate Keychain key/hash and restoration of the old mirror helper if journal import fails.

Validation:9 Swift recovery/migration/pause tests,4 synthetic JXA writer tests,2 secure-provisioning tests,6 native Worker/OAuth tests,7 existing MCP/OAuth tests,9 existing snapshot Worker tests and74 existing companion Python tests passed. TypeScript checking and root Ruff passed. Release app builds and its local code signature verifies. The app bundle is approximately432 KiB; runtime memory and idle energy have not been measured. Tests do not mutate real Things tasks.

## Current production and secure handoff

No production Worker deployment, new credential provisioning, live Things mutation or helper migration was performed during this implementation turn. The existing read connection and Python mirror are retained. The app is built under `mac-sync/build/LifeOS Sync.app`; it has not been installed or run as the background agent.

The owner must rotate the previously exposed secret in the existing GitHub app, then personally run `python3 mac-sync/setup_native_sync.py` from this repository. Its hidden prompts and normal native permissions must stay with the owner. Dot needs a new `things:write` consent and its tool list refreshed through supported connection settings. The setup does not create another OAuth app or access ThingsCloud credentials.

## October 1 activation verification

The installed native app uploaded a fresh 59-record snapshot at sequence 35, with no pending upload or sync failure. Things automation permission and start at login are enabled. The prior journal's pending sequence 34 was delivered and verified before migration; its backup was retained. The original Python mirror and local Python MCP remain stopped. Cloud writes are enabled, but dot write consent and a live queued-edit round trip still need verification.

The first installed reader rejected compiled AppleScript's raw Things dictionary class codes. The reader now accepts the verified `tstk`, `tslt` and `tspt` codes as well as their term names. Regression tests cover repeated list entries and reject conflicting or unknown classes. All 11 Swift tests passed, and the corrected installed reader completed its live inventory and upload.

## Queued deletion and authorization repair

The server now advertises read/write scopes for initial authorization, includes tool-level OAuth metadata and an insufficient-scope challenge, and explicitly reports whether the current connection can write. Old reader grants cannot execute writes. `queue_things_trash` queues a to-do move to recoverable Things Trash; projects and permanent deletion remain unavailable. Seven native/OAuth tests and five synthetic writer tests passed. The installed writer moved one explicitly created disposable task to Things Trash and verified membership; a retry reported satisfied without another mutation.

The complete cloud queue to native receipt round trip is still unverified. The updated ad-hoc build requires owner Keychain trust. A live process sample showed the previous build waiting inside `SecItemCopyMatching`. Background access now explicitly disables legacy Keychain interaction as well as biometric interaction, returns a clear status promptly, and exposes an owner-operated authorization menu action. Its private status file contains only a fixed diagnostic message and timestamp. The existing plugin's read/write OAuth consent was prepared in Helium but not approved by the agent. Owner consent and Keychain trust are the remaining activation steps.

Actual queued phone edit while the Mac is asleep, native execution after wake, Mac read-back receipt and Things iPhone visibility remain unverified until this secure activation. No perfect cross-device conflict-free or exactly-once guarantee is claimed. The original local Python MCP adapter remains installed, so prompts from that separate legacy reader may still need a later migration.

## Keychain approval and live queue verification

The owner approved the installed app through its new explicit `--authorize-keychain` command. Both the interactive read and an immediate silent read succeeded. The background app then reported Synced and uploaded fresh snapshots without a credential prompt.

For a disposable task only, the native agent was stopped, a recoverable Trash operation was inserted into the production operation queue using owner administration, and the agent was restarted. The immutable receipt reported applied. A subsequent confirmed snapshot verified Things Trash membership. An actual MCP read returned sequence 41, last sync `2026-10-01T11:23:19Z`, and 61 records (the original 59 plus two disposable test tasks retained in recoverable Trash).

This proves the production queue, native write, receipt and cloud snapshot path. It does not prove a dot-originated write or physical Mac sleep/wake and iPhone delivery. The connected MCP read still reports `connection_can_write=false`; explicit write consent on that connection remains unresolved. Tool refresh in Helium lists both queued edit and queued Trash tools. The outdated read-only plugin description has been updated.
