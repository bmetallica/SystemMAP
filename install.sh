#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SystemMAP – Automatisches Installationsskript
# https://github.com/bmetallica/SystemMAP
#
# Voraussetzungen: Node.js ≥ 18, Docker + Docker Compose, git
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Farben ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ─── Hilfsfunktionen ─────────────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}═══ $* ═══${NC}"; }

# ─── Banner ───────────────────────────────────────────────────────────────
echo -e "${BOLD}${CYAN}"
cat << 'BANNER'
  ____            _              __  __    _    ____
 / ___| _   _ ___| |_ ___ _ __ |  \/  |  / \  |  _ \
 \___ \| | | / __| __/ _ \ '_ \| |\/| | / _ \ | |_) |
  ___) | |_| \__ \ ||  __/ | | | |  | |/ ___ \|  __/
 |____/ \__, |___/\__\___|_| |_|_|  |_/_/   \_\_|
        |___/
 Linux Infrastructure Mapping Platform v4.0
BANNER
echo -e "${NC}"

# ─── Wo befinden wir uns? ────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── Modus: install / start / stop / status ──────────────────────────────
MODE="${1:-install}"

case "$MODE" in
  install) ;;
  start)   exec "$0" --start-only ;;
  stop)    exec "$0" --stop-only ;;
  status)  exec "$0" --status-only ;;
  --start-only|--stop-only|--status-only) ;;
  *)
    echo "Verwendung: $0 [install|start|stop|status]"
    exit 1
    ;;
esac

# ═══════════════════════════════════════════════════════════════════════════
# Stop-Modus
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "--stop-only" ]]; then
  step "Dienste stoppen"
  # PID-Files prüfen
  for pidfile in /tmp/systemmap-backend.pid /tmp/systemmap-workers.pid /tmp/systemmap-frontend.pid; do
    if [[ -f "$pidfile" ]]; then
      pid=$(cat "$pidfile")
      if kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
        info "Prozess $pid gestoppt ($(basename "$pidfile"))"
      fi
      rm -f "$pidfile"
    fi
  done
  success "Alle SystemMAP-Prozesse gestoppt"
  info "Docker-Container laufen weiter. Stoppen mit: docker compose down"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# Status-Modus
# ═══════════════════════════════════════════════════════════════════════════
if [[ "$MODE" == "--status-only" ]]; then
  step "SystemMAP Status"
  echo ""

  # Docker
  if docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null; then
    echo ""
  else
    warn "Docker Compose nicht erreichbar"
  fi

  # Backend
  if [[ -f /tmp/systemmap-backend.pid ]] && kill -0 "$(cat /tmp/systemmap-backend.pid)" 2>/dev/null; then
    success "Backend läuft (PID $(cat /tmp/systemmap-backend.pid))"
  else
    warn "Backend nicht aktiv"
  fi

  # Workers
  if [[ -f /tmp/systemmap-workers.pid ]] && kill -0 "$(cat /tmp/systemmap-workers.pid)" 2>/dev/null; then
    success "Workers laufen (PID $(cat /tmp/systemmap-workers.pid))"
  else
    warn "Workers nicht aktiv"
  fi

  # Frontend
  if [[ -f /tmp/systemmap-frontend.pid ]] && kill -0 "$(cat /tmp/systemmap-frontend.pid)" 2>/dev/null; then
    success "Frontend läuft (PID $(cat /tmp/systemmap-frontend.pid))"
  else
    warn "Frontend nicht aktiv"
  fi

  # Health-Check
  if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
    success "API Health-Check: OK"
  else
    warn "API nicht erreichbar auf Port 3001"
  fi

  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# Start-Modus (auch am Ende der Installation)
# ═══════════════════════════════════════════════════════════════════════════
start_services() {
  step "Dienste starten"

  # Docker
  info "Starte PostgreSQL und Redis..."
  docker compose up -d
  info "Warte auf Datenbank-Health..."
  local retries=0
  while ! docker compose exec -T postgres pg_isready -U systemmap >/dev/null 2>&1; do
    retries=$((retries + 1))
    if [[ $retries -gt 30 ]]; then
      error "PostgreSQL nicht erreichbar nach 30 Sekunden"
    fi
    sleep 1
  done
  success "PostgreSQL bereit"

  retries=0
  while ! docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do
    retries=$((retries + 1))
    if [[ $retries -gt 15 ]]; then
      error "Redis nicht erreichbar nach 15 Sekunden"
    fi
    sleep 1
  done
  success "Redis bereit"

  # Backend
  info "Starte Backend..."
  cd "$SCRIPT_DIR/backend"
  nohup npx tsx src/index.ts > /tmp/systemmap-backend.log 2>&1 &
  echo $! > /tmp/systemmap-backend.pid
  sleep 3

  if kill -0 "$(cat /tmp/systemmap-backend.pid)" 2>/dev/null; then
    success "Backend läuft (PID $(cat /tmp/systemmap-backend.pid)) auf Port ${PORT:-3001}"
  else
    error "Backend konnte nicht gestartet werden. Log: /tmp/systemmap-backend.log"
  fi

  # Workers
  info "Starte Workers..."
  nohup npx tsx src/workers/index.ts > /tmp/systemmap-workers.log 2>&1 &
  echo $! > /tmp/systemmap-workers.pid
  sleep 2

  if kill -0 "$(cat /tmp/systemmap-workers.pid)" 2>/dev/null; then
    success "Workers laufen (PID $(cat /tmp/systemmap-workers.pid))"
  else
    warn "Workers konnten nicht gestartet werden. Log: /tmp/systemmap-workers.log"
  fi

  # Frontend (Dev-Modus)
  cd "$SCRIPT_DIR/frontend"
  info "Starte Frontend..."
  nohup npx vite --host 0.0.0.0 > /tmp/systemmap-frontend.log 2>&1 &
  echo $! > /tmp/systemmap-frontend.pid
  sleep 3

  if kill -0 "$(cat /tmp/systemmap-frontend.pid)" 2>/dev/null; then
    success "Frontend läuft (PID $(cat /tmp/systemmap-frontend.pid))"
  else
    warn "Frontend konnte nicht gestartet werden. Log: /tmp/systemmap-frontend.log"
  fi

  cd "$SCRIPT_DIR"
}

if [[ "$MODE" == "--start-only" ]]; then
  start_services

  echo ""
  echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}${BOLD}   SystemMAP gestartet!${NC}"
  echo -e "${GREEN}${BOLD}════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  🌐 Frontend:  ${CYAN}http://localhost:5173${NC}"
  echo -e "  🔗 API:       ${CYAN}http://localhost:${PORT:-3001}/api${NC}"
  echo ""
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# Installations-Modus
# ═══════════════════════════════════════════════════════════════════════════

# ─── Schritt 1: Voraussetzungen prüfen ───────────────────────────────────
step "1/7 – Voraussetzungen prüfen"

# Node.js
if ! command -v node &>/dev/null; then
  error "Node.js ist nicht installiert. Bitte installiere Node.js ≥ 18: https://nodejs.org"
fi
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_VERSION" -lt 18 ]]; then
  error "Node.js ≥ 18 erforderlich (gefunden: $(node -v))"
fi
success "Node.js $(node -v)"

# npm
if ! command -v npm &>/dev/null; then
  error "npm ist nicht installiert"
fi
success "npm $(npm -v)"

# Docker
if ! command -v docker &>/dev/null; then
  error "Docker ist nicht installiert. Bitte installiere Docker: https://docs.docker.com/get-docker/"
fi
success "Docker $(docker --version | grep -oP '[\d.]+')"

# Docker Compose (v2 erforderlich)
if docker compose version &>/dev/null; then
  success "Docker Compose $(docker compose version --short 2>/dev/null || echo 'verfügbar')"
else
  error "Docker Compose v2 nicht gefunden. Bitte installiere Docker mit integriertem Compose-Plugin: https://docs.docker.com/compose/install/"
fi

# nmap (optional)
if command -v nmap &>/dev/null; then
  success "nmap $(nmap --version 2>/dev/null | head -1 | grep -oP '[\d.]+' || echo 'verfügbar')"
else
  warn "nmap nicht installiert – Netzwerk-Discovery funktioniert ohne nmap nicht"
  warn "Installieren mit: sudo apt install nmap"
fi

# ─── Schritt 2: Umgebungsvariablen ───────────────────────────────────────
step "2/7 – Umgebungsvariablen konfigurieren"

ENV_FILE="$SCRIPT_DIR/backend/.env"

if [[ -f "$ENV_FILE" ]]; then
  info "backend/.env existiert bereits – wird beibehalten"
else
  info "Generiere backend/.env aus .env.example..."
  cp "$SCRIPT_DIR/.env.example" "$ENV_FILE"

  # Sichere Schlüssel generieren
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  # In .env einsetzen
  sed -i "s|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"
  sed -i "s|ENCRYPTION_MASTER_KEY=.*|ENCRYPTION_MASTER_KEY=${ENCRYPTION_KEY}|" "$ENV_FILE"

  success "backend/.env erstellt mit sicheren Schlüsseln"
fi

# Optional: Admin-Passwort abfragen
ADMIN_PASSWORD="${SYSTEMMAP_ADMIN_PASSWORD:-admin1234}"
if [[ "$ADMIN_PASSWORD" == "admin1234" ]] && [[ -t 0 ]]; then
  echo ""
  echo -e "${YELLOW}Möchtest du ein eigenes Admin-Passwort setzen? (leer = admin1234)${NC}"
  read -rsp "Admin-Passwort: " input_pw
  echo ""
  if [[ -n "$input_pw" ]]; then
    ADMIN_PASSWORD="$input_pw"
    success "Eigenes Admin-Passwort gesetzt"
  else
    warn "Standard-Passwort 'admin1234' wird verwendet – bitte nach dem Login ändern!"
  fi
fi

# ─── Schritt 3: Docker-Container ─────────────────────────────────────────
step "3/7 – Docker-Container starten"

docker compose up -d

info "Warte auf PostgreSQL..."
retries=0
while ! docker compose exec -T postgres pg_isready -U systemmap >/dev/null 2>&1; do
  retries=$((retries + 1))
  if [[ $retries -gt 60 ]]; then
    error "PostgreSQL nicht erreichbar nach 60 Sekunden"
  fi
  sleep 1
done
success "PostgreSQL bereit"

info "Warte auf Redis..."
retries=0
while ! docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do
  retries=$((retries + 1))
  if [[ $retries -gt 30 ]]; then
    error "Redis nicht erreichbar nach 30 Sekunden"
  fi
  sleep 1
done
success "Redis bereit"

# ─── Schritt 4: Backend-Abhängigkeiten ───────────────────────────────────
step "4/7 – Backend installieren"

cd "$SCRIPT_DIR/backend"
info "npm install..."
npm install --loglevel=warn 2>&1 | tail -3
success "Backend-Dependencies installiert"

info "Prisma Client generieren..."
npx prisma generate --no-hints 2>&1 | tail -1
success "Prisma Client generiert"

info "Datenbank-Schema anwenden..."
npx prisma db push --accept-data-loss --skip-generate 2>&1 | tail -2
success "Datenbankschema synchronisiert"

# ─── Schritt 5: Admin-User erstellen ────────────────────────────────────
step "5/7 – Admin-Benutzer erstellen"

# Seed anpassen falls eigenes Passwort
if [[ "$ADMIN_PASSWORD" != "admin1234" ]]; then
  info "Erstelle Admin mit benutzerdefiniertem Passwort..."
  npx tsx -e "
const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
(async () => {
  const pw = await bcrypt.hash('${ADMIN_PASSWORD}', 12);
  // Erst bestehenden User per username suchen (Re-Installation)
  const existing = await prisma.user.findFirst({ where: { username: 'admin' } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { password: pw, email: 'admin@systemmap.local' }
    });
    console.log('Admin-User aktualisiert: admin@systemmap.local');
  } else {
    await prisma.user.create({
      data: { email: 'admin@systemmap.local', username: 'admin', password: pw, role: UserRole.ADMIN }
    });
    console.log('Admin-User erstellt: admin@systemmap.local');
  }
  await prisma.\$disconnect();
})();
" 2>&1
else
  info "Erstelle Admin mit Standard-Passwort..."
  npx tsx prisma/seed.ts 2>&1 | grep -v "^$"
fi
success "Admin-Benutzer bereit (admin@systemmap.local)"

cd "$SCRIPT_DIR"

# ─── Schritt 6: Frontend-Abhängigkeiten ─────────────────────────────────
step "6/7 – Frontend installieren"

cd "$SCRIPT_DIR/frontend"
info "npm install..."
npm install --loglevel=warn 2>&1 | tail -3
success "Frontend-Dependencies installiert"

cd "$SCRIPT_DIR"

# ─── Schritt 7: Dienste starten ─────────────────────────────────────────
step "7/7 – Dienste starten"

start_services

# ─── Health-Check ────────────────────────────────────────────────────────
info "Führe Health-Check durch..."
sleep 2
retries=0
while ! curl -s http://localhost:3001/api/health >/dev/null 2>&1; do
  retries=$((retries + 1))
  if [[ $retries -gt 15 ]]; then
    warn "API Health-Check fehlgeschlagen – Backend-Log prüfen: /tmp/systemmap-backend.log"
    break
  fi
  sleep 1
done

if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
  success "API Health-Check bestanden ✓"
fi

# ─── Abschluss ───────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║        🎉  SystemMAP erfolgreich installiert!              ║${NC}"
echo -e "${GREEN}${BOLD}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║                                                            ║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  🌐 Frontend:   ${CYAN}http://localhost:5173${NC}                     ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  🔗 Backend:    ${CYAN}http://localhost:3001/api${NC}                  ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  📊 Health:     ${CYAN}http://localhost:3001/api/health${NC}           ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║                                                            ║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  👤 Login:      ${BOLD}admin${NC} / ${BOLD}${ADMIN_PASSWORD:0:4}****${NC}                          ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║                                                            ║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  📁 Logs:       /tmp/systemmap-*.log                         ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  🛑 Stoppen:    ${BOLD}./install.sh stop${NC}                          ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  ▶  Starten:    ${BOLD}./install.sh start${NC}                         ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  📊 Status:     ${BOLD}./install.sh status${NC}                        ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║                                                            ║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [[ "$ADMIN_PASSWORD" == "admin1234" ]]; then
  echo -e "${YELLOW}${BOLD}⚠️  WICHTIG: Standard-Passwort 'admin1234' – bitte sofort ändern!${NC}"
  echo ""
fi

echo -e "${BLUE}💡 Tipp: Für Produktionsbetrieb mit Autostart als Systemd-Service installieren:${NC}"
echo -e "   ${BOLD}sudo ./setup-service.sh${NC}"
echo ""
