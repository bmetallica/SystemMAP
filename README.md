# 🗺️ SystemMAP – Linux Infrastructure Mapping Platform

> **Automatische Inventarisierung, Visualisierung und KI-gestützte Analyse deiner kompletten Linux-Server-Infrastruktur.**

![Version](https://img.shields.io/badge/version-5.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18.0-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![React](https://img.shields.io/badge/React-18-61dafb)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)

---

## 🎯 Was ist SystemMAP?

SystemMAP ist eine **Self-Hosted-Plattform** für Linux-Administratoren, die ihre gesamte Server-Infrastruktur **automatisch inventarisiert, überwacht und dokumentiert** – ohne Agents auf den Zielservern installieren zu müssen.

Per **SSH** werden 23 Datenmodule pro Server gesammelt (OS, Prozesse, Docker, Systemd, SSL, Firewall, LVM, Cron, Benutzer u.v.m.), in einer Datenbank gespeichert und über ein modernes Web-Frontend visualisiert. Optional analysiert eine **integrierte KI** (Ollama, OpenAI, Claude, Gemini u.a.) Logs, erkennt Anomalien und generiert automatische Wartungsanleitungen.

### Warum SystemMAP?

| Problem | SystemMAP-Lösung |
|---------|-----------------|
| „Welche Services laufen auf welchem Server?" | Automatische Inventarisierung aller Prozesse, Ports, Docker-Container und Systemd-Units |
| „Wann läuft das SSL-Zertifikat ab?" | SSL-Scanner mit Alarmierung 30 Tage vor Ablauf |
| „Was hat sich seit dem letzten Scan verändert?" | Automatische Differenz-Erkennung mit SHA-256-Prüfsummen |
| „Wie hängen unsere Server zusammen?" | Interaktive Topologie-Karte mit automatischer Verbindungserkennung |
| „Was bedeuten die Fehler in den Logs?" | KI-Log-Analyse mit Health-Score und konkreten Empfehlungen |
| „Ich brauche eine Dokumentation der Infrastruktur" | Export als JSON, CSV (Excel) oder Markdown – pro Server oder als Gesamtinventar |
| „Ein neuer Admin muss sich einarbeiten" | KI-generierte Server-Zusammenfassungen und Auto-Runbooks |

---

## ✨ Feature-Übersicht

### 🔍 Datensammlung – 23 Module per SSH

Agentless Deep-Scan per SSH – kein Agent, kein Daemon auf den Zielservern nötig:

| # | Modul | Gesammelte Daten |
|---|-------|-----------------|
| 1 | **OS & Hardware** | Hostname, OS, Kernel, Arch, Uptime, CPU (Modell/Kerne/Threads), RAM, Swap, Virtualisierung (KVM/VMware/VBox/Hyper-V/Xen/Container), Boot-Modus (BIOS/UEFI), Zeitzone |
| 2 | **Disk Layout** | lsblk: Name, Größe, Typ, Dateisystem, Mountpoint, Modell, Serial, SSD/HDD |
| 3 | **LVM** | Volume Groups (Größe, frei, PV/LV-Count), Logical Volumes (Pfad, Größe, Status) |
| 4 | **RAID** | mdadm: Device, Status, Level, Member-Disks |
| 5 | **Mounts & Speicher** | df: Device, Mountpoint, Dateisystem, Größe/Belegt/Frei/%, Inode-Auslastung |
| 6 | **Netzwerk-Interfaces** | ip addr: Name, IP, MAC, Netmask, Gateway, State, MTU, Speed, RX/TX Bytes |
| 7 | **Routing & DNS** | Routing-Tabelle, DNS-Resolver |
| 8 | **Hosts** | /etc/hosts Einträge (strukturiert) |
| 9 | **ARP-Tabelle** | ARP-Neighbor-Einträge |
| 10 | **Prozesse** | PID, PPID, User, CPU%, MEM%, VSZ, RSS, Kommando, Pfad, Args, Cgroup, Threads, FD-Count, Startzeit (max. 1000) |
| 11 | **Listening Sockets** | TCP + UDP Listener mit PID-Zuordnung |
| 12 | **Aktive Verbindungen** | ss -ntup: Aktive TCP/UDP-Verbindungen |
| 13 | **Docker Deep-Scan** | Container-Inspect mit Passwort-Maskierung, Ports, Netzwerke, Volumes, Env-Vars |
| 14 | **Webserver-Configs** | Nginx, Apache, HAProxy, Caddy Konfigurationen |
| 15 | **Systemd-Units** | Name, Typ, State, Description, ExecStart, PID, Memory, CPU |
| 16 | **Cron-Jobs** | User-Crontabs + System-Cron + Systemd-Timer |
| 17 | **SSL-Zertifikate** | File-Scan: Subject, Issuer, Gültigkeit, Serial, SAN-Domains, Ablauf-Status |
| 18 | **Benutzerkonten** | Username, UID, GID, Shell, Home, Gruppen, Login-Flag, Last-Login |
| 19 | **Firewall-Regeln** | iptables / nftables / ufw |
| 20 | **Installierte Pakete** | dpkg/rpm/pacman (optional, kann groß werden) |
| 21 | **Kernel & Sysctl** | Geladene Module (KVM, Overlay, WireGuard, ZFS u.a.), Sysctl-Highlights (ip_forward, tcp_syncookies, file_max, vm_swappiness u.a.) |
| 22 | **Sicherheitsstatus** | SELinux, AppArmor (Profile/Enforced), SSHD-Config (PermitRootLogin, PasswordAuth, Port), fail2ban (aktive Jails) |
| 23 | **Fehler-Logs** | journald (Prio 0–3, 24h), dmesg Errors, App-Logs (14 bekannte Pfade + dynamische Suche), Syslog, Auth-Errors, OOM-Killer Events |

### 🕸️ Topologie-Visualisierung

Automatische Erkennung von Server-Verbindungen mit **5 Methoden**:

- **SOCKET** – Aktive TCP/UDP-Verbindungen zwischen Servern
- **CONFIG** – Referenzen in Konfigurationsdateien (Nginx Upstream, HAProxy Backend, etc.)
- **DOCKER** – Docker-Netzwerk-Verbindungen
- **ARP** – ARP-Tabellen-Einträge
- **MANUAL** – Manuell gesetzte Verbindungen

Darstellung als interaktiver **React Flow Graph** mit Minimap, Zoom, Klick-Navigation und farbcodierten Verbindungstypen.

### 🔎 Auto-Discovery Engine

- **Multi-Subnetz-Scan** via Nmap – mehrere Netze gleichzeitig scannen
- **Entdeckte Server** – Übersicht aller gefundenen, noch nicht konfigurierten Hosts
- **Auto-Konfiguration** – SSH-Credentials für mehrere Server gleichzeitig setzen
- Optionale sofortige Scan-Auslösung und automatische Schedule-Zuweisung

### ⏰ Scheduler v2

- **Cron-basierte Scans** mit konfigurierbaren Intervallen (5 Min bis wöchentlich)
- **Stale-Scan-Erkennung** – Warnung wenn Scans zu alt werden
- **Health-Monitoring** – Überwachung der Scheduler-Gesundheit
- **Audit-Logging** – Vollständige Protokollierung aller Scheduler-Aktionen
- **Management-UI** – Inline-Bearbeitung, manuelle Auslösung, Cron-Referenz

### 📊 Differenz-Erkennung

Nach jedem Scan wird automatisch ein **SHA-256-Snapshot** erstellt und mit dem vorherigen verglichen:

- **10 Kategorien**: Services, Mounts, Docker, Systemd, Cron, SSL, Benutzer, Netzwerk, Prozesse, Server-Meta
- **Schweregrad-Klassifikation**: CRITICAL 🔴 / WARNING 🟡 / INFO 🔵
- **Änderungs-Timeline** mit Bestätigungs-Funktion
- Beispiele: Neue Benutzer (Warning), Systemd-Unit fehlgeschlagen (Critical), SSL entfernt (Critical)

### 🔔 Alarmierung

Regelbasiertes Alerting-System mit **8 Standard-Regeln**:

| Regel | Schweregrad | Auslöser |
|-------|-------------|----------|
| SSL läuft bald ab | ⚠️ WARNING | Zertifikat ≤ 30 Tage vor Ablauf |
| SSL abgelaufen | 🔴 CRITICAL | Zertifikat bereits abgelaufen |
| Disk kritisch | 🔴 CRITICAL | Festplatte ≥ 90% belegt |
| Disk hoch | ⚠️ WARNING | Festplatte ≥ 80% belegt |
| Systemd fehlgeschlagen | 🔴 CRITICAL | Unit im Zustand `failed` |
| Neuer Benutzer | ⚠️ WARNING | Unbekannter Benutzer entdeckt |
| Service entfernt | ⚠️ WARNING | Service verschwunden |
| Docker-Änderung | ℹ️ INFO | Container hinzugefügt/entfernt/geändert |

Zusätzlich: Eigene Regeln erstellen, Cooldown-Management, Bulk-Auflösung.

### 📥 Export

Multi-Format-Export für Dokumentation und Compliance:

| Format | Inhalt |
|--------|--------|
| **JSON** | Einzelner Server oder Gesamtinventar (strukturiert) |
| **CSV** | Excel-kompatibel (Semikolon + BOM), Server-Inventar, Diffs, Alerts |
| **Markdown** | Ausführliche Server-Dokumentation mit allen Modulen |

> SSH-Credentials werden **nie** exportiert.

### 👥 Benutzerverwaltung

- **3 Rollen**: Admin (Vollzugriff), Operator (Scans + KI), Viewer (nur Lesen)
- **Benutzerverwaltung** – Erstellen, Bearbeiten, Passwort-Reset, Löschen (Admin-only)
- **Profil-Seite** – Passwort ändern mit Stärke-Meter, Benutzerdaten bearbeiten
- **JWT-Authentifizierung** mit konfigurierbarer Ablaufzeit

### 🔒 Sicherheit

- **AES-256-GCM** Verschlüsselung aller SSH-Credentials in der Datenbank
- **bcrypt** (12 Runden) für Passwort-Hashing
- **JWT-Tokens** mit konfigurierbarer Laufzeit (Default: 24h)
- **CORS-Schutz** im Produktionsmodus
- **Audit-Log** für alle Benutzeraktionen

---

## 🤖 KI-Integration (optional)

SystemMAP integriert optional Large Language Models für intelligente Infrastruktur-Analyse. **Alle KI-Features sind einzeln aktivierbar** und funktionieren vollständig lokal (ohne Cloud).

### 7 unterstützte Provider

| Provider | Typ | Modelle (Beispiele) |
|----------|-----|---------------------|
| **Ollama** | 🏠 Lokal | Llama 3, Qwen 2.5, Gemma 3, Mistral, DeepSeek R1 |
| **llama.cpp** | 🏠 Lokal | Beliebige GGUF-Modelle |
| **OpenAI** | ☁️ Cloud | GPT-4o, GPT-4o-mini, GPT-3.5 Turbo |
| **Google Gemini** | ☁️ Cloud | Gemini 2.0 Flash, 1.5 Pro/Flash |
| **Anthropic Claude** | ☁️ Cloud | Claude Sonnet 4, 3.5 Sonnet, 3 Opus |
| **GitHub Copilot** | ☁️ Cloud | GPT-4o, o3-mini, DeepSeek R1, Llama 3.3 |
| **Custom** | 🔧 Beliebig | Jeder OpenAI-kompatible Endpunkt |

> 💡 **Datenschutz**: Bei lokalen Providern (Ollama, llama.cpp) verlassen **keine Daten** das eigene Netzwerk. Bei Cloud-Providern wird eine Warnung angezeigt.

### 6 KI-Features

Jedes Feature kann **einzeln** in den KI-Einstellungen aktiviert/deaktiviert werden:

| Feature | Beschreibung |
|---------|-------------|
| 📝 **Server-Zusammenfassung** | Automatische Beschreibung: Zweck, Rolle, Tags, Zusammenfassung. Ideal für Onboarding neuer Team-Mitglieder. |
| 🗺️ **Prozess-Map** | Hierarchische Baumstruktur aller Prozesse mit Konfigurationsdateien. Erkennt **30+ Service-Typen** automatisch (Apache, Nginx, Docker, PostgreSQL, Redis, MongoDB, HAProxy, Grafana, Pi-hole u.v.m.). |
| 🔍 **Anomalie-Erkennung** | Bewertet Diff-Events als normal/verdächtig/kritisch. Erstellt automatisch Alerts bei Sicherheits-Anomalien. |
| 💬 **NLP-Chat** | Freier KI-Chat über die Infrastruktur mit Server-Kontext (Docker, Services, Systemd, SSL). 6 Vorschlags-Prompts. |
| 📋 **Auto-Runbooks** | Generiert Wartungsanleitungen mit konkreten Shell-Befehlen. Deckt Sicherheit, Updates, Monitoring, Backup und Performance ab. |
| 🏥 **Log-Analyse** | Analysiert journald/dmesg/syslog/auth/OOM-Logs. Liefert **Health-Score** (0–100), Findings mit Schweregrad und Empfehlungen. |

### KI-Einstellungen UI

- Provider-Auswahl mit **Verbindungstest** und Modell-Auto-Detection
- 6 Feature-Toggles mit Beschreibungen
- Erweiterte Parameter: Max-Tokens, Temperatur (0–2), Context-Window, Timeout
- Dirty-State-Tracking mit Verwerfen-Option

---

## 🖥️ Server-Detail – 14 Tabs

Jeder Server hat eine detaillierte Ansicht mit 14 Tabs:

| Tab | Inhalt |
|-----|--------|
| **Übersicht** | OS, Kernel, CPU, RAM, Status, KI-Zusammenfassung, KI-Tags, letzter Scan |
| **Prozesse** | PID, PPID, User, CPU%, MEM%, VSZ, RSS, Kommando, Cgroup, Threads, FD-Count |
| **Services** | Port, Protokoll, Bind-Adresse, State, Version, PID |
| **Systemd** | Unit-Name, Typ, Active/Sub-State, ExecStart, PID, Memory, CPU |
| **Speicher** | Device, Mountpoint, Dateisystem, Größe/Belegt/Frei, Auslastung % |
| **Netzwerk** | Interface, IP, MAC, Netmask, Gateway, State, MTU, Speed, RX/TX |
| **Docker** | Container-ID, Name, Image, State, Ports, Networks, Env-Vars, Volumes |
| **Cron** | User, Schedule, Kommando, Quelle |
| **SSL** | Pfad, Subject, Issuer, Gültigkeit, Serial, SAN-Domains, Tage bis Ablauf |
| **Benutzer** | Username, UID, GID, Shell, Home, Gruppen, Login-Flag, Last-Login |
| **Verbindungen** | Ausgehende/eingehende Server-Connections |
| 🗺️ **Prozess-Map** | Interaktive KI-generierte Prozess-Baumstruktur |
| 📋 **Runbook** | KI-generierte Wartungsanleitung mit Prioritäten |
| 🏥 **Health & Logs** | KI-Log-Analyse mit Health-Score, Roh-Logs |

---

## 📊 Dashboard – 3 Tabs

| Tab | Inhalt |
|-----|--------|
| **Übersicht** | Server-Status (7 Zustände), Ressourcen-Grid (8 Kategorien), Job-Queue-Widget, Scheduler-Widget, letzte Scans |
| **Alerts** | SSL-Warnungen, fehlgeschlagene Systemd-Units, kritische Disk-Auslastung, Scan-Fehler |
| **Aktivität** | Chronologischer Audit-Log mit 15+ Aktionstypen |

> 🔄 Auto-Refresh alle 15 Sekunden. Alert-Banner bei kritischen Warnungen.

---

## 🏗️ Architektur

```
┌──────────────────────────────────────────────────────────────────┐
│                         Frontend                                  │
│        React 18 · Vite 5 · TailwindCSS 3 · React Flow            │
│        Port 5173 (Dev) / Nginx (Prod)                             │
│        14 Seiten · Dark-Mode · Responsive                         │
└──────────────────────────┬───────────────────────────────────────┘
                           │ REST API (/api)
┌──────────────────────────▼───────────────────────────────────────┐
│                         Backend                                   │
│        Express · Prisma ORM · BullMQ · node-cron · ssh2           │
│        Port 3001 · TypeScript · JWT Auth                          │
├───────────┬───────────┬───────────┬───────────┬─────────────────┤
│ PostgreSQL│   Redis   │  SSH →    │   Nmap    │ KI-Provider     │
│    16     │     7     │  Ziel-    │  Netzwerk │ Ollama/OpenAI/  │
│  Port     │   Port    │  server   │  Discovery│ Claude/Gemini/  │
│  5433     │   6379    │           │           │ llama.cpp/Custom│
└───────────┴───────────┴───────────┴───────────┴─────────────────┘
```

### Tech-Stack

| Schicht | Technologien |
|---------|-------------|
| **Frontend** | React 18, Vite 5, TailwindCSS 3, React Flow, Zustand, Axios |
| **Backend** | Express, TypeScript, Prisma ORM, BullMQ, node-cron, ssh2, node-fetch |
| **Datenbank** | PostgreSQL 16 (21 Modelle), Redis 7 (Job-Queue) |
| **Infrastruktur** | Docker Compose, Systemd-Service, Nginx (Prod) |
| **KI** | 7 Provider (Ollama, llama.cpp, OpenAI, Gemini, Claude, GitHub Copilot, Custom) |

### Datenbankschema – 21 Modelle

```
User · Server · Service · ConnectionEdge · Process · Mount ·
NetworkInterface · DockerContainer · AiSettings · AiAnalysis ·
ServerLogEntry · NetworkScan · CronJob · SystemdUnit ·
SslCertificate · LvmVolume · UserAccount · ScanSnapshot ·
DiffEvent · AlertRule · Alert · AuditLog
```

---

## 📋 Voraussetzungen

| Software | Version | Zweck |
|----------|---------|-------|
| **Node.js** | ≥ 18.x | Backend + Frontend |
| **Docker + Docker Compose** | ≥ 20.x | PostgreSQL & Redis |
| **Git** | ≥ 2.x | Repository klonen |
| **nmap** | ≥ 7.x | Netzwerk-Discovery (optional) |
| **Ollama** | beliebig | KI-Features (optional) |

---

## 🚀 Schnellstart (5 Minuten)

```bash
# 1. Repository klonen
git clone https://github.com/bmetallica/SystemMAP.git
cd SystemMAP

# 2. Automatische Installation
chmod +x install.sh
./install.sh
```

Das Installationsskript erledigt alles automatisch:
1. ✅ Prüft Voraussetzungen (Node.js ≥ 18, Docker, npm)
2. 🔑 Generiert sichere Schlüssel (JWT_SECRET, ENCRYPTION_MASTER_KEY)
3. 🐳 Startet PostgreSQL 16 + Redis 7 via Docker Compose
4. 📦 Installiert Backend + Frontend Dependencies
5. 🗃️ Erstellt Datenbankschema und Admin-User
6. 🚀 Startet alle Services

Nach Abschluss:

| Dienst | URL |
|--------|-----|
| **Frontend** | http://localhost:5173 |
| **Backend API** | http://localhost:3001/api |
| **Login** | `admin` / `admin1234` |

> ⚠️ **Passwort sofort nach dem ersten Login ändern!**

### Installationsskript-Befehle

```bash
./install.sh           # Erstinstallation
./install.sh start     # Services starten
./install.sh stop      # Services stoppen
./install.sh status    # Status anzeigen
```

---

## 🔧 Systemd-Service (Produktionsbetrieb)

SystemMAP kann als Systemd-Service installiert werden für automatischen Start beim Boot:

```bash
# Service installieren und aktivieren
chmod +x setup-service.sh
sudo ./setup-service.sh

# Service steuern
sudo systemctl start systemmap
sudo systemctl stop systemmap
sudo systemctl restart systemmap
sudo systemctl reload systemmap      # Backend + Worker neustarten (ohne Docker/Frontend)
sudo systemctl status systemmap

# Logs einsehen
sudo journalctl -u systemmap -f
tail -f /var/log/systemmap/*.log
```

### Service-Details

| Eigenschaft | Wert |
|-------------|------|
| **Service-Name** | `systemmap.service` |
| **Typ** | `forking` (Hintergrund-Prozess) |
| **Abhängigkeit** | `docker.service` |
| **PID-Dateien** | `/run/systemmap/systemmap-{backend,worker,frontend}.pid` |
| **Log-Dateien** | `/var/log/systemmap/{backend,worker,frontend}.log` |
| **Neustart** | Automatisch bei Fehler (10s Verzögerung, max. 5× in 5 Min.) |
| **Autostart** | ✅ Aktiviert via `systemctl enable` |

```bash
# Service deinstallieren
sudo ./setup-service.sh uninstall
```

---

## 📖 Manuelle Installation

<details>
<summary>Schritt-für-Schritt-Anleitung aufklappen</summary>

### 1. Repository klonen

```bash
git clone https://github.com/bmetallica/SystemMAP.git
cd SystemMAP
```

### 2. Umgebungsvariablen konfigurieren

```bash
cp .env.example backend/.env
```

Editiere `backend/.env` und setze sichere Werte:

```bash
# Sichere Schlüssel generieren:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → Für JWT_SECRET und ENCRYPTION_MASTER_KEY jeweils ausführen
```

| Variable | Beschreibung | Pflicht |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL-Verbindungs-URL | ✅ |
| `REDIS_HOST` | Redis-Hostname | ✅ |
| `REDIS_PORT` | Redis-Port | ✅ |
| `JWT_SECRET` | Geheimer Schlüssel für JWT-Tokens | ✅ |
| `ENCRYPTION_MASTER_KEY` | 64 Hex-Zeichen für AES-256-GCM | ✅ |
| `PORT` | Backend-Port (Default: 3001) | ❌ |
| `NMAP_PATH` | Pfad zu nmap (Default: /usr/bin/nmap) | ❌ |

### 3. Docker-Container starten

```bash
docker compose up -d
docker compose ps   # Warten bis "healthy"
```

### 4. Backend einrichten

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npx tsx prisma/seed.ts   # Admin-User erstellen
cd ..
```

### 5. Frontend einrichten

```bash
cd frontend
npm install
cd ..
```

### 6. Starten

```bash
# Terminal 1 – Backend
cd backend && npx tsx src/index.ts

# Terminal 2 – Worker (BullMQ)
cd backend && npx tsx src/workers/index.ts

# Terminal 3 – Frontend
cd frontend && npx vite --host 0.0.0.0
```

</details>

---

## ⚙️ Konfiguration

### Server hinzufügen

1. **Frontend**: Einloggen → **Server** → **+ Server hinzufügen**
2. IP-Adresse, SSH-User und Passwort/Key eingeben
3. **Scan starten** → Der Server wird automatisch inventarisiert

### Netzwerk-Discovery

1. **Discovery** → Subnetz eingeben (z.B. `192.168.1.0/24`)
2. Nmap scannt das Netz und findet erreichbare Hosts
3. Entdeckte Server können mit **Auto-Konfiguration** per Klick übernommen werden

### KI einrichten (optional)

1. **KI-Einstellungen** → Provider auswählen (z.B. Ollama)
2. API-URL eingeben (z.B. `http://localhost:11434`)
3. **Verbindung testen** → Modell auswählen
4. Gewünschte Features aktivieren
5. Speichern

**Empfehlung für lokale KI:**
```bash
# Ollama installieren (https://ollama.com)
curl -fsSL https://ollama.com/install.sh | sh

# Empfohlene Modelle
ollama pull llama3.1:8b          # Guter Allrounder (4.9 GB)
ollama pull qwen2.5-coder:7b    # Gut für Code/Config-Analyse (4.7 GB)
ollama pull gemma3:4b            # Schnell & kompakt (3.3 GB)
```

### Schedule-Management

Über die **Schedules**-Seite oder per API:

```bash
# Schedule setzen (alle 6 Stunden)
curl -X PUT http://localhost:3001/api/schedules/server/<ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"cronExpression": "0 */6 * * *"}'

# Manuellen Scan auslösen
curl -X POST http://localhost:3001/api/schedules/server/<ID>/trigger \
  -H "Authorization: Bearer <TOKEN>"
```

### Differenz-Erkennung

```bash
# Diff-Zusammenfassung aller Server
curl http://localhost:3001/api/diffs/summary \
  -H "Authorization: Bearer <TOKEN>"

# Diff-Timeline eines Servers
curl http://localhost:3001/api/diffs/server/<ID> \
  -H "Authorization: Bearer <TOKEN>"
```

### Alarmierung

```bash
# Alle offenen Alerts
curl "http://localhost:3001/api/alerts?resolved=false" \
  -H "Authorization: Bearer <TOKEN>"

# Eigene Regel erstellen
curl -X POST http://localhost:3001/api/alerts/rules \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Hohe CPU-Last",
    "description": "Alarm bei >90% CPU",
    "category": "system",
    "severity": "WARNING",
    "condition": {"type": "threshold", "metric": "cpu", "operator": "gt", "value": 90},
    "cooldownMin": 60
  }'
```

### Export

```bash
# Einzel-Server als Markdown
curl -O http://localhost:3001/api/export/server/<ID>/markdown \
  -H "Authorization: Bearer <TOKEN>"

# Gesamtinventar als CSV
curl -O http://localhost:3001/api/export/all/csv \
  -H "Authorization: Bearer <TOKEN>"

# Alerts als CSV
curl -O http://localhost:3001/api/export/alerts/csv \
  -H "Authorization: Bearer <TOKEN>"
```

> 💡 CSV-Dateien verwenden Semikolon als Trennzeichen und enthalten BOM für korrekte Excel-Darstellung.

---

## 📡 API-Referenz

Alle Endpunkte erfordern einen JWT-Token (`Authorization: Bearer <TOKEN>`), außer Login/Register.

<details>
<summary>Vollständige API-Endpunkte aufklappen (70+ Routen)</summary>

### Authentifizierung

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| POST | `/api/auth/register` | Benutzer registrieren |
| POST | `/api/auth/login` | Anmelden (`login` + `password`) |

### Dashboard

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/dashboard` | Dashboard (Server, Ressourcen, Alerts, Queues, Scheduler) |

### Server

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/servers` | Alle Server auflisten |
| POST | `/api/servers` | Server hinzufügen |
| GET | `/api/servers/:id` | Server-Details (alle Relationen) |
| PUT | `/api/servers/:id` | Server aktualisieren |
| DELETE | `/api/servers/:id` | Server löschen |
| POST | `/api/servers/:id/scan` | Manuellen Scan starten |

### Schedules

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/schedules` | Alle Schedules + Statistiken |
| PUT | `/api/schedules/server/:id` | Cron-Schedule setzen/ändern |
| DELETE | `/api/schedules/server/:id` | Schedule entfernen |
| POST | `/api/schedules/server/:id/trigger` | Manuellen Scan auslösen |
| GET | `/api/schedules/stats` | Scheduler-Statistiken |

### Discovery

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| POST | `/api/scans/network` | Netzwerkscan starten |
| POST | `/api/discovery/multi-scan` | Multi-Subnetz-Scan |
| GET | `/api/discovery/discovered` | Entdeckte Server |
| POST | `/api/discovery/auto-configure` | Auto-Konfiguration |
| GET | `/api/discovery/summary` | Discovery-Zusammenfassung |
| DELETE | `/api/discovery/purge-discovered` | Entdeckte Server löschen |

### Topologie

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/topology` | Topologie-Daten für Graph |

### Differenz-Erkennung

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/diffs/summary` | Diff-Zusammenfassung |
| GET | `/api/diffs/recent` | Letzte Änderungen |
| GET | `/api/diffs/server/:id` | Diff-Timeline eines Servers |
| GET | `/api/diffs/server/:id/summary` | Diff-Zusammenfassung eines Servers |
| GET | `/api/diffs/server/:id/snapshots` | Snapshots eines Servers |
| GET | `/api/diffs/snapshot/:id` | Einzelnen Snapshot abrufen |
| PUT | `/api/diffs/:id/acknowledge` | Diff bestätigen |
| PUT | `/api/diffs/server/:id/acknowledge-all` | Alle Diffs bestätigen |

### Alarmierung

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/alerts` | Alerts (Filter: severity, resolved, serverId) |
| GET | `/api/alerts/summary` | Alert-Zusammenfassung |
| PUT | `/api/alerts/:id/resolve` | Alert auflösen |
| PUT | `/api/alerts/resolve-all` | Alle Alerts auflösen |
| DELETE | `/api/alerts/:id` | Alert löschen |
| GET | `/api/alerts/rules` | Alle Regeln |
| POST | `/api/alerts/rules` | Neue Regel erstellen |
| PUT | `/api/alerts/rules/:id` | Regel aktualisieren |
| DELETE | `/api/alerts/rules/:id` | Regel löschen |
| PUT | `/api/alerts/rules/:id/toggle` | Regel aktivieren/deaktivieren |

### KI / AI

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/ai/health` | KI Health-Check + aktivierte Features |
| POST | `/api/ai/chat` | Freier KI-Chat |
| POST | `/api/ai/chat/json` | KI-Chat mit JSON-Format |
| POST | `/api/ai/summary/:id` | Server-Zusammenfassung generieren |
| DELETE | `/api/ai/summary/:id` | Zusammenfassung löschen |
| POST | `/api/ai/process-map/:id` | Prozess-Map starten (queued) |
| GET | `/api/ai/process-map/:id` | Prozess-Map abrufen |
| GET | `/api/ai/process-map/:id/status` | Generierungsstatus |
| DELETE | `/api/ai/process-map/:id` | Prozess-Map löschen |
| GET | `/api/ai/anomaly/:id` | Anomalie-Bericht |
| POST | `/api/ai/anomaly/:id` | Anomalie-Analyse starten |
| POST | `/api/ai/runbook/:id` | Runbook generieren |
| GET | `/api/ai/runbook/:id` | Runbook abrufen |
| POST | `/api/ai/log-analysis/:id` | Log-Analyse starten |
| GET | `/api/ai/log-analysis/:id` | Log-Analyse abrufen |
| GET | `/api/ai/logs/:id` | Roh-Log-Daten |

### KI-Einstellungen

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/ai-settings` | Aktuelle Einstellungen |
| PUT | `/api/ai-settings` | Einstellungen aktualisieren |
| POST | `/api/ai-settings/test` | Verbindungstest |
| GET | `/api/ai-settings/models` | Verfügbare Modelle laden |
| POST | `/api/ai-settings/reset` | Auf Defaults zurücksetzen |

### Export

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/api/export/server/:id/json` | Server als JSON |
| GET | `/api/export/server/:id/csv` | Server als CSV |
| GET | `/api/export/server/:id/markdown` | Server als Markdown |
| GET | `/api/export/all/json` | Alle Server als JSON |
| GET | `/api/export/all/csv` | Alle Server als CSV |
| GET | `/api/export/diffs/csv` | Diffs als CSV |
| GET | `/api/export/alerts/csv` | Alerts als CSV |

</details>

---

## 📁 Projektstruktur

```
SystemMAP/
├── .env.example              # Umgebungsvariablen-Template
├── docker-compose.yml        # PostgreSQL 16 + Redis 7
├── install.sh                # Automatisches Installationsskript
├── setup-service.sh          # Systemd-Service Installer
├── systemmap.service         # Systemd-Unit-Datei
├── systemmap-ctl.sh          # Prozess-Steuerung (start/stop/reload/status)
│
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma     # Datenbankschema (21 Modelle)
│   │   └── seed.ts           # Initial-Admin-User
│   └── src/
│       ├── index.ts           # Express-Server
│       ├── config.ts          # Konfiguration aus .env
│       ├── logger.ts          # Winston-Logger
│       ├── routes/            # 12 Route-Module (70+ Endpunkte)
│       ├── services/
│       │   ├── ai/            # KI-Service (7 Provider, 6 Features)
│       │   │   ├── index.ts   # AiService Singleton
│       │   │   ├── types.ts   # TypeScript-Typen
│       │   │   └── ollama.provider.ts
│       │   ├── gather-script.ts     # 23-Modul Bash-Script-Generator
│       │   ├── scan-mapper.service.ts
│       │   ├── scheduler.service.ts # Scheduler v2
│       │   ├── ssh.service.ts
│       │   ├── topology.service.ts
│       │   ├── diff.service.ts      # Snapshot-Vergleich (SHA-256)
│       │   ├── alert.service.ts     # 8 Standard-Regeln
│       │   ├── crypto.service.ts    # AES-256-GCM
│       │   └── auth.service.ts
│       ├── workers/           # BullMQ Job-Worker
│       └── middleware/        # JWT-Auth-Middleware
│
└── frontend/
    └── src/
        ├── App.tsx
        ├── pages/             # 14 Seiten
        │   ├── Dashboard.tsx       # Dashboard (3 Tabs, 7+ Widgets)
        │   ├── Servers.tsx         # Server-Liste
        │   ├── ServerDetail.tsx    # Server-Detail (14 Tabs)
        │   ├── Discovery.tsx       # Auto-Discovery + Multi-Scan
        │   ├── Schedules.tsx       # Schedule-Management
        │   ├── Topology.tsx        # Netzwerk-Graph (React Flow)
        │   ├── Alerts.tsx          # Alert-Management + Regeln
        │   ├── DiffHistory.tsx     # Änderungs-Timeline
        │   ├── ExportPage.tsx      # Export-Hub (JSON/CSV/Markdown)
        │   ├── AiChat.tsx          # KI-Chat mit Server-Kontext
        │   ├── AiSettings.tsx      # KI-Einstellungen (7 Provider)
        │   ├── UserManagement.tsx  # Benutzerverwaltung (Admin)
        │   ├── Profile.tsx         # Profil + Passwort-Änderung
        │   └── Login.tsx
        ├── components/
        │   ├── Layout.tsx          # Sidebar-Navigation (11 Menüpunkte)
        │   └── ProcessMap.tsx      # Prozess-Baum-Visualisierung
        ├── api/client.ts      # Axios-Client
        └── store/             # Zustand State-Management
```

---

## 🗺️ Roadmap

- [x] **Etappe 1** – Basis-Plattform (Backend, Frontend, DB, SSH-Scan)
- [x] **Etappe 2** – Deep-Dive Datensammlung (23 Module, robuster SSH, erweiterter Mapper)
- [x] **Etappe 3** – Scheduling, Auto-Discovery, Dashboard-Erweiterung
- [x] **Etappe 4** – Differenz-Erkennung, Alarmierung, Export, Systemd-Service
- [x] **Etappe 5** – KI-Integration (7 Provider, 6 Features, Log-Analyse)
- [ ] **Etappe 6** – Geplant: Notifications (E-Mail/Webhook), RBAC-Erweiterung, Multi-Tenant

---

## 🔒 Sicherheitshinweise

| Mechanismus | Details |
|-------------|---------|
| **SSH-Credentials** | AES-256-GCM verschlüsselt in der DB, nie im Export enthalten |
| **Passwörter** | bcrypt (12 Runden) |
| **JWT-Tokens** | Konfigurierbare Laufzeit (Default: 24h) |
| **Master-Key** | `ENCRYPTION_MASTER_KEY` – sicher aufbewahren, niemals committen! |
| **CORS** | Im Development auf localhost beschränkt |
| **Audit-Log** | Vollständige Protokollierung aller Aktionen |

> ⚠️ **Produktions-Checkliste:**
> - [ ] `JWT_SECRET` durch sicheren Zufallswert ersetzen
> - [ ] `ENCRYPTION_MASTER_KEY` durch sicheren Zufallswert ersetzen
> - [ ] Standard-Passwort `admin1234` ändern
> - [ ] Firewall: Ports 3001/5173 nur intern erreichbar machen
> - [ ] HTTPS-Proxy (Nginx/Caddy) vor das Frontend schalten

---

## 🤝 Contributing

Beiträge sind willkommen! Bitte erstelle einen Fork und öffne einen Pull Request.

```bash
# Development-Setup
git clone https://github.com/bmetallica/SystemMAP.git
cd SystemMAP
./install.sh

# Backend (Hot-Reload)
cd backend && npx tsx src/index.ts

# Frontend (Hot-Reload)
cd frontend && npx vite --host 0.0.0.0
```

---

## 📝 Lizenz

MIT License – siehe [LICENSE](LICENSE)

---

<p align="center">
  <b>SystemMAP</b> – Deine Linux-Infrastruktur auf einen Blick 🗺️
</p>
