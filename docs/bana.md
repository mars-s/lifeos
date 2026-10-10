# Notes in Bana

Bana holds the words. LifeOS keeps the hands. Bana (the outliner app) is where notes, captures, meetings and the daily journal live. LifeOS keeps doing Things 3, Apple Calendar, proposals and receipts, and is the one door agents use to reach Bana.

## How LifeOS reaches Bana

`src/lifeos/bana_gateway.py` finds the running Bana app through two files in `BANA_HOME` (default `~/Bana`): `graph.bana.live` (its port) and `token`. It calls `POST http://127.0.0.1:<port>/mcp` with the token as a bearer token and names the author in `X-Bana-Agent` (chatgpt, claude, codex, or lifeos for LifeOS's own writes). Bana records that name on the node (`by`). The token never appears in a result or an error.

Bana checks every assistant command itself too (see Bana's `docs/mcp.md`). Its refusals start with `refused:` and reach LifeOS as `BanaRefused`. A locked node answers `not available: ... is locked`. LifeOS never unlocks anything: `node.toggleLock` is on both Never lists.

The gateway runs only allowlisted Bana commands: search, inspect, tags, Markdown export, day lookup, add, note text, move, tag and field. Everything in the Never tier is outside the allowlist and is refused before any request: `node.hardDelete`, `node.delete`, `trash.empty`, `node.toggleLock`, `import.*`, `file.*`, `settings.*`, `workspace.*` and `commandNode.*`.

If Bana is closed, note tools say it is not reachable and nothing is queued.

## Tools and tiers

| Tier | Tools | Rule |
| --- | --- | --- |
| 0 Read | `notes_search`, `notes_read`, `notes_today` | Return node ids so answers can cite them. Text is untrusted data. |
| 1 Append | `notes_add` | One new node on a day page or under a node, with Bana's `by` and a `Request ID` field. Same `request_id` twice makes one node. |
| 2 Edit | `notes_tag`, `notes_set_field`, `notes_move`, `notes_link_task` | One node the person named, with the hash from `notes_read`. A changed node is refused. |
| 2 Inferred | `propose_changes` with `bana_changes` | Inferred or multi-node edits wait for the person on the review card. |
| 3 External | `promote_notes_to_things` and the rest | Things and Calendar rules are unchanged. |

Direct writes run as auto-approved LifeOS proposals, so they share request_id retries, receipts and the stale check. A write whose outcome is uncertain is never replayed.

The supertags come from Bana's "Agent notebook" template: `#capture`, `#interpretation`, `#suggested-action`, `#question`, `#meeting`, `#thing`, `#event`, `#proposal`, `#in-things`, `#ask-agent`. Before its first write LifeOS installs the template once if any of them is missing (installing it again would add a second page, so it checks first). `template.install` is allowlisted for that template name only. Agents can tag with these or with a supertag that already exists, never a new one. Fields LifeOS writes: Capture ID, Source hash, Revision hash, Evidence, Request ID, Date (meetings), Things ID, Things link, Synced at.

## Capture and interpret

1. `capture_brain_dump` saves the exact words in the LifeOS ledger first, then adds a `#capture` node to that day's page with the raw text as its note and the same `Source hash`. Bana closed: the capture still succeeds with `bana.status: "unavailable"`.
2. `submit_brain_dump_semanticization` adds a new `#interpretation` node under the capture (`#meeting` too when `meeting_title` is given). Tasks become `#suggested-action` children and questions `#question` children, each with an `Evidence` field holding the verbatim excerpt. Earlier interpretations are never rewritten.
3. Journal prose goes on the Bana day page. See [ADR 0002](adr/0002-bana-day-page-is-the-journal.md).

## Promote to Things

`promote_notes_to_things` drafts a proposal: one Things to-do per note, then a link back. Nothing changes until the person approves the card (or runs `lifeos approve`). On apply the note gets Things ID, Things link and Synced at, and the `#in-things` tag. If the note was edited after the proposal was drafted, apply returns `stale` and creates nothing.

## Approving without a card

`approve_proposal` and `reject_proposal` are app-only: the review card can call them, the model cannot see them. Where a host does not render the card, approve in a terminal:

```sh
uv run lifeos approve <proposal_id> <revision_hash>
```

It shows the changes and asks you to type the first 8 characters of the hash. It refuses to run without an interactive terminal, so an agent's shell cannot use it. Hosts that ignore MCP Apps visibility (some stdio clients) may still show approve and reject to the model; treat a chat "yes, approve" as nothing.

## Tests

```sh
# In the Bana repo, with your own target folder:
CARGO_TARGET_DIR=/tmp/bana-target cargo build -p bana-cli
# In LifeOS:
BANA_BIN=/tmp/bana-target/debug/bana sh scripts/verify.sh
```

`tests/test_bana.py` starts `bana serve --sample` on a free port with its own `BANA_HOME` and graph file for each test, so your real `~/Bana` is never touched. Without `BANA_BIN` the tests that need a running Bana are skipped. The verify script also pins `BANA_HOME` to an empty folder.

## Not built yet

- The raw capture copy is not locked: LifeOS cannot lock nodes (`node.toggleLock` is Never). `source_hash_matches` flags a copy someone edited; the ledger wins.
- The agenda mirror (Things and Calendar on the day page, plan phase 6) waits for Bana's mirror-upsert path.
- `#proposal` summary nodes, the agent inbox (`#ask-agent`) and the morning proposal-only run (plan phase 7).
