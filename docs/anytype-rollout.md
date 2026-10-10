# Anytype notes rollout checklist

The code is on the `anytype` branch. Nothing has been deployed or connected. These are the steps only you can run, in order. Each says how to check it worked. What it all does is in [anytype.md](anytype.md).

## 1. Merge and update LifeOS

```sh
cd ~/Developer/projects/lifeos
git switch main && git merge anytype
uv sync --extra test
sh scripts/verify.sh
```

Check: verify ends without an error.

## 2. Create an Anytype API key

Open Anytype on this Mac. Settings, API Keys, Create new. Name it "LifeOS" and copy the key. Keep Anytype open.

## 3. Connect LifeOS to Anytype

```sh
uv run lifeos anytype connect
```

Paste the key when asked (you will not see it as you type), then type the number of the space LifeOS should use. If you would rather not copy a key: `uv run lifeos anytype connect --pair`, then type the 4-digit code Anytype shows.

Check: it prints the space name, a chat id, `"key_saved_in": "macOS Keychain (lifeos-anytype)"`, and what it created. In Anytype you now see the types Capture, Interpretation, Suggested action, Meeting, Proposal and Journal day, the Ask agent tag, and a chat named LifeOS. Run it again: `created` is empty.

## 4. Start the chat agent

It needs the Codex CLI, signed in (`codex login`).

```sh
cp launchd/com.lifeos.chat-agent.plist.example ~/Library/LaunchAgents/com.lifeos.chat-agent.plist
# replace every REPLACE_ME with your user name
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lifeos.chat-agent.plist
```

It starts at login and restarts if it stops.

Check: in the LifeOS chat in Anytype, write "what is in my notes about garden?". An eyes reaction appears, then a reply starting with "LifeOS:". `~/Library/Logs/lifeos-chat-agent.log` shows ids only. To stop answering: `uv run lifeos chat-agent pause` (and `resume`).

## 5. Rebuild LifeOS Sync

The Mac bridge only forwards tools on its built-in list, and `notes_list_types` is new on it.

```sh
sh mac-sync/build-app.sh
```

Install the built `mac-sync/build/LifeOS Sync.app` the way you installed the last build (see `mac-sync/README.md`; do not rerun provisioning). Keep **Enable local LifeOS tools** ticked.

Check: the menu still shows local tools enabled after a restart.

## 6. Deploy the Worker

```sh
cd cloud-mirror/cloudflare
npm run typecheck && npm test && npm run test:mcp && npm run test:native
npx wrangler deploy --dry-run
npx wrangler deploy
```

This adds the `notes` and `notes:write` scopes (now worded for Anytype). It makes no new Cloudflare resources and stores no note text. Until it is deployed, nothing reaches Anytype from ChatGPT or claude.ai.

Check: `npx wrangler deployments list` shows the new version at 100%.

## 7. Reconnect ChatGPT with the notes scopes

Old grants do not gain new scopes. In ChatGPT, open the LifeOS connector settings, disconnect, and connect again. On the LifeOS consent page tick:

- Include local LifeOS tools
- Include your Anytype notes (notes)
- Let it add and edit Anytype notes (notes:write), if you want it to add notes

Then refresh the connector's tools.

Check: ask "what LifeOS capabilities do I have?" and look for `notes_available: true`.

## 8. Add claude.ai

In claude.ai, Settings, Connectors, add a custom connector with the URL `https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/mcp`. Sign in with GitHub and tick the same boxes as step 7.

This path has not been tested yet. If sign-in fails, note the `stage` and `reason` the error page shows.

## 9. Try it with throwaway notes

With the Mac awake and Anytype open, in each of ChatGPT, claude.ai and the LifeOS chat:

1. "Search my notes for garden." The answer cites object ids.
2. "Add a note: connector test." It appears in Anytype at once, with Made by set to the assistant.
3. Archive the test notes yourself in Anytype. LifeOS never deletes.

## 10. Approvals

Only you approve: on the review card, or in Terminal:

```sh
uv run lifeos approve <proposal_id> <revision_hash>
```

Check: ask the chat agent to "turn that note into a Things to-do". It drafts a proposal and tells you to approve it; nothing reaches Things until you do.

## 11. Optional: scheduled journal export

Copy `launchd/com.lifeos.journal-export.plist.example` to `~/Library/LaunchAgents/`, replace `REPLACE_ME`, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lifeos.journal-export.plist`. It writes today's Journal day to the journal folder at noon and 23:50, and never overwrites a Markdown file it did not write.
