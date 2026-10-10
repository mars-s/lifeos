# Bana notes rollout checklist

The code for notes in LifeOS is on the `bana-integration` branch. Nothing has been deployed. These are the steps only you can run, in order. Each one says how to check it worked.

## 1. Merge and update LifeOS

```sh
cd ~/Developer/projects/lifeos
git switch main && git merge bana-integration
uv sync --extra test
sh scripts/verify.sh
```

Check: verify ends without an error. To include the live Bana tests, build Bana's CLI and pass it: `BANA_BIN=/path/to/bana sh scripts/verify.sh`.

## 2. Open Bana

Open the Bana desktop app on this Mac with your graph. LifeOS installs Bana's "Agent notebook" template the first time it writes, if its supertags are missing. You can also install it yourself first: account menu, Browse templates, Agent notebook.

Check: `uv run lifeos export-journal` prints a path, and that file holds today's page.

## 3. Rebuild LifeOS Sync

The Mac bridge only forwards tools on its built-in list, and the note tools are new on that list.

```sh
sh mac-sync/build-app.sh
```

Install the built `mac-sync/build/LifeOS Sync.app` the way you installed the last build (see `mac-sync/README.md`; do not rerun provisioning). Keep **Enable local LifeOS tools** ticked in its menu.

Check: the menu still shows local tools enabled after a restart.

## 4. Deploy the Worker

```sh
cd cloud-mirror/cloudflare
npm run typecheck && npm test && npm run test:mcp && npm run test:native
npx wrangler deploy --dry-run
npx wrangler deploy
```

This adds the `notes` and `notes:write` scopes. It makes no new Cloudflare resources and stores no note text. It also tells the Mac whether each call's grant has `notes:write`. Until this Worker is deployed, the updated LifeOS writes nothing to Bana from ChatGPT or claude.ai.

Check: `npx wrangler deployments list` shows the new version at 100%.

## 5. Reconnect ChatGPT

Old grants do not gain the new scopes. In ChatGPT, open the LifeOS connector settings, disconnect, and connect again. On the LifeOS consent page tick:

- Include local LifeOS tools
- Include your Bana notes (notes)
- Let it add and edit notes (notes:write), if you want agents to add notes

Without notes:write nothing reaches Bana from that connection, captures included: they stay in the LifeOS ledger and report `bana: not permitted`.

Then refresh the connector's tools.

Check: ask "what LifeOS capabilities do I have?" and look for `notes_available: true`.

## 6. Connect claude.ai

In claude.ai, Settings, Connectors, add a custom connector with the URL `https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/mcp`. Sign in with GitHub and tick the same boxes as step 5.

This path has not been tested yet. If sign-in fails, note the `stage` and `reason` the error page shows.

## 7. Try it with a throwaway note

In each of ChatGPT and claude.ai, with your Mac awake and Bana open:

1. "Search my notes for garden." The answer should cite node ids.
2. "Add a note to today: connector test from ChatGPT" (or claude). It should appear in the open Bana window at once, marked with the assistant's name.
3. Delete the test notes yourself in Bana.

## 8. Approvals

The model can no longer approve its own proposals. Approve on the review card. Claude Code and Codex (stdio) no longer have approve or reject tools at all. If a host shows no card, approve in Terminal:

```sh
uv run lifeos approve <proposal_id> <revision_hash>
```

Check: in ChatGPT, render a proposal and press Approve on the card; it should say "Revision approved". Asking the model to approve should fail with a message pointing to the card or `lifeos approve`.

## 9. Optional: scheduled journal export

Copy `launchd/com.lifeos.journal-export.plist.example` to `~/Library/LaunchAgents/com.lifeos.journal-export.plist`, replace `REPLACE_ME`, then:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lifeos.journal-export.plist
```

It writes today's Bana day page to the journal folder at noon and 23:50. It never overwrites a Markdown file it did not write.
