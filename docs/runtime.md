# Run LifeOS locally

LifeOS supports two local transports.

The LifeOS process does not call a paid model API. The MCP client supplies the model, while LifeOS reads local Things and Calendar data and applies reviewed changes.

Use stdio when an MCP client starts LifeOS for one session. This is the default.

```sh
uv run lifeos-mcp
```

Use Streamable HTTP when a client needs a long-lived local process.

```sh
uv run lifeos-mcp --transport streamable-http --host 127.0.0.1 --port 48763
```

The server binds to a loopback host only. The CLI rejects public bind addresses such as `0.0.0.0`. Local HTTP remains unauthenticated unless all remote OAuth settings are present. Never expose the unauthenticated listener with a reverse proxy or port forward.

## Check the process

The HTTP transport exposes a loopback health check at `/health`.

```sh
curl --fail http://127.0.0.1:48763/health
```

The response is `{"status":"ok","service":"lifeos-mcp"}`. The check confirms that the process accepts HTTP requests. It does not check Calendar permission, Things availability, or a successful write.

## Configure the process

CLI flags override environment variables. The supported variables are:

- `LIFEOS_TRANSPORT` with `stdio` or `streamable-http`.
- `LIFEOS_HOST` with a loopback host.
- `LIFEOS_PORT` with a port from 1 through 65535.
- `LIFEOS_HTTP_PATH` with an absolute HTTP path. The default is `/mcp`.
- `LIFEOS_DB_PATH` with the SQLite state path.
- `LIFEOS_JOURNAL_DIR` with the Daily Journal Markdown directory.
- `LIFEOS_CALENDAR_HELPER` with the EventKit helper path.
- `LIFEOS_LOG_LEVEL` with `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL`.

Remote ChatGPT access requires all four OAuth settings:

- `LIFEOS_PUBLIC_BASE_URL` with the HTTPS origin assigned by ngrok.
- `LIFEOS_GITHUB_CLIENT_ID` from a GitHub OAuth app.
- `LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_SERVICE` with the Keychain service name.
- `LIFEOS_GITHUB_CLIENT_SECRET_KEYCHAIN_ACCOUNT` with the matching Keychain account.
- `LIFEOS_GITHUB_ALLOWED_LOGIN` with the only GitHub login allowed to reach LifeOS.

LifeOS rejects partial OAuth configuration. GitHub authenticates the user, FastMCP supplies the MCP OAuth 2.1 flow expected by ChatGPT, and LifeOS rejects valid GitHub tokens belonging to any other login.

The stdio entrypoint keeps the FastMCP banner off so startup text cannot mix with the MCP protocol. Pass `--show-banner` when you run an HTTP server by hand and want the banner.

## Keep a local HTTP process alive with launchd

The repository includes launchd examples for [LifeOS](../launchd/com.lifeos.mcp.plist.example) and [ngrok](../launchd/com.lifeos.ngrok.plist.example). Replace every placeholder before loading them. Start LifeOS first and verify OAuth before loading the ngrok agent.

```sh
cp launchd/com.lifeos.mcp.plist.example ~/Library/LaunchAgents/com.lifeos.mcp.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.lifeos.mcp.plist
```

Check the process with the health command above. To stop the service, unload the plist.

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.lifeos.mcp.plist
```

Both examples use `KeepAlive` and `RunAtLoad`. They do not grant Calendar access. macOS still controls Calendar permission for the user session that owns the process. Keep the ngrok authtoken in ngrok's owner-only configuration and the GitHub OAuth secret in macOS Keychain.
