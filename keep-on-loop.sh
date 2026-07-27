#!/usr/bin/env bash
# keep-on-loop.sh — Autonomous run-on-loop supervisor
# Restarts feed-attijari-daemon and feed-attijari-watchdog if they die.
# Safe to run on macOS, Linux, and WSL.
# Usage:
#   ./keep-on-loop.sh                 # foreground (recommended in tmux/screen)
#   ./keep-on-loop.sh --daemon        # double-fork into background
#   ./keep-on-loop.sh --once          # check once and exit
set -u

WORKSPACE="${WORKSPACE:-$(cd "$(dirname "$0")" && pwd)}"
DAEMON_SCRIPT="$WORKSPACE/scripts/feed-attijari-daemon.mjs"
WATCHDOG_SCRIPT="$WORKSPACE/scripts/feed-attijari-watchdog.mjs"
DAEMON_LOG="$WORKSPACE/dist_rwc/daemon-loop.log"
WATCHDOG_LOG="$WORKSPACE/dist_rwc/watchdog-loop.log"
PID_DIR="$WORKSPACE/dist_rwc"
DAEMON_PID_FILE="$PID_DIR/daemon.pid"
WATCHDOG_PID_FILE="$PID_DIR/watchdog.pid"

mkdir -p "$PID_DIR"

alive() {
  local pid_file="$1"
  [ -f "$pid_file" ] || return 1
  local pid; pid=$(cat "$pid_file" 2>/dev/null)
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

start_daemon() {
  if alive "$DAEMON_PID_FILE"; then
    echo "[loop] daemon alive (pid=$(cat "$DAEMON_PID_FILE"))"
    return 0
  fi
  echo "[loop] starting daemon -> $DAEMON_LOG"
  nohup node "$DAEMON_SCRIPT" --interval=60 >>"$DAEMON_LOG" 2>&1 &
  echo $! > "$DAEMON_PID_FILE"
  sleep 2
  if alive "$DAEMON_PID_FILE"; then
    echo "[loop] daemon started (pid=$(cat "$DAEMON_PID_FILE"))"
  else
    echo "[loop] daemon FAILED to start — see $DAEMON_LOG"
  fi
}

start_watchdog() {
  if alive "$WATCHDOG_PID_FILE"; then
    echo "[loop] watchdog alive (pid=$(cat "$WATCHDOG_PID_FILE"))"
    return 0
  fi
  echo "[loop] starting watchdog -> $WATCHDOG_LOG"
  nohup node "$WATCHDOG_SCRIPT" >>"$WATCHDOG_LOG" 2>&1 &
  echo $! > "$WATCHDOG_PID_FILE"
  sleep 2
  if alive "$WATCHDOG_PID_FILE"; then
    echo "[loop] watchdog started (pid=$(cat "$WATCHDOG_PID_FILE"))"
  else
    echo "[loop] watchdog FAILED to start — see $WATCHDOG_LOG"
  fi
}

stop_all() {
  for pf in "$WATCHDOG_PID_FILE" "$DAEMON_PID_FILE"; do
    if [ -f "$pf" ]; then
      local pid; pid=$(cat "$pf")
      kill "$pid" 2>/dev/null && echo "[loop] killed pid $pid"
      rm -f "$pf"
    fi
  done
}

status() {
  echo "=== AUTONOMOUS LOOP STATUS ==="
  if alive "$DAEMON_PID_FILE"; then
    echo "  daemon   : RUNNING (pid=$(cat "$DAEMON_PID_FILE"))"
  else
    echo "  daemon   : STOPPED"
  fi
  if alive "$WATCHDOG_PID_FILE"; then
    echo "  watchdog : RUNNING (pid=$(cat "$WATCHDOG_PID_FILE"))"
  else
    echo "  watchdog : STOPPED"
  fi
  local mt103; mt103=$(ls -1 "$WORKSPACE"/settlements/bank_wires/mt103_*.txt 2>/dev/null | wc -l)
  local wire;  wire=$(ls -1 "$WORKSPACE"/exports/settlement/instructions/wire_*.json 2>/dev/null | wc -l)
  echo "  mt103    : $mt103 files"
  echo "  wire     : $wire files"
}

case "${1:-}" in
  --stop)    stop_all; exit 0 ;;
  --status)  status; exit 0 ;;
  --once)
    start_daemon
    start_watchdog
    status
    exit 0
    ;;
  --daemon)
    # double-fork to detach from terminal
    ( ( ( node "$DAEMON_SCRIPT" --interval=60 >>"$DAEMON_LOG" 2>&1 & echo $! >"$DAEMON_PID_FILE" ) & ) & )
    ( ( ( node "$WATCHDOG_SCRIPT" >>"$WATCHDOG_LOG" 2>&1 & echo $! >"$WATCHDOG_PID_FILE" ) & ) & )
    sleep 2
    status
    exit 0
    ;;
  "")
    echo "[loop] starting supervisor (Ctrl-C to stop)…"
    start_daemon
    start_watchdog
    trap 'echo "[loop] SIGINT — stopping"; stop_all; exit 0' INT TERM
    while true; do
      sleep 30
      start_daemon
      start_watchdog
    done
    ;;
  *) echo "usage: $0 [--daemon|--once|--status|--stop]"; exit 1 ;;
esac
