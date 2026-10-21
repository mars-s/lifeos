# LifeOS local tool service

LifeOS Sync answers relayed tool calls through one long-running Node process (`local-service/`). That process keeps a single Python worker (`python -m lifeos.cloud_bridge --serve`) warm. A cold call takes about 800 ms. Warm calls take about 60 ms.

## How a call flows

1. LifeOS Sync (`LocalToolBridge.swift`) checks that the tool is on the allowlist, then hands the call to the `LocalService` actor.
2. `LocalService.swift` starts Node if it isn't already running and waits for its ready line. It sends one JSON line and waits for one reply. Only one call runs at a time. A second concurrent call gets "busy".
3. Node (`src/main.ts`) checks the request against `cloud-mirror/cloudflare/local-tool-contracts.json`. `src/worker.ts` waits for Python's `WORKER_READY` line before sending anything to it.

## Failure rules

- **Nothing sent** (Node or Python couldn't start): LifeOS Sync falls back to the old per-call Python bridge, or returns "No invocation was sent".
- **Maybe executed** (crash, timeout or malformed reply after sending): the worker is replaced and the call returns an uncertain error. LifeOS never replays these calls automatically.

## Check it

```sh
cd local-service && npx vitest run
uv run pytest tests/test_cloud_bridge.py
cd mac-sync && swift test
"/Applications/LifeOS Sync.app/Contents/MacOS/LifeOSSync" --local-tool-check
```

`--local-tool-check` runs `read_things_tags` four times without starting sync or reading credentials.

## Install

Run `sh mac-sync/build-app.sh`, quit LifeOS Sync, copy the built bundle to `/Applications` with `ditto`, then reopen it. Backups of earlier builds are kept in `~/Library/Application Support/LifeOS/app-backups/`.

## Troubleshooting

If Things reads hang, check the screen for a macOS prompt like "would like to access data from other apps". macOS asks once for each binary (LifeOS Sync, `uv`, Python), and every Things read blocks until someone answers it. Click Allow, or grant access in System Settings, Privacy & Security.
