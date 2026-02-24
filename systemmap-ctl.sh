#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SystemMAP – Prozess-Steuerung (wird von systemd aufgerufen)
# ═══════════════════════════════════════════════════════════════════════════
#
# Verwendung:
#   ./systemmap-ctl.sh prestart    # Docker-Container starten + Health-Checks
#   ./systemmap-ctl.sh start       # Backend, Worker, Frontend starten
#   ./systemmap-ctl.sh stop        # Alle Prozesse stoppen
#   ./systemmap-ctl.sh reload      # Backend + Worker neu starten (kein Docker)
#   ./systemmap-ctl.sh status      # Status aller Komponenten
#
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

# ─── Docker API Kompatibilität ───────────────────────────────────────────
# Docker Compose v5.x nutzt API v1.53+, aber Docker Engine 20.10 unterstützt
# nur bis API v1.41. Wir erzwingen die passende Version.
export DOCKER_API_VERSION="${DOCKER_API_VERSION:-1.41}"

# ─── Konfiguration ───────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PID_DIR="${SYSTEMMAP_PID_DIR:-/run/systemmap}"
LOG_DIR="${SYSTEMMAP_LOG_DIR:-/var/log/systemmap}"

BACKEND_PID="$PID_DIR/systemmap-backend.pid"
WORKER_PID="$PID_DIR/systemmap-worker.pid"

BACKEND_LOG="$LOG_DIR/backend.log"
WORKER_LOG="$LOG_DIR/worker.log"

TSX="$SCRIPT_DIR/backend/node_modules/.bin/tsx"

BACKEND_PORT="${PORT:-3001}"

# ─── Hilfsfunktionen ─────────────────────────────────────────────────────
log()  { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die()  { log "FEHLER: $*" >&2; exit 1; }

pid_alive() {
  [[ -f "$1" ]] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null
}

kill_pid() {
  local pidfile="$1" label="$2" sig="${3:-TERM}"
  if pid_alive "$pidfile"; then
    local pid
    pid=$(cat "$pidfile")
    kill -"$sig" "$pid" 2>/dev/null
    # Warten bis Prozess beendet (max 10s)
    local i=0
    while kill -0 "$pid" 2>/dev/null && [[ $i -lt 20 ]]; do
      sleep 0.5
      i=$((i + 1))
    done
    # Falls immer noch lebendig → SIGKILL
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
      sleep 1
    fi
    rm -f "$pidfile"
    log "$label gestoppt (PID $pid)"
  else
    rm -f "$pidfile" 2>/dev/null
  fi
}

wait_for_port() {
  local port="$1" label="$2" max="${3:-30}"
  local i=0
  while ! ss -tlnp 2>/dev/null | grep -q ":${port} " && [[ $i -lt $max ]]; do
    sleep 1
    i=$((i + 1))
  done
  if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
    log "$label lauscht auf Port $port"
    return 0
  else
    log "WARNUNG: $label nicht erreichbar auf Port $port nach ${max}s"
    return 1
  fi
}

# ─── Verzeichnisse sicherstellen ─────────────────────────────────────────
ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
  chmod 755 "$PID_DIR" "$LOG_DIR"
}

# ═══════════════════════════════════════════════════════════════════════════
# PRESTART – Docker-Container + Health-Checks
# ═══════════════════════════════════════════════════════════════════════════
cmd_prestart() {
  ensure_dirs
  log "Prestart: Docker-Container sicherstellen..."

  # Docker Compose starten (falls nicht schon laufend)
  docker compose -f "$SCRIPT_DIR/docker-compose.yml" up -d 2>&1 | while read -r line; do
    log "  docker: $line"
  done

  # PostgreSQL Health-Check
  log "Warte auf PostgreSQL..."
  local retries=0
  while ! docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T postgres pg_isready -U systemmap >/dev/null 2>&1; do
    retries=$((retries + 1))
    if [[ $retries -gt 60 ]]; then
      die "PostgreSQL nicht erreichbar nach 60 Sekunden"
    fi
    sleep 1
  done
  log "PostgreSQL bereit"

  # Redis Health-Check
  log "Warte auf Redis..."
  retries=0
  while ! docker compose -f "$SCRIPT_DIR/docker-compose.yml" exec -T redis redis-cli ping >/dev/null 2>&1; do
    retries=$((retries + 1))
    if [[ $retries -gt 30 ]]; then
      die "Redis nicht erreichbar nach 30 Sekunden"
    fi
    sleep 1
  done
  log "Redis bereit"

  log "Prestart abgeschlossen"
}

# ═══════════════════════════════════════════════════════════════════════════
# START – Backend, Worker, Frontend
# ═══════════════════════════════════════════════════════════════════════════
cmd_start() {
  ensure_dirs

  # ─── Alte Prozesse aufräumen ──────────────────────────────────────────
  for pf in "$BACKEND_PID" "$WORKER_PID"; do
    if pid_alive "$pf"; then
      log "Vorheriger Prozess noch aktiv – wird gestoppt"
      kill_pid "$pf" "$(basename "$pf")"
    fi
  done

  # ─── Backend starten ─────────────────────────────────────────────────
  log "Starte Backend..."
  cd "$SCRIPT_DIR/backend"
  nohup "$TSX" src/index.ts >> "$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID"
  log "Backend gestartet (PID $(cat "$BACKEND_PID"))"

  wait_for_port "$BACKEND_PORT" "Backend" 30 || true

  # ─── Worker starten ──────────────────────────────────────────────────
  log "Starte Worker..."
  nohup "$TSX" src/workers/index.ts >> "$WORKER_LOG" 2>&1 &
  echo $! > "$WORKER_PID"
  log "Worker gestartet (PID $(cat "$WORKER_PID"))"

  # ─── Health-Check ────────────────────────────────────────────────────
  sleep 2
  if curl -sf "http://localhost:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    log "✅ API Health-Check bestanden"
  else
    log "⚠️  API Health-Check fehlgeschlagen – Backend-Log prüfen: $BACKEND_LOG"
  fi

  log "Alle Dienste gestartet"
  log "  App:       http://localhost:${BACKEND_PORT}"
  log "  API:       http://localhost:${BACKEND_PORT}/api"
  log "  Logs:      $LOG_DIR/"
}

# ═══════════════════════════════════════════════════════════════════════════
# STOP – Alle Prozesse beenden
# ═══════════════════════════════════════════════════════════════════════════
cmd_stop() {
  log "Stoppe SystemMAP-Dienste..."

  kill_pid "$WORKER_PID"   "Worker"
  kill_pid "$BACKEND_PID"  "Backend"

  # Auch verwaiste Prozesse auf den Ports aufräumen
  local pid
  pid=$(lsof -ti ":${BACKEND_PORT}" 2>/dev/null | head -1)
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null
    log "Verwaister Prozess auf Port $BACKEND_PORT beendet (PID $pid)"
  fi

  log "Alle Dienste gestoppt"
  log "Hinweis: Docker-Container (PostgreSQL, Redis) laufen weiter."
  log "  Stoppen mit: docker compose -f $SCRIPT_DIR/docker-compose.yml down"
}

# ═══════════════════════════════════════════════════════════════════════════
# RELOAD – Backend + Worker neu starten (ohne Docker/Frontend)
# ═══════════════════════════════════════════════════════════════════════════
cmd_reload() {
  log "Reload: Backend und Worker werden neu gestartet..."

  kill_pid "$WORKER_PID"  "Worker"
  kill_pid "$BACKEND_PID" "Backend"
  sleep 1

  cd "$SCRIPT_DIR/backend"
  nohup "$TSX" src/index.ts >> "$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID"
  log "Backend neu gestartet (PID $(cat "$BACKEND_PID"))"

  wait_for_port "$BACKEND_PORT" "Backend" 30 || true

  nohup "$TSX" src/workers/index.ts >> "$WORKER_LOG" 2>&1 &
  echo $! > "$WORKER_PID"
  log "Worker neu gestartet (PID $(cat "$WORKER_PID"))"

  log "Reload abgeschlossen"
}

# ═══════════════════════════════════════════════════════════════════════════
# STATUS
# ═══════════════════════════════════════════════════════════════════════════
cmd_status() {
  echo "╔════════════════════════════════════════════════════╗"
  echo "║          SystemMAP – Dienststatus                   ║"
  echo "╠════════════════════════════════════════════════════╣"

  # Docker
  echo "║ Docker:"
  if docker compose -f "$SCRIPT_DIR/docker-compose.yml" ps --format '{{.Name}}: {{.Status}}' 2>/dev/null | while read -r line; do
    echo "║   $line"
  done; then
    true
  else
    echo "║   ⚠️  Nicht erreichbar"
  fi

  # Backend
  if pid_alive "$BACKEND_PID"; then
    echo "║ Backend:   ✅ Aktiv (PID $(cat "$BACKEND_PID"), Port $BACKEND_PORT)"
  else
    echo "║ Backend:   ❌ Nicht aktiv"
  fi

  # Worker
  if pid_alive "$WORKER_PID"; then
    echo "║ Worker:    ✅ Aktiv (PID $(cat "$WORKER_PID"))"
  else
    echo "║ Worker:    ❌ Nicht aktiv"
  fi

  # API Health
  if curl -sf "http://localhost:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    echo "║ API:       ✅ Erreichbar"
  else
    echo "║ API:       ❌ Nicht erreichbar"
  fi

  echo "╠════════════════════════════════════════════════════╣"
  echo "║ Logs:   $LOG_DIR/"
  echo "║ PIDs:   $PID_DIR/"
  echo "╚════════════════════════════════════════════════════╝"
}

# ═══════════════════════════════════════════════════════════════════════════
# Hauptlogik
# ═══════════════════════════════════════════════════════════════════════════
case "${1:-status}" in
  prestart) cmd_prestart ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  reload)   cmd_reload ;;
  status)   cmd_status ;;
  *)
    echo "Verwendung: $0 {prestart|start|stop|reload|status}"
    exit 1
    ;;
esac
