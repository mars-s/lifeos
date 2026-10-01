# LifeOS MCP

This repository preserves both the original local LifeOS implementation and the deployed Cloudflare companion. The companion is in [cloud-mirror](cloud-mirror/README.md); its active OAuth connection is documented in [DOT_CONNECTION.md](cloud-mirror/cloudflare/DOT_CONNECTION.md). Historical Site and Railway experiments are retained there as reference, with Cloudflare Workers + D1 as the active deployment.

Queued cloud writes and the [native Swift Mac sync agent](mac-sync/README.md) are implemented on the native-cloud-sync branch, with synthetic recovery and authentication tests. Live write activation still needs the secure owner setup and a new scoped dot consent. The current production read connection and original helper remain active. See [the design](docs/cloud-write-sync-plan.md) and [the preservation record](docs/repository-preservation.md).

LifeOS is a local-first coordination layer for Things 3 and Apple Calendar. It lets an MCP client read planning context, prepare a visible proposal, bind approval to the exact reviewed revision, and then apply verified changes.

This is the first usable slice. It is intentionally not a replacement task manager or calendar.

## Safety model

The MCP server does not expose raw Things or Calendar write tools. The write flow is:

1. Read Things and an exact Calendar range.
2. Call `propose_changes` with the returned source snapshots.
3. Show the proposal and its `revision_hash` to the user.
4. Call `approve_proposal` with that exact hash.
5. Call `apply_approved_proposal` with the same hash.
6. LifeOS re-reads the sources, rejects stale proposals, applies changes, and records durable per-operation receipts.

Things titles, notes, Calendar titles, and Calendar notes are marked as untrusted content. Clients must never interpret that content as instructions.

## Current capabilities

- Read Things Inbox, Today, Upcoming, projects, and search results through `things-py`.
- Read Things areas and tags with review snapshots, and generate token-free Things deep links.
- Read selected Apple Calendar occurrences through a small native EventKit helper.
- Build deterministic, read-only day and multi-day plan previews from tasks and busy Calendar intervals.
- Render those previews as interactive MCP Apps cards inside ChatGPT, with drag and duration editing plus safe follow-up actions for preparing a proposal.
- Request Calendar authorization and idempotently create the dedicated `Planned Tasks` calendar.
- Create and update Things to-dos through the official Things URL scheme.
- Move to-dos into Things projects or areas, move projects into areas, and update deadlines and tags through the official URL scheme.
- Update Things projects and complete or cancel to-dos.
- Create linked Planned Work Blocks with a Things deep link in their notes.
- Update or delete only Calendar events carrying the LifeOS ownership marker.
- Persist immutable proposal revisions and application receipts in SQLite.
- Preserve exact brain dumps in local SQLite before interpretation, then store immutable semanticization revisions with source excerpts and unresolved questions.
- Retrieve or search captured thoughts after the originating ChatGPT conversation is gone.
- Explicitly index a stored brain dump into local Supermemory and recall derived memories or source chunks later. LifeOS keeps the raw capture and an index receipt in SQLite.
- Append only reflective journal prose to local Daily Journal Markdown; candidate tasks stay in the capture ledger until reviewed.
- Render a brain dump as an agent-composed canvas of task, Calendar, journal, and question previews, including isolated custom HTML scenes when a bespoke visualization helps.

Things reads currently use its private local SQLite database through `things-py`. Writes never modify that database directly. See [the integration comparison](docs/research/things-mcp-comparison.md) for the trade-off.

## Install and test

Requirements: macOS 13 or newer, Things 3, Python 3.14, Swift, and `uv`.

```sh
uv sync --extra test
swift build -c release --package-path eventkit-bridge
uv run pytest
uv run ruff check .
```

The tests use fake gateways. They do not modify your Things database or Calendar.

For the full local verification pipeline, run `sh scripts/verify.sh`. It runs lint and tests, then launches an isolated MCP server and proves a synthetic brain-dump capture through real HTTP tool calls and a disposable SQLite database. The proof is saved under `artifacts/verification/`. The same command runs in GitHub Actions on macOS. See the project-local [verify skill](.agents/skills/verify/SKILL.md) for the feature map and the limits of each check.

## Run

Build the helper first, then start the stdio MCP server:

```sh
swift build -c release --package-path eventkit-bridge
uv run lifeos-mcp
```

The entrypoint also supports a loopback-only Streamable HTTP server. See [the runtime guide](docs/runtime.md) for CLI flags, environment variables, health checks, and an optional launchd template.

Optional environment variables:

- `LIFEOS_DB_PATH`: SQLite state path. Defaults to `~/Library/Application Support/LifeOS/lifeos.sqlite3`.
- `LIFEOS_JOURNAL_DIR`: Daily Journal Markdown directory. Defaults to `~/Library/Application Support/LifeOS/Journal`.
- `LIFEOS_CALENDAR_HELPER`: absolute path to the EventKit helper. Defaults to the release binary in `eventkit-bridge/.build/release/`.

Add the command `uv --directory /Users/avi/Documents/ChatGPT/lifeos run lifeos-mcp` to an MCP client as a local stdio server. On first Calendar use, macOS may require Calendar permission for the terminal or agent host running LifeOS.

For local Codex, the registered configuration is:

```toml
[mcp_servers.lifeos]
command = "/opt/homebrew/bin/uv"
args = ["--directory", "/Users/avi/Documents/ChatGPT/lifeos", "run", "lifeos-mcp"]
```

Approval and application tools are configured to prompt in Codex. A fresh task or app restart is required after adding or changing an MCP server because an already-running task cannot hot-load new tools.

In ChatGPT, ask LifeOS to plan a day and show the result visually. The model should call `plan_day`, then pass that exact result to `render_day_plan`. For requests spanning multiple dates, it should use `plan_week` followed by `render_week_plan`. The cards never write to Things or Calendar. Their primary action asks ChatGPT to prepare a normal reviewed proposal.

The optional HTTP transport binds to loopback. It may be exposed to ChatGPT only when the remote GitHub OAuth settings are complete. The OAuth gate accepts the configured GitHub login and rejects every other account. See [the runtime guide](docs/runtime.md).

## Mac login stack

On this Mac, the `lifeos-stack` command controls the installed LifeOS MCP, ngrok, and local memory launch agents:

```sh
lifeos-stack start
lifeos-stack status
lifeos-stack stop
```

After changing MCP Python code or widget HTML, run `lifeos-stack reload` to restart only the LifeOS MCP process. It waits for the new process to answer `/health` while leaving the ngrok address and memory service alone. Reload is explicit so an in-flight approved write is not interrupted by a file watcher. Refresh the ChatGPT connector or start a new chat if its cached tool list does not update.

The agents also start when the user logs in. `start` installs the current memory scripts into `~/Library/Application Support/LifeOS/bin`; use `restart` after changing them. The memory agent runs Supermemory and a loopback-only OpenCode session adapter together. The OpenCode key stays in macOS Keychain, not in the plist or repository. Because this Supermemory binary listens on all interfaces, startup requires the macOS firewall to be enabled and to block incoming connections to that binary. The memory agent stops if either child exits or that firewall check fails.

The MCP exposes `index_brain_dump_memory`, `get_brain_dump_memory_status`, `recall_memory`, and `review_brain_dump_memory`. Indexing is explicit: capture the exact words first, then pass the returned `capture_id` and `source_hash` to the index tool. The raw capture remains in LifeOS SQLite. Supermemory computes embeddings locally and sends the text to the configured remote MiMo model for memory extraction. A queued index is not yet searchable; check its status. Retrieved memories are suggestions, not facts. The review tool shows extracted claims beside their exact source. For live tests, capture with `source="synthetic_test"`; those memories use the isolated `lifeos-test` container, while ordinary recall and capture lists/searches exclude them. Diagnostic calls can opt into `scope="test"` for recall or `include_tests=true` for capture listings.

## Project status

This repository contains the tested MCP foundation, not the future macOS generative UI. A live write against personal Things and Calendar data is deliberately still unverified until a real proposal is reviewed and approved.
