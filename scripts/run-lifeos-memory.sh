#!/bin/bash
set -euo pipefail

umask 077

runtime_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
log_dir="/Users/avi/Library/Logs/LifeOS"
proxy_log="$log_dir/memory-proxy.log"
server_log="$log_dir/supermemory.log"

mkdir -p "$log_dir"
chmod 700 "$log_dir"
for log_file in "$proxy_log" "$server_log"; do
  if [[ -e "$log_file" ]]; then
    chmod 600 "$log_file"
  fi
done

"$runtime_dir/run-supermemory.sh" --check

"/opt/homebrew/bin/python3.14" "$runtime_dir/opencode-session-proxy.py" >>"$proxy_log" 2>&1 &
proxy_pid=$!
"$runtime_dir/run-supermemory.sh" >>"$server_log" 2>&1 &
server_pid=$!

stop_children() {
  trap - EXIT TERM INT
  kill "$server_pid" "$proxy_pid" 2>/dev/null || true
  wait "$server_pid" "$proxy_pid" 2>/dev/null || true
}
trap stop_children EXIT TERM INT

while kill -0 "$server_pid" 2>/dev/null && kill -0 "$proxy_pid" 2>/dev/null; do
  "$runtime_dir/run-supermemory.sh" --check >/dev/null 2>&1 || exit 1
  sleep 15
done

exit 1
