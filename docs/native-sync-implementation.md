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

Actual queued phone edit while the Mac is asleep, native execution after wake, Mac read-back receipt and Things iPhone visibility remain unverified until this secure activation. No perfect cross-device conflict-free or exactly-once guarantee is claimed. The original local Python MCP adapter remains installed, so prompts from that separate legacy reader may still need a later migration.
