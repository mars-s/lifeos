# Hosting assessment · verified September 30, 2026

## First choice to evaluate: private ChatGPT Site

**Documented feasible sync access, not live verified.** Installed Sites documentation describes a hosted Cloudflare-compatible Worker, durable D1 structured storage and optional R2 blobs. A small Worker + D1 journal/cache and Site `/mcp` read/propose interface fit this scope. R2 is unnecessary for normal snapshots/journal; optionally add it for approved backup exports after retention/access are confirmed. Sites provisions its private plugin for ChatGPT/Codex; use that existing managed connection rather than adding a new local MCP tunnel.

The decisive authentication evidence is `sites-building/references/authentication.md`:

> Private Sites can also support non-user API access.

The documented service credential is `siwc_bypass_bearer_token`, supplied when exposed by `get_site`. Send **only to the selected Site** in `OAI-Sites-Authorization: Bearer <token>`. Dispatcher verifies and consumes it. It supplies **no signed-in user identity and no connected-app consent**. A private Site's shared update endpoint can rely on its confirmed owner-private platform boundary, but additional route authorization is required when narrower permissions matter.

The available native `sites_generate_siwc_bypass_token` tool explicitly says to call it only when the user requests a bypass token; creating/rotating invalidates the old token immediately. It was inspected, **not invoked**. No Site was created, no token requested/read, no token endpoint invented, no browser cookie exported, no private gate weakened.

Design for the approved validation slice:

1. Keep Site owner-private; fail closed for any unexpected audience or missing owner configuration. Platform-authenticated `oai-authenticated-user-id` must match the configured Site-scoped owner for data-bearing human/MCP requests. Browser-only client headers are never trusted; production identity comes only through Sites dispatch.
2. Mac service access reaches only `/adapter/*`. Use an additional adapter-scoped application credential if the platform service credential cannot be scoped by route. The platform token bypasses the sign-in gate; it is **not inherently a route-scoped token**. Store both in approved Mac Keychain/environment injection, never source or browser code. Identity-less service requests must fail on approval, proposal review and owner/MCP data routes. Do not treat missing identity alone as proof of service authorization.
3. Human approval requires authenticated owner identity plus exact displayed revision; dot/MCP proposer tools cannot silently approve. Test owner mismatch, missing identity, adapter attempt to approve, anonymous public request, revoked token and redirect refusal. Fail closed if the platform cannot distinguish the selected access model safely.
4. Service credential does not authorize Google Calendar access. Verify connector eligibility and per-user consent separately. Never pass Mac service credential as a Calendar credential.
5. Verify an actual private Mac upload/pull and token revocation with synthetic data after approval, then only a read-only supported Things snapshot after separate live-test authorization.

Sources: installed [authentication reference](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites-building/references/authentication.md), [storage reference](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites-building/references/persistence-and-storage.md), [Sites MCP skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites-mcp/SKILL.md), native service-token tool description.

**Unknown:** Sites-specific price, account entitlement, quotas, availability/SLA, D1 backup/export access and retention, long-term lifecycle/support commitment. Do not promise free, permanent or always available. Public Cloudflare limits/prices are not Sites account terms. The existing Python WSGI/SQLite prototype does not deploy unchanged to Workers; it is a behavior reference for a bounded Worker/D1 port, with atomic batches and migrations. Sites is preferred for its integrated private interaction surface **if those terms and private machine access pass verification**.

## Fallback comparison: Railway versus Fly.io

| | Railway | Fly.io |
|---|---|---|
| Entry paid path | Hobby $5 monthly minimum, includes $5 resource usage; overage adds usage | Usage based; paid continued hosting requires payment setup |
| Free/trial | Trial $5/30 days; afterwards $1 monthly free usage, 0.5 GB RAM cap and 0.5 GB volume | 2 total machine hours or 7 days, whichever first; trial machines stop after 5 min |
| Lean durable configuration | One always-running service + one 1 GB volume; no replica/database service | One shared-cpu-1x 256 MB Machine + 1 GB volume; accept single-host downtime risk |
| Published compute | RAM $0.00000386/GB-sec; CPU $0.00000772/vCPU-sec, metered actual usage | Current pricing page default-region shared-cpu-1x 256 MB $0.0027/hour, displayed $1.94/month; region dependent |
| Storage | $0.00000006/GB-sec, about $0.158 for 1 GB/730h; backups incremental at volume rate | $0.15/GB-month provisioned; snapshot $0.08/GB-month actual stored, first 10 GB free |
| Egress | $0.05/GB | $0.02/GB NA/Europe, $0.04 APAC/Oceania/South America, $0.12 Africa/India |
| Durability and backups | Durable mounted volume, scheduled daily/weekly/monthly snapshots; same project/environment restore; wiping volume deletes backups | Volume tied to one host/Machine, no automatic replication. Daily snapshots default 5 days; provider warns not to use snapshots as primary backup |

Sources: [Railway pricing](https://railway.com/pricing), [Railway volume backup documentation](https://docs.railway.com/volumes/backups), [Fly pricing](https://fly.io/pricing/), [Fly resource pricing](https://docs.fly.io/about/pricing/), [Fly trial](https://docs.fly.io/about/free-trial/), [Fly volume considerations](https://docs.fly.io/volumes/overview/). Rates in USD before taxes; recheck selected region and account terms before purchase.

Railway example, **estimate not measured**: 64 MB average RAM + 0.01 average vCPU + 1 GB volume + 1 GB egress over 730 hours is approximately $0.65 + $0.20 + $0.158 + $0.05 = $1.06 resource usage before backup storage. Hobby still bills its $5 minimum. 128 MB doubles the RAM portion. This illustrates why $1 free credit is not a 24/7 promise, even for a lean service. Actual idle RSS, CPU and volume usage must be measured.

Fly example: 730h × $0.0027 = $1.971 compute, 1 GB volume $0.15, 1 GB NA/Europe egress $0.02 gives about **$2.14/month**, before separate backup/export costs and taxes. At this size built-in snapshots may remain inside 10 GB free allowance; monitor actual retained bytes. The pricing table's displayed month is $1.94; the 730-hour estimate intentionally uses the published hourly rate. No dedicated IPv4 ($2/month extra) or static egress IP is needed. More RAM and a different region can increase price. For a three-month low-traffic trip that is roughly $6.42 versus Railway's $15 minimum, excluding backups/overage; this is a planning estimate.

**Fallback recommendation:** Railway Hobby at an approved $5 monthly baseline is the simpler operational choice, with mounted SQLite and configured external exports. Fly is cheaper at the smallest size if measured RSS fits 256 MB and the user accepts single-host recovery work; its volume does not replicate by itself. Neither free offer should be relied on for this trip. No HA, guaranteed 24/7, or zero-data-loss claim is made. Do not add LiteFS/Postgres/CouchDB/Redis merely to turn a small cache into a platform.
