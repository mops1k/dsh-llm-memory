#!/usr/bin/env bash
# Restart the DSH Web harness on this machine (port 3080).
#
# Why this shape: the harness server is an ordinary user process (started from a
# shell or by ~/.local/bin/dsh-web), not a unit you can just `systemctl restart`,
# and an agent session runs INSIDE that server. A restart helper started as a
# child of the harness therefore dies in the same cgroup the moment the server is
# killed — which is why the older version stopped the server but never brought it
# back (log shows "stopping pid …" with no "starting …" after it).
#
# Fix: the script re-executes itself inside its own transient systemd user unit
# (systemd-run --user), so it survives the server's death, and it boots the new
# server in yet another transient unit with a unique name, so the server is not
# a child of the restart unit and is not collected with it.
#
# Usage: restart-dsh.sh [delay-seconds]
#   delay-seconds  wait before touching the port (default 0) — used to let the
#                  caller finish its current turn before the server drops.
#
# Log: ${XDG_STATE_HOME:-~/.local/state}/dsh-web/restart.log
set -uo pipefail

PORT="${DSH_WEB_PORT:-3080}"
DELAY="${1:-0}"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/dsh-web"
LOG="$STATE_DIR/restart.log"
URL="http://127.0.0.1:$PORT"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

mkdir -p "$STATE_DIR"
log() { printf '%s %s\n' "$(date -Is)" "$*" >>"$LOG"; }

listeners() {
    fuser -n tcp "$PORT" 2>/dev/null | tr -s ' \t' '\n' | grep -E '^[0-9]+$' || true
}

# ── 1. leave the harness cgroup: re-exec inside our own transient unit ───────
if ! grep -qa 'dsh-restart-' /proc/self/cgroup 2>/dev/null; then
    SELF="$(readlink -f "$0")"
    unit="dsh-restart-$(date +%s)"
    log "restart requested (delay=${DELAY}s, port=$PORT) — re-executing in $unit"
    if systemd-run --user --collect --unit="$unit" \
            -p WorkingDirectory="$HOME" \
            -p StandardOutput=append:"$LOG" \
            -p StandardError=append:"$LOG" \
            /usr/bin/env bash "$SELF" "$DELAY"; then
        echo "restart scheduled in $unit (log: $LOG)"
        exit 0
    fi
    log "systemd-run failed — continuing in the current process (it may die with the server)"
fi

# ── 2. stop the current server ───────────────────────────────────────────────
if [[ "$DELAY" != "0" ]]; then
    sleep "$DELAY"
fi

for pid in $(listeners); do
    # Never kill an unrelated process that happens to hold the port.
    if ! grep -qa 'dsh' "/proc/$pid/cmdline" 2>/dev/null; then
        log "pid $pid holds port $PORT but is not dsh — leaving it alone"
        continue
    fi
    log "stopping pid $pid"
    kill -TERM "$pid" 2>/dev/null || true
done

for _ in $(seq 1 30); do
    sleep 1
    [[ -z "$(listeners)" ]] && break
done

for pid in $(listeners); do
    if grep -qa 'dsh' "/proc/$pid/cmdline" 2>/dev/null; then
        log "pid $pid ignored SIGTERM — killing"
        kill -KILL "$pid" 2>/dev/null || true
    fi
done
sleep 1

# ── 3. boot the server in its own transient unit ─────────────────────────────
server_unit="dsh-web-$(date +%s)"
log "starting dsh web as transient unit $server_unit"
if ! systemd-run --user --collect --unit="$server_unit" \
        -p WorkingDirectory="$HOME" \
        -p StandardOutput=append:"$STATE_DIR/server.log" \
        -p StandardError=append:"$STATE_DIR/server.log" \
        /usr/bin/dsh web --no-open --host 127.0.0.1 --port "$PORT" >>"$LOG" 2>&1; then
    log "systemd-run failed — falling back to setsid nohup"
    setsid nohup /usr/bin/dsh web --no-open --host 127.0.0.1 --port "$PORT" \
        >>"$STATE_DIR/server.log" 2>&1 </dev/null &
fi

for _ in $(seq 1 60); do
    sleep 1
    code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$URL" 2>/dev/null || true)"
    if [[ -n "$code" && "$code" != "000" ]]; then
        log "server is up (HTTP $code), unit $server_unit — open the app window again if it shows a connection error"
        exit 0
    fi
done

log "ERROR: server did not answer on $URL within 60s"
exit 1
