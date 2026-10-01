#!/bin/bash
set -euo pipefail

umask 077

supermemory_binary="/Users/avi/.supermemory/bin/supermemory-server"
supermemory_data="/Users/avi/Library/Application Support/LifeOS/Supermemory"

if [[ ! -x "$supermemory_binary" ]]; then
  echo "Supermemory is not installed at $supermemory_binary" >&2
  exit 1
fi

# The current self-hosted binary ignores HOST and listens on every interface.
# macOS's firewall must block incoming connections to this exact executable.
firewall_tool="/usr/libexec/ApplicationFirewall/socketfilterfw"
if [[ "$("$firewall_tool" --getglobalstate)" != *"State = 1"* ]] ||
   [[ "$("$firewall_tool" --getappblocked "$supermemory_binary")" != *"is blocked."* ]]; then
  echo "Supermemory's LAN listener is not blocked by the macOS firewall; refusing to start." >&2
  exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
  exit 0
fi

mkdir -p "$supermemory_data"
chmod 700 "$supermemory_data"

export SUPERMEMORY_DATA_DIR="$supermemory_data"
export SUPERMEMORY_SKIP_EMBEDDING_PREWARM=1
export SUPERMEMORY_INGEST_CONCURRENCY=1
export SUPERMEMORY_LOCAL_EMBEDDING_POOL_SIZE=1
export SUPERMEMORY_LOCAL_EMBEDDING_WASM_THREADS=1
export SUPERMEMORY_DISABLE_TELEMETRY=1
export PORT=6767

export OPENAI_BASE_URL="http://127.0.0.1:6768/v1"
export OPENAI_MODEL="mimo-v2.6-flash"
export OPENAI_FAST_MODEL="$OPENAI_MODEL"
export OPENAI_TEXT_MODEL="$OPENAI_MODEL"
export OPENAI_API_KEY="$(/usr/bin/security find-generic-password -s lifeos-supermemory-opencode-go -a avi -w)"

exec "$supermemory_binary"
