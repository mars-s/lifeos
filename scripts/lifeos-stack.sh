#!/bin/bash
set -euo pipefail

agent_dir="/Users/avi/Library/LaunchAgents"
runtime_dir="/Users/avi/Library/Application Support/LifeOS/bin"
source_dir="$(dirname "$(realpath "${BASH_SOURCE[0]}")")"
domain="gui/$(id -u)"

sync_memory_runtime() {
  mkdir -p "$runtime_dir"
  chmod 700 "$runtime_dir"
  install -m 700 \
    "$source_dir/run-lifeos-memory.sh" \
    "$source_dir/run-supermemory.sh" \
    "$source_dir/opencode-session-proxy.py" \
    "$runtime_dir/"
}

loaded() {
  launchctl print "$domain/$1" >/dev/null 2>&1
}

agent_pid() {
  launchctl list | awk -v wanted="$1" '$3 == wanted { print $1 }'
}

wait_for_running() {
  local label="$1"
  local attempt
  for attempt in {1..40}; do
    if [[ -n "$(agent_pid "$label")" && "$(agent_pid "$label")" != "-" ]]; then
      return 0
    fi
    sleep 0.25
  done
  echo "$label did not become running" >&2
  return 1
}

wait_for_stopped() {
  local label="$1"
  local attempt
  for attempt in {1..40}; do
    if ! loaded "$label"; then
      return 0
    fi
    sleep 0.25
  done
  echo "$label did not finish stopping" >&2
  return 1
}

wait_for_memory_ports_closed() {
  local attempt
  for attempt in {1..80}; do
    if ! lsof -nP -iTCP:6767 -iTCP:6768 -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "memory ports are still open after stop" >&2
  return 1
}

start_agent() {
  local label="$1"
  local process_id
  if loaded "$label"; then
    process_id="$(agent_pid "$label")"
    if [[ -z "$process_id" || "$process_id" == "-" ]]; then
      launchctl kickstart "$domain/$label"
      wait_for_running "$label"
      echo "$label started"
    else
      echo "$label already running"
    fi
    return
  fi
  launchctl bootstrap "$domain" "$agent_dir/$label.plist"
  wait_for_running "$label"
  echo "$label started"
}

stop_agent() {
  local label="$1"
  if ! loaded "$label"; then
    echo "$label already stopped"
    return
  fi
  launchctl bootout "$domain/$label"
  wait_for_stopped "$label"
  if [[ "$label" == "com.lifeos.memory" ]]; then
    wait_for_memory_ports_closed
    sleep 1
  fi
  echo "$label stopped"
}

status_agent() {
  local label="$1"
  local process_id
  if ! loaded "$label"; then
    echo "$label: stopped"
    return
  fi
  process_id="$(agent_pid "$label")"
  if [[ -n "$process_id" && "$process_id" != "-" ]]; then
    echo "$label: running (pid $process_id)"
  else
    echo "$label: loaded, not running"
  fi
}

reload_mcp() {
  local label="com.lifeos.mcp"
  local old_pid
  local new_pid
  local attempt
  if ! loaded "$label"; then
    echo "$label is not loaded; run lifeos-stack start first" >&2
    return 1
  fi
  old_pid="$(agent_pid "$label")"
  launchctl kickstart -k "$domain/$label"
  for attempt in {1..40}; do
    new_pid="$(agent_pid "$label")"
    if [[ -n "$new_pid" && "$new_pid" != "-" && "$new_pid" != "$old_pid" ]] && \
      curl --fail --silent --show-error --max-time 2 \
        http://127.0.0.1:48763/health >/dev/null 2>&1; then
      echo "$label reloaded (pid $new_pid)"
      return 0
    fi
    sleep 0.25
  done
  echo "$label did not become healthy after reload" >&2
  return 1
}

case "${1:-}" in
  start)
    sync_memory_runtime
    start_agent com.lifeos.memory
    start_agent com.lifeos.mcp
    start_agent com.lifeos.ngrok
    ;;
  stop)
    stop_agent com.lifeos.ngrok
    stop_agent com.lifeos.mcp
    stop_agent com.lifeos.memory
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  reload)
    reload_mcp
    ;;
  status)
    status_agent com.lifeos.memory
    status_agent com.lifeos.mcp
    status_agent com.lifeos.ngrok
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|reload|status}" >&2
    exit 2
    ;;
esac
