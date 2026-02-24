// ─── KI-Service Typen ─────────────────────────────────────────────────────
// Phase 5.3: Gemeinsame Typen für alle Provider und den AI-Service

// ── Request/Response ──────────────────────────────────────────────────────

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatOptions {
  /** Überschreibt das konfigurierte Modell */
  model?: string;
  /** Temperatur (0 = deterministisch, 2 = kreativ) */
  temperature?: number;
  /** Maximale Ausgabe-Tokens */
  maxTokens?: number;
  /** Timeout in Millisekunden */
  timeoutMs?: number;
  /** Kontext-Fenster (Anzahl Tokens die das Modell verarbeiten kann) */
  contextWindow?: number;
  /** JSON-Modus erzwingen */
  jsonMode?: boolean;
  /** System-Prompt (wird als erste Message eingefügt) */
  systemPrompt?: string;
  /** Interner Aufruf – umgeht den Blocking-Check (nur für Worker) */
  _internal?: boolean;
}

export interface AiChatResponse {
  content: string;
  model: string;
  provider: string;
  /** Token-Nutzung (falls vom Provider geliefert) */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  /** Antwortzeit in ms */
  durationMs: number;
  /** Rohes Provider-Ergebnis für Debugging */
  raw?: any;
}

// ── Provider-Interface ────────────────────────────────────────────────────

export interface AiProvider {
  /** Eindeutiger Provider-Name */
  readonly name: string;

  /** Sendet einen Chat-Request an den Provider */
  chat(
    messages: AiChatMessage[],
    options: AiChatOptions,
    apiUrl: string,
    apiKey: string,
    model: string,
  ): Promise<AiChatResponse>;
}

// ── Feature-Keys ──────────────────────────────────────────────────────────

export type AiFeature =
  | 'enableSummary'
  | 'enableProcessMap'
  | 'enableAnomaly'
  | 'enableNlp'
  | 'enableRunbooks'
  | 'enableLogAnalysis';

// ── Bekannte Dienste (aus ansatz2/zusatz.py) ──────────────────────────────

export interface KnownServiceCommand {
  serviceType: string;
  label: string;
  command: string;
}

export const KNOWN_COMMANDS: Record<string, KnownServiceCommand> = {
  apache2:          { serviceType: 'Webserver',           label: 'VHosts, Module, Ports',        command: "apache2ctl -S 2>&1 | head -30 ; echo '---MODULES---' ; apache2ctl -M 2>&1 | grep -v 'Loaded Modules' | head -30 ; echo '---PORTS---' ; ss -tlnp | grep apache2 ; echo '---SITES---' ; ls -la /etc/apache2/sites-enabled/ 2>/dev/null ; echo '---INCLUDES---' ; grep -rh 'IncludeOptional\\|Include ' /etc/apache2/apache2.conf 2>/dev/null" },
  apcupsd:          { serviceType: 'USV-Management',      label: 'USV-Status, Batterie',         command: 'apcaccess status 2>&1' },
  containerd:       { serviceType: 'Container-Runtime',   label: 'Container, Version',           command: "ctr --namespace moby containers list 2>&1 ; echo '---' ; containerd --version 2>&1" },
  'containerd-shim':{ serviceType: 'Container-Shim',      label: 'Shim-Prozesse',                command: 'ps -C containerd-shim -o pid,ppid,vsz,rss,etime,args' },
  dockerd:          { serviceType: 'Docker-Daemon',        label: 'Container, Images, Netzwerke', command: "docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}' 2>&1 ; echo '---' ; docker images --format 'table {{.Repository}}\\t{{.Tag}}\\t{{.Size}}' 2>&1 ; echo '---' ; docker network ls 2>&1" },
  'docker-proxy':   { serviceType: 'Docker-Port-Proxy',   label: 'Portmappings',                 command: 'ss -tlnp | grep docker-proxy ; echo \'---\' ; ps -C docker-proxy -o pid,args' },
  postgres:         { serviceType: 'PostgreSQL',           label: 'Datenbanken, Verbindungen',    command: "sudo -u postgres psql -c '\\l' 2>&1 ; echo '---' ; sudo -u postgres psql -c 'SHOW port; SHOW listen_addresses; SHOW max_connections; SHOW data_directory;' 2>&1 ; echo '---' ; ss -tlnp | grep postgres" },
  squid:            { serviceType: 'Proxy-Server',         label: 'Cache, Ports, ACLs',           command: "grep -vE '^\\s*(#|$)' /etc/squid/squid.conf 2>/dev/null | head -40 ; echo '---' ; squid -k parse 2>&1 | head -30 ; echo '---' ; ss -tlnp | grep squid" },
  sshd:             { serviceType: 'SSH-Server',           label: 'Sessions, Config, Version',    command: "who 2>&1 ; echo '---CONFIG---' ; sshd -T 2>&1 | grep -iE '^(port |listenaddress |permitroot|passwordauth|maxauthtries|pubkeyauth|x11forwarding|allowusers|allowgroups|subsystem)' ; echo '---PORTS---' ; ss -tlnp | grep sshd ; echo '---' ; ssh -V 2>&1" },
  snmpd:            { serviceType: 'SNMP-Agent',           label: 'Version, Ports',               command: "snmpd -v 2>&1 | head -2 ; echo '---' ; ss -ulnp | grep snmpd" },
  homegear:         { serviceType: 'Smart-Home-Zentrale',  label: 'Version, Familien, Ports',     command: "homegear -v 2>&1 ; echo '---' ; ss -tlnp | grep homegear" },
  'homegear-manage':{ serviceType: 'Homegear-Management', label: 'Prozess-Info',                 command: 'ps -C homegear-manage -o pid,vsz,rss,etime,cmd' },
  node:             { serviceType: 'Node.js',              label: 'Version, Ports, Prozesse',     command: "node --version 2>&1 ; echo '---' ; ss -tlnp | grep node ; echo '---' ; ps -C node -o pid,vsz,rss,etime,args" },
  iperf3:           { serviceType: 'Netzwerk-Benchmark',   label: 'Version, Ports',               command: "iperf3 --version 2>&1 | head -1 ; echo '---' ; ss -tlnp | grep iperf3" },
  'qemu-ga':        { serviceType: 'QEMU-Guest-Agent',    label: 'Version, Virtio',              command: "qemu-ga --version 2>&1 ; echo '---' ; ls -la /dev/virtio-ports/ 2>&1" },
  geoclue:          { serviceType: 'Geolocation',          label: 'Prozess-Info',                 command: 'ps -C geoclue -o pid,vsz,rss,etime,cmd' },
  deCONZ:           { serviceType: 'Zigbee-Gateway',       label: 'API, Ports, Prozess',          command: "ss -tlnp | grep deCONZ ; echo '---' ; ps -C deCONZ -o pid,vsz,rss,etime,args" },
  fusermount3:      { serviceType: 'FUSE-Mount',           label: 'Aktive FUSE-Mounts',           command: "mount | grep fuse ; echo '---' ; fusermount3 --version 2>&1" },
  pinger:           { serviceType: 'Pinger-Dienst',        label: 'Ports, Prozess',               command: "ss -tlnp | grep pinger ; echo '---' ; ps -C pinger -o pid,vsz,rss,etime,args" },
  log_file_daemon:  { serviceType: 'Log-Daemon',           label: 'Prozess-Info',                 command: "ps -C log_file_daemon -o pid,vsz,rss,etime,args ; echo '---' ; ss -tlnp | grep log_file" },
  nginx:            { serviceType: 'Webserver',            label: 'VHosts, Module',               command: "nginx -T 2>&1 | head -120 ; echo '---PORTS---' ; ss -tlnp | grep nginx ; echo '---SITES---' ; ls -la /etc/nginx/sites-enabled/ 2>/dev/null ; ls -la /etc/nginx/conf.d/ 2>/dev/null" },
  mysql:            { serviceType: 'MySQL/MariaDB',        label: 'Datenbanken, Status',          command: "mysql -e 'SHOW DATABASES; SHOW GLOBAL STATUS LIKE \"Threads%\"; SHOW GLOBAL STATUS LIKE \"Connections\";' 2>&1" },
  redis:            { serviceType: 'Redis',                label: 'Info, Clients',                command: "redis-cli INFO server 2>&1 | head -20 ; echo '---' ; redis-cli INFO clients 2>&1" },
  mongod:           { serviceType: 'MongoDB',              label: 'Datenbanken, Status',          command: "mongosh --eval 'db.adminCommand({listDatabases:1})' 2>&1 | head -30" },
  haproxy:          { serviceType: 'Load-Balancer',        label: 'Stats, Backends',              command: "haproxy -c -f /etc/haproxy/haproxy.cfg 2>&1 ; echo '---' ; ss -tlnp | grep haproxy" },
  'systemd-udevd':  { serviceType: 'Udev-Daemon',         label: 'Udev-Regeln, Geräte',          command: "udevadm info --version 2>&1 ; echo '---' ; udevadm trigger --dry-run 2>&1 | wc -l" },
  influxd:          { serviceType: 'Zeitreihen-DB',        label: 'Datenbanken, Version',         command: "influx -version 2>&1 || influxd version 2>&1 ; echo '---' ; ss -tlnp | grep influx" },
  mosquitto:        { serviceType: 'MQTT-Broker',          label: 'Version, Ports, Listener',     command: "mosquitto -h 2>&1 | head -1 ; echo '---' ; ss -tlnp | grep mosquitto" },
  'grafana-server': { serviceType: 'Monitoring-Dashboard', label: 'Version, Ports',               command: "grafana-server -v 2>&1 ; echo '---' ; ss -tlnp | grep grafana" },
  'node-red':       { serviceType: 'IoT-Automation',       label: 'Version, Flows',               command: "ss -tlnp | grep node-red ; echo '---' ; ps -C node-red -o pid,vsz,rss,etime,args" },
  'pihole-FTL':     { serviceType: 'DNS-Filter',           label: 'Version, Stats',               command: "pihole version 2>&1 ; echo '---' ; pihole -c -e 2>&1 | head -10" },
  rsyslogd:         { serviceType: 'Log-Manager',          label: 'Module, Version',              command: "rsyslogd -v 2>&1 | head -5 ; echo '---' ; ss -tlnp | grep rsyslog" },
  cron:             { serviceType: 'Scheduler',            label: 'Crontabs',                     command: "for u in $(cut -d: -f1 /etc/passwd); do c=$(crontab -l -u \\$u 2>/dev/null | grep -v '^#' | grep -v '^$'); [ -n \"\\$c\" ] && echo \"=== \\$u ===\"$'\\n'\"\\$c\"; done ; echo '---' ; ls -la /etc/cron.d/ 2>&1" },
  'avahi-daemon':   { serviceType: 'mDNS/DNS-SD',         label: 'Version, Dienste',             command: "avahi-daemon --version 2>&1 ; echo '---' ; avahi-browse -at 2>&1 | head -20" },
  'dbus-daemon':    { serviceType: 'System-Message-Bus',   label: 'Version, Services',            command: "dbus-daemon --version 2>&1 | head -1 ; echo '---' ; busctl list --no-pager 2>&1 | head -30" },
};

// ── Server-Zusammenfassung (Phase 5.4) ────────────────────────────────────

export interface ServerSummaryResult {
  purpose: string;    // Einzeilige Zweckbeschreibung (z.B. "Docker-Host für Homeautomation")
  role: string;       // Primäre Funktion (z.B. "application-server")
  tags: string[];     // KI-generierte Tags ["docker", "homeautomation", "zigbee"]
  summary: string;    // Ausführlichere Zusammenfassung (3-5 Sätze)
}

// ── Prozessmap (Phase 5.5) ────────────────────────────────────────────────

/** Ein Knoten im Prozessbaum */
export interface ProcessTreeNode {
  name: string;
  type: string;       // "category" | "port" | "path" | "config" | "connection" | "volume" | "parameter" | "user" | "cron" | "module"
  value?: string;
  children?: ProcessTreeNode[];
}

/** Ergebnis der Baumstruktur-Generierung für einen einzelnen Prozess */
export interface ProcessTreeResult {
  process: string;
  executable: string;
  service_type: string;
  description: string;
  children: ProcessTreeNode[];
  /** Angereicherte Felder aus DB (vom Worker hinzugefügt) */
  ports?: number[];
  cpu?: number;
  memory?: number;
  user?: string;
  pid?: number;
}

/** Config-Discovery Ergebnis von einem Prozess */
export interface ProcessConfigData {
  pid: number;
  executable: string;
  files: Array<{
    path: string;
    size: number;
    content_b64: string;
  }>;
}

/** Config-Auswahl durch das LLM */
export interface ConfigSelectionResult {
  selected: string[];   // Ausgewählte Config-Pfade
  reason: string;       // Begründung
}

// ── Anomalie-Erkennung (Phase 5.6) ────────────────────────────────────────

/** Ein einzelnes KI-bewertetes Anomalie-Finding */
export interface AnomalyFinding {
  /** Beschreibung der Änderung */
  event: string;
  /** KI-Bewertung */
  assessment: 'normal' | 'suspicious' | 'critical';
  /** Begründung der Bewertung */
  reason: string;
  /** Empfohlene Maßnahme */
  recommendation: string;
  /** Referenz auf die betroffene Diff-Kategorie */
  category?: string;
  /** Referenz auf den betroffenen itemKey */
  itemKey?: string;
}

/** Gesamt-Ergebnis der Anomalie-Analyse */
export interface AnomalyResult {
  /** Gesamtrisiko-Bewertung */
  overall_risk: 'low' | 'medium' | 'high' | 'critical';
  /** Einzelne Findings */
  findings: AnomalyFinding[];
  /** Zusammenfassung (optional, vom LLM) */
  summary?: string;
}

// ── Runbook-Generierung (Phase 5.7) ───────────────────────────────────────

/** Ein Abschnitt eines Auto-Runbooks */
export interface RunbookSection {
  /** Überschrift des Abschnitts */
  title: string;
  /** Priorität: routine | important | critical */
  priority: 'routine' | 'important' | 'critical';
  /** Beschreibung / Begründung */
  description: string;
  /** Einzelne Schritte als Markdown */
  steps: string[];
  /** Betroffene Services/Dienste */
  affectedServices?: string[];
}

/** Gesamt-Ergebnis der Runbook-Generierung */
export interface RunbookResult {
  /** Titel des Runbooks */
  title: string;
  /** Zusammenfassung */
  summary: string;
  /** Abschnitte geordnet nach Priorität */
  sections: RunbookSection[];
  /** Generiertes Datum */
  generatedAt: string;
}

/** Fortschritts-Schritte für den Process-Map Worker */
export enum ProcessMapStep {
  GATHERING_CONFIGS = 'gathering_configs',
  PREPARING_MARKDOWN = 'preparing_markdown',
  DISCOVERY_COMMANDS = 'discovery_commands',
  CONFIG_SELECTION = 'config_selection',
  TREE_GENERATION = 'tree_generation',
  SAVING_RESULTS = 'saving_results',
}

// ── Log-Analyse (Phase 5.8) ──────────────────────────────────────────────

/** Einzelner Befund der KI-Log-Analyse */
export interface LogAnalysisFinding {
  /** Zusammenfassung des Problems */
  issue: string;
  /** Schweregrad */
  severity: 'info' | 'warning' | 'error' | 'critical';
  /** Betroffene Quelle (journald, dmesg, nginx, etc.) */
  source: string;
  /** Handlungsempfehlung */
  recommendation: string;
}

/** Gesamt-Ergebnis der KI-Log-Analyse */
export interface LogAnalysisResult {
  /** Status-Score: 0-100 (100 = gesund, 0 = kritisch) */
  status_score: number;
  /** Gesamt-Status: healthy | degraded | critical */
  status: 'healthy' | 'degraded' | 'critical';
  /** Zusammenfassung (3-5 Aufzählungspunkte) */
  summary: string[];
  /** Einzelne Befunde */
  findings: LogAnalysisFinding[];
  /** Generiertes Datum */
  analyzedAt: string;
}
