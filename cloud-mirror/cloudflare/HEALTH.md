# Oura health on the main LifeOS connection

Any client signed in to `https://lifeos-read-mirror.lifeos-read-mirror-worker.workers.dev/mcp` can read Oura sleep, readiness, HRV and activity, with no second connector or owner-key file. The connection needs the opt-in `health:read` scope, which the owner ticks as **Oura health** on the consent page. It is unticked unless the client asks for it. Existing grants do not gain it on refresh, so reconnect once.

## How it works

The main Worker lists one read-only tool per Oura collection, named `read_oura_<collection>` (for example `read_oura_sleep`, `read_oura_daily_readiness`, `read_oura_daily_activity`). The list comes from `integrations/oura-setup/health-collections.json`, shared by both Workers. Grants without `health:read` do not see these tools, and calling one makes no Oura request.

Each call goes through the `OURA_HEALTH` service binding to the `HealthReader` entrypoint of the `lifeos-app-setup` Worker. A named entrypoint has no public URL. Only a Worker in the same Cloudflare account whose own configuration declares that binding can call it. No secret crosses Workers. The Oura tokens, refresh, the 30 reads per minute budget and date validation stay in the existing `OuraVault` Durable Object. Its new internal `/oura/read` path accepts only the vault's internal header, and the public router never forwards it.

Nothing is stored. Neither Worker logs health values, and observability stays disabled on both. `health-test.mjs` runs both real Workers together and checks unauthenticated and wrong-owner denial, scope denial, the unticked consent default, live reads, bad date ranges, a disconnected Oura account, that the internal path is unreachable from the internet, and that no synthetic health value reaches Worker logs.

## Deploy order

Deploy `lifeos-app-setup` first, so the `HealthReader` entrypoint exists. Then deploy `lifeos-read-mirror` with the new binding. No secrets or OAuth apps change.
