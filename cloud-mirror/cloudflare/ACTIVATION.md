# Read-only activation verified — October 1, 2026

The owner ran the secure Terminal setup and reported its success. The script verified all supported uploaded fields against the staged inventory, duplicate acknowledgement, and then installed the read-only helper. The agent did not execute the credential provisioning script, inspect keys, or receive any credential in chat.

Independent checks confirm:

- Cloud inventory: **45 tasks, 4 projects, 4 areas, 6 tags = 59 confirmed records**.
- First snapshot: sequence1; observed `2026-10-01T01:02:54.044197+00:00`, received `2026-10-01T01:02:54.709Z` (11:02 am Melbourne); timezone `Australia/Melbourne`.
- Live `/health`: 200, `configured:true`. `/state` and `/api/sync/begin` still return401 with no valid key, including caller-forged owner identity headers and a bogus synthetic key.
- Worker bindings now include the two role-hash names. Values were not read. Current version after the owner-controlled update: `38b4d02b-b5a4-4a43-a62a-fefaea37c708`; deployment `26782331-f0c3-4af8-b021-24e863edf1d0`, 100% traffic.
- Native LaunchAgent `com.lifeos.workers.mirror` is registered. Its first invocation exited0. It waits between five-minute runs, with no always-running Python/LLM process.
- Owner-private configuration at `~/Library/Application Support/LifeOSWorkersMirror/config.json`: backend Cloudflare, read approved, **writes false**. Journal sequence1 is delivered, with zero failures. The agent read only status counters/flags; no task bodies or keys.

**The next automatic background upload succeeded:** journal sequence2 is delivered, zero failures, and the LaunchAgent has run twice with exit0 and returned to idle. The second run was the installed service's normal scheduled invocation; no agent-invoked credential read, forced live automation or manual user test was used. Native Cloudflare independently confirms sequence2, 59 current records, observed `2026-10-01T01:08:22.887362+00:00` and received `2026-10-01T01:08:32.131Z` (11:08 am Melbourne).

A locked 1Password session, macOS wake/resume and long-term Free quota/CPU behavior remain deployment observations to collect; fixture coverage already checks restart, backoff and wake semantics. Dot OAuth MCP is still unconnected, and actual Things writes remain disabled. The hosted mirror is not live ThingsCloud and cannot refresh while the Mac is asleep/offline.

This activation supersedes the empty-cache/uninstalled-helper checkpoint in DEPLOYMENT.md. Original LifeOS, Heimdall and the separate private Site were not changed. Normal successful helper passes produce no console notification.

The next read-only MCP connection is now staged and synthetic-tested: [DOT_CONNECTION.md](DOT_CONNECTION.md). Seven MCP/OAuth TAP tests and five secure handoff unit tests pass, including actual SDK calls over all 205 fixture records, wrong-owner denial, PKCE, scopes, consent/CSRF, refresh, revocation and code replay. Typecheck and minified packaging dry-run pass (746.75 KiB source / 183.56 KiB gzip). The active `wrangler.jsonc` still points to `worker.ts`; no OAuth KV namespace, GitHub app credential or dot grant was provisioned by the agent. Native Wrangler identity metadata confirms its current grant **lacks `workers_kv:write`**. The user-operated setup script requests only that additional permission, keeping the existing account/user/Worker/D1/offline scopes. Real browser OAuth, dot compatibility and production MCP CPU remain unverified.

OAuth MCP is now published and independently verified as of October1 at1:10 pm Melbourne; see OAUTH_PROGRESS.md for deployment IDs and evidence. The user-operated final discovery check initially reported failure despite successful deployment; this has been fixed. Both discovery documents return200; unauthenticated MCP returns401 with the correct Bearer challenge. Mac sequence22 and all59 records persisted after publication. All74 Python tests, typecheck and minified dry-run pass. Dot's custom connection and owner OAuth grant remain pending; no credential re-entry is needed.
