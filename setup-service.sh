#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# SystemMAP – Systemd-Service Installer
# ═══════════════════════════════════════════════════════════════════════════
#
# Installiert den SystemMAP-Dienst als systemd-Service.
#
# Verwendung:
#   sudo ./setup-service.sh           # Service installieren + aktivieren
#   sudo ./setup-service.sh uninstall # Service deinstallieren
#
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─── Root-Check ──────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  error "Dieses Script muss als root ausgeführt werden: sudo $0"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="systemmap"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# ─── Deinstallation ─────────────────────────────────────────────────────
if [[ "${1:-}" == "uninstall" ]]; then
  info "Deinstalliere SystemMAP-Service..."

  if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl stop "$SERVICE_NAME"
    success "Service gestoppt"
  fi

  if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl disable "$SERVICE_NAME"
    success "Autostart deaktiviert"
  fi

  rm -f "$SERVICE_FILE"
  systemctl daemon-reload
  success "Service-Datei entfernt und systemd aktualisiert"

  echo ""
  echo -e "${GREEN}SystemMAP-Service vollständig deinstalliert.${NC}"
  echo "  Log-Verzeichnis /var/log/systemmap/ wurde beibehalten."
  echo "  Manuell löschen: rm -rf /var/log/systemmap"
  exit 0
fi

# ═══════════════════════════════════════════════════════════════════════════
# Installation
# ═══════════════════════════════════════════════════════════════════════════

echo -e "${BOLD}${CYAN}"
echo "  ═══════════════════════════════════════════════════"
echo "   SystemMAP – Systemd-Service Installation"
echo "  ═══════════════════════════════════════════════════"
echo -e "${NC}"

# ─── Voraussetzungen prüfen ──────────────────────────────────────────────
info "Prüfe Voraussetzungen..."

[[ -f "$SCRIPT_DIR/docker-compose.yml" ]] || error "docker-compose.yml nicht gefunden in $SCRIPT_DIR"
[[ -f "$SCRIPT_DIR/.env" ]]              || error ".env nicht gefunden – bitte erst ./install.sh ausführen"
[[ -f "$SCRIPT_DIR/systemmap-ctl.sh" ]]   || error "systemmap-ctl.sh nicht gefunden"
[[ -f "$SCRIPT_DIR/systemmap.service" ]]  || error "systemmap.service Template nicht gefunden"

command -v node  &>/dev/null || error "Node.js nicht installiert"
command -v docker &>/dev/null || error "Docker nicht installiert"

NODE_BIN_DIR="$(dirname "$(which node)")"
success "Node.js in $NODE_BIN_DIR"

# ─── Skripte ausführbar machen ───────────────────────────────────────────
chmod +x "$SCRIPT_DIR/systemmap-ctl.sh"
success "systemmap-ctl.sh ausführbar"

# ─── Service-Datei generieren ────────────────────────────────────────────
info "Generiere Service-Datei..."

sed \
  -e "s|__INSTALL_DIR__|${SCRIPT_DIR}|g" \
  -e "s|__NODE_BIN_DIR__|${NODE_BIN_DIR}|g" \
  "$SCRIPT_DIR/systemmap.service" > "$SERVICE_FILE"

chmod 644 "$SERVICE_FILE"
success "Service-Datei installiert: $SERVICE_FILE"

# ─── Log-Verzeichnis ────────────────────────────────────────────────────
mkdir -p /var/log/systemmap
chmod 755 /var/log/systemmap
success "Log-Verzeichnis: /var/log/systemmap/"

# ─── Systemd aktualisieren ──────────────────────────────────────────────
systemctl daemon-reload
success "systemd daemon-reload"

# ─── Service aktivieren ─────────────────────────────────────────────────
systemctl enable "$SERVICE_NAME"
success "Autostart bei Boot aktiviert"

# ─── Abschluss ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║       SystemMAP-Service erfolgreich installiert!           ║${NC}"
echo -e "${GREEN}${BOLD}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}${BOLD}║${NC}                                                            ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Starten:       ${BOLD}sudo systemctl start systemmap${NC}              ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Stoppen:       ${BOLD}sudo systemctl stop systemmap${NC}               ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Neustarten:    ${BOLD}sudo systemctl restart systemmap${NC}            ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Status:        ${BOLD}sudo systemctl status systemmap${NC}             ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Logs:          ${BOLD}journalctl -u systemmap -f${NC}                  ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Detail-Logs:   ${BOLD}/var/log/systemmap/*.log${NC}                    ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Deinstallieren: ${BOLD}sudo ./setup-service.sh uninstall${NC}         ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}                                                            ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}  Manuell steuern:                                          ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}    ${BOLD}./systemmap-ctl.sh status${NC}                                ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}    ${BOLD}./systemmap-ctl.sh start | stop | reload${NC}                 ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}║${NC}                                                            ${GREEN}${BOLD}║${NC}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Optional: Service direkt starten?
echo -e "${YELLOW}Service jetzt starten? [j/N]${NC} "
read -r answer
if [[ "$answer" =~ ^[jJyY]$ ]]; then
  systemctl start "$SERVICE_NAME"
  sleep 3
  systemctl status "$SERVICE_NAME" --no-pager || true
fi
