// ─── KI-Service ───────────────────────────────────────────────────────────
// Phase 5.3: Universeller AI-Service – abstrahiert alle Provider
// Phase 5.6: Anomalie-Erkennung (evaluateAnomalies)
//
// Verwendung:
//   const ai = AiService.getInstance();
//   const resp = await ai.chat('Was macht dieser Server?');
//   const json = await ai.chatJson<MyType>('Analysiere...', myPrompt);
//   const ok = await ai.isAvailable();
//   const blocked = await ai.isBlocked();

import { PrismaClient } from '@prisma/client';
import { logger } from '../../logger';
import {
  AiProvider,
  AiChatMessage,
  AiChatOptions,
  AiChatResponse,
  AiFeature,
  AnomalyResult,
  AnomalyFinding,
  ServerSummaryResult,
  ProcessTreeResult,
  ProcessConfigData,
  ConfigSelectionResult,
  RunbookResult,
  LogAnalysisResult,
  LogAnalysisFinding,
  KNOWN_COMMANDS,
} from './types';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import { OllamaProvider } from './ollama.provider';
import { ClaudeProvider } from './claude.provider';

// Re-exportiere Typen für einfachen Import
export type { AiChatMessage, AiChatOptions, AiChatResponse, AiFeature, ServerSummaryResult, ProcessTreeResult, ProcessConfigData, ConfigSelectionResult, RunbookResult, RunbookSection, LogAnalysisResult, LogAnalysisFinding } from './types';
export { KNOWN_COMMANDS, ProcessMapStep } from './types';
export type { KnownServiceCommand } from './types';

const prisma = new PrismaClient();

// ─── Provider-Registry ────────────────────────────────────────────────────

const PROVIDERS: Record<string, AiProvider> = {
  llamacpp: new OpenAiCompatibleProvider('llamacpp'),
  openai:   new OpenAiCompatibleProvider('openai'),
  gemini:   new OpenAiCompatibleProvider('gemini'),
  copilot:  new OpenAiCompatibleProvider('copilot'),
  custom:   new OpenAiCompatibleProvider('custom'),
  ollama:   new OllamaProvider(),
  claude:   new ClaudeProvider(),
};

// Lokale Provider, bei denen Blocking relevant ist
const LOCAL_PROVIDERS = new Set(['llamacpp', 'ollama']);

// ─── AiService ────────────────────────────────────────────────────────────

export class AiService {
  private static instance: AiService;

  private constructor() {}

  static getInstance(): AiService {
    if (!AiService.instance) {
      AiService.instance = new AiService();
    }
    return AiService.instance;
  }

  // ── Settings ──────────────────────────────────────────────────────────

  /** Lädt die AiSettings (Singleton, Auto-Create) */
  async getSettings() {
    let settings = await prisma.aiSettings.findUnique({ where: { id: 1 } });
    if (!settings) {
      settings = await prisma.aiSettings.create({ data: { id: 1 } });
    }
    return settings;
  }

  /** Prüft ob eine bestimmte KI-Funktion aktiviert ist */
  async isFeatureEnabled(feature: AiFeature): Promise<boolean> {
    const settings = await this.getSettings();
    if (settings.provider === 'disabled') return false;
    return (settings as any)[feature] === true;
  }

  /** Prüft ob der Provider konfiguriert und erreichbar ist */
  async isAvailable(): Promise<boolean> {
    const settings = await this.getSettings();
    if (settings.provider === 'disabled') return false;
    if (!settings.apiUrl) return false;
    return true;
  }

  /** Prüft ob KI-Funktionen gerade blockiert sind (lokaler Provider + Map-Scan) */
  async isBlocked(): Promise<boolean> {
    const settings = await this.getSettings();
    return settings.processMapRunning && LOCAL_PROVIDERS.has(settings.provider);
  }

  /** Gibt den aktiven Provider zurück */
  private getProvider(providerName: string): AiProvider {
    const provider = PROVIDERS[providerName];
    if (!provider) {
      throw new Error(`Unbekannter Provider: ${providerName}`);
    }
    return provider;
  }

  // ── Blocking / Lock-Mechanismus ───────────────────────────────────────

  /**
   * Erwirbt den exklusiven Lock für einen KI-Prozessmap-Scan.
   * Nur ein Scan kann gleichzeitig laufen (bei lokalen Providern).
   * Stale Locks (> 45 min) werden automatisch aufgeräumt.
   */
  async acquireLock(serverId: string): Promise<boolean> {
    const settings = await this.getSettings();

    // Bei externen Providern kein Locking nötig
    if (!LOCAL_PROVIDERS.has(settings.provider)) {
      await prisma.aiSettings.update({
        where: { id: 1 },
        data: { processMapRunning: true, processMapServerId: serverId },
      });
      return true;
    }

    // Bei lokalen Providern: prüfen ob schon ein Scan läuft
    if (settings.processMapRunning) {
      // Stale-Lock-Schutz: Wenn der Lock älter als 45 Minuten ist, gilt er als abgelaufen
      const STALE_LOCK_MS = 45 * 60 * 1000; // 45 Minuten
      const lockAge = Date.now() - settings.updatedAt.getTime();
      if (lockAge > STALE_LOCK_MS) {
        logger.warn(`⚠️ Stale Lock erkannt (${Math.round(lockAge / 60000)} min alt) – wird aufgeräumt`);
        // Lock aufräumen und neu erwerben
      } else {
        logger.warn(`Lock-Anfrage abgelehnt: Map-Scan läuft bereits seit ${Math.round(lockAge / 60000)} min (Server ${settings.processMapServerId})`);
        return false;
      }
    }

    await prisma.aiSettings.update({
      where: { id: 1 },
      data: { processMapRunning: true, processMapServerId: serverId },
    });
    logger.info(`KI-Lock erworben für Server ${serverId}`);
    return true;
  }

  /** Gibt den KI-Lock frei */
  async releaseLock(): Promise<void> {
    await prisma.aiSettings.update({
      where: { id: 1 },
      data: { processMapRunning: false, processMapServerId: null },
    });
    logger.info('KI-Lock freigegeben');
  }

  // ── Chat-Funktionen ───────────────────────────────────────────────────

  /**
   * Sendet eine einfache Chat-Anfrage (String-Prompt → String-Antwort).
   * Baut automatisch die Messages auf mit optionalem System-Prompt.
   */
  async chat(prompt: string, options?: AiChatOptions): Promise<AiChatResponse> {
    const settings = await this.getSettings();

    if (settings.provider === 'disabled') {
      throw new Error('KI ist deaktiviert. Bitte Provider in den Einstellungen konfigurieren.');
    }

    // Blocking-Check für lokale Provider (umgehen bei internen Worker-Aufrufen)
    if (!options?._internal && await this.isBlocked()) {
      throw new Error('KI-Funktionen sind vorübergehend blockiert (Prozessmap-Scan läuft).');
    }

    const messages: AiChatMessage[] = [];

    // System-Prompt
    if (options?.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }

    // User-Prompt
    messages.push({ role: 'user', content: prompt });

    return this.chatMessages(messages, options);
  }

  /**
   * Sendet eine Chat-Anfrage mit vollständigen Messages.
   * Für Multi-Turn-Konversationen oder komplexe Prompt-Strukturen.
   */
  async chatMessages(messages: AiChatMessage[], options?: AiChatOptions): Promise<AiChatResponse> {
    const settings = await this.getSettings();

    if (settings.provider === 'disabled') {
      throw new Error('KI ist deaktiviert.');
    }

    if (!options?._internal && await this.isBlocked()) {
      throw new Error('KI-Funktionen sind vorübergehend blockiert (Prozessmap-Scan läuft).');
    }

    const provider = this.getProvider(settings.provider);

    // Optionen mit Settings-Defaults zusammenführen
    const mergedOptions: AiChatOptions = {
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      timeoutMs: settings.timeout * 1000,
      contextWindow: settings.contextWindow,
      ...options,
    };

    const response = await provider.chat(
      messages,
      mergedOptions,
      settings.apiUrl,
      settings.apiKey,
      settings.model,
    );

    return response;
  }

  /**
   * Chat mit automatischer JSON-Antwort-Extraktion.
   * Setzt JSON-Modus und parst die Antwort automatisch.
   * Bei Parse-Fehler: ein Retry mit expliziter Aufforderung.
   */
  async chatJson<T = any>(prompt: string, options?: AiChatOptions): Promise<{ data: T; response: AiChatResponse }> {
    const settings = await this.getSettings();

    const jsonOptions: AiChatOptions = {
      ...options,
      jsonMode: true,
      systemPrompt: options?.systemPrompt || 'Du bist ein System-Experte. Antworte NUR mit validem JSON.',
    };

    // Claude unterstützt keinen json_mode → Instruktion im Prompt
    if (settings.provider === 'claude') {
      jsonOptions.jsonMode = false;
    }

    const response = await this.chat(prompt, jsonOptions);

    // JSON aus der Antwort extrahieren
    const parsed = this.extractJson<T>(response.content);
    if (parsed !== null) {
      return { data: parsed, response };
    }

    // Retry: explizite JSON-Aufforderung
    logger.warn('Erste JSON-Antwort konnte nicht geparst werden, Retry...');
    const retryResponse = await this.chat(
      `Deine vorherige Antwort war kein valides JSON. Bitte antworte NUR mit validem JSON (keine Erklärung, kein Markdown).\n\nUrsprüngliche Aufgabe:\n${prompt}`,
      jsonOptions,
    );

    const retryParsed = this.extractJson<T>(retryResponse.content);
    if (retryParsed !== null) {
      return { data: retryParsed, response: retryResponse };
    }

    throw new Error(
      `KI-Antwort konnte nicht als JSON geparst werden.\n` +
      `Antwort (gekürzt): ${retryResponse.content.substring(0, 200)}`
    );
  }

  // ── Server-Zusammenfassung (Phase 5.4) ─────────────────────────────────

  /**
   * Generiert eine KI-Zusammenfassung für einen Server basierend auf Scan-Daten.
   * Speichert das Ergebnis in AiAnalysis + cachet es auf dem Server-Modell.
   */
  async generateServerSummary(serverId: string): Promise<ServerSummaryResult> {
    const settings = await this.getSettings();

    // Feature-Check
    if (settings.provider === 'disabled') {
      throw new Error('KI ist deaktiviert.');
    }
    if (!settings.enableSummary) {
      throw new Error('Server-Zusammenfassung ist deaktiviert.');
    }
    if (await this.isBlocked()) {
      throw new Error('KI ist vorübergehend blockiert (Prozessmap-Scan läuft).');
    }

    // Server-Daten laden
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        services: true,
        processes: { orderBy: { cpuPct: 'desc' }, take: 50 },
        mounts: true,
        dockerContainers: true,
        systemdUnits: { where: { enabled: true }, orderBy: { name: 'asc' } },
        sslCertificates: true,
        networkInterfaces: true,
        cronJobs: true,
      },
    });

    if (!server) {
      throw new Error(`Server ${serverId} nicht gefunden`);
    }

    // Kontext aufbauen
    const contextParts: string[] = [];

    // System-Info
    contextParts.push(`## System\n- Hostname: ${server.hostname || 'unbekannt'}\n- IP: ${server.ip}\n- OS: ${server.osInfo || 'unbekannt'}\n- Kernel: ${server.kernelInfo || 'unbekannt'}\n- CPU: ${server.cpuInfo || 'unbekannt'}\n- RAM: ${server.memoryMb ? `${server.memoryMb} MB` : 'unbekannt'}`);

    // Services / Ports
    if (server.services.length > 0) {
      const svcList = server.services
        .map((s: any) => `  - ${s.name} (Port ${s.port || '?'}/${s.protocol || 'tcp'}, ${s.state}, ${s.version || 'Version unbekannt'})`)
        .join('\n');
      contextParts.push(`## Aktive Services (${server.services.length})\n${svcList}`);
    }

    // Docker-Container
    if (server.dockerContainers.length > 0) {
      const dockerList = server.dockerContainers
        .map((c: any) => `  - ${c.name} (Image: ${c.image}, Status: ${c.state})`)
        .join('\n');
      contextParts.push(`## Docker-Container (${server.dockerContainers.length})\n${dockerList}`);
    }

    // Systemd-Units (nur enabled)
    if (server.systemdUnits.length > 0) {
      const unitList = server.systemdUnits
        .slice(0, 30)
        .map((u: any) => `  - ${u.name} (${u.activeState}/${u.subState || '?'})`)
        .join('\n');
      contextParts.push(`## Systemd-Units (${server.systemdUnits.length} enabled)\n${unitList}`);
    }

    // Mounts / Disk
    if (server.mounts.length > 0) {
      const mountList = server.mounts
        .filter((m: any) => !m.mountPoint.startsWith('/snap') && !m.mountPoint.startsWith('/sys'))
        .map((m: any) => `  - ${m.mountPoint} (${m.fsType}, ${m.sizeMb ? `${Math.round(m.sizeMb / 1024)} GB` : '?'}, ${m.usePct ? `${m.usePct}% belegt` : '?'})`)
        .join('\n');
      contextParts.push(`## Storage\n${mountList}`);
    }

    // SSL-Zertifikate
    if (server.sslCertificates.length > 0) {
      const sslList = server.sslCertificates
        .map((c: any) => `  - ${c.subject || c.path} (${c.isExpired ? 'ABGELAUFEN' : `${c.daysLeft} Tage verbleibend`})`)
        .join('\n');
      contextParts.push(`## SSL-Zertifikate (${server.sslCertificates.length})\n${sslList}`);
    }

    // Netzwerk-Interfaces
    if (server.networkInterfaces.length > 0) {
      const netList = server.networkInterfaces
        .filter((n: any) => n.ipAddr && n.state === 'UP')
        .map((n: any) => `  - ${n.name}: ${n.ipAddr}`)
        .join('\n');
      if (netList) contextParts.push(`## Netzwerk\n${netList}`);
    }

    // Top-Prozesse (CPU)
    const topProcs = server.processes
      .filter((p: any) => (p.cpuPct || 0) > 0.1 || (p.memPct || 0) > 1)
      .slice(0, 15);
    if (topProcs.length > 0) {
      const procList = topProcs
        .map((p: any) => `  - ${p.command} (CPU: ${p.cpuPct?.toFixed(1)}%, MEM: ${p.memPct?.toFixed(1)}%)`)
        .join('\n');
      contextParts.push(`## Top-Prozesse\n${procList}`);
    }

    // Cron-Jobs
    if (server.cronJobs.length > 0) {
      const cronList = server.cronJobs
        .slice(0, 10)
        .map((c: any) => `  - [${c.schedule}] ${c.command.substring(0, 80)}`)
        .join('\n');
      contextParts.push(`## Cron-Jobs (${server.cronJobs.length})\n${cronList}`);
    }

    const context = contextParts.join('\n\n');

    const prompt = `Analysiere die folgenden Daten eines Linux-Servers und erstelle eine Zusammenfassung.

${context}

Antworte NUR als JSON in genau diesem Format:
{
  "purpose": "Einzeilige Zweckbeschreibung des Servers (max 100 Zeichen)",
  "role": "primary-function (z.B. webserver, database, docker-host, monitoring, gateway)",
  "tags": ["tag1", "tag2", "tag3"],
  "summary": "Ausführlichere Zusammenfassung (3-5 Sätze) über Zweck, installierte Dienste und Rolle im Netzwerk."
}`;

    const startTime = Date.now();
    const { data, response } = await this.chatJson<ServerSummaryResult>(prompt, {
      systemPrompt: 'Du bist ein erfahrener Linux-Systemadministrator. Analysiere Server-Daten und erstelle präzise Zusammenfassungen auf Deutsch. Antworte NUR mit validem JSON.',
      temperature: 0.1,
    });
    const durationMs = Date.now() - startTime;

    // Ergebnis auf Server cachen
    await prisma.server.update({
      where: { id: serverId },
      data: {
        aiSummary: data.summary,
        aiPurpose: data.purpose,
        aiTags: data.tags || [],
      },
    });

    // Ergebnis in AiAnalysis speichern
    await this.saveAnalysis({
      serverId,
      purpose: 'server_summary',
      treeJson: data,
      rawPrompt: prompt,
      rawResponse: response.content,
      modelUsed: response.model,
      durationMs,
    });

    logger.info(`✅ Server-Zusammenfassung generiert für ${serverId}: "${data.purpose}" (${durationMs}ms)`);
    return data;
  }

  // ── Anomalie-Erkennung (Phase 5.6) ────────────────────────────────────

  /**
   * Bewertet Diff-Events eines Scans mit KI auf Anomalien.
   * Wird automatisch vom Scan-Worker aufgerufen wenn enableAnomaly === true.
   *
   * @param serverId - Server-ID
   * @param diffs - Die Diff-Events aus dem aktuellen Snapshot
   * @returns AnomalyResult mit Gesamt-Risiko und Einzelbewertungen
   */
  async evaluateAnomalies(
    serverId: string,
    diffs: Array<{
      id: string;
      category: string;
      changeType: string;
      itemKey: string;
      oldValue: any;
      newValue: any;
      severity: string;
    }>,
  ): Promise<AnomalyResult> {
    // Feature-Check
    const enabled = await this.isFeatureEnabled('enableAnomaly');
    if (!enabled) {
      throw new Error('Anomalie-Erkennung ist deaktiviert');
    }

    if (diffs.length === 0) {
      return { overall_risk: 'low', findings: [], summary: 'Keine Änderungen erkannt.' };
    }

    // Server-Kontext laden
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: {
        hostname: true,
        ip: true,
        osInfo: true,
        aiPurpose: true,
        aiSummary: true,
      },
    });

    if (!server) {
      throw new Error(`Server ${serverId} nicht gefunden`);
    }

    const hostname = server.hostname || server.ip || 'unbekannt';

    // Diffs für Prompt formatieren (max 30 um Token zu sparen)
    // Priorisiert: CRITICAL > WARNING > INFO, REMOVED > ADDED > MODIFIED
    const prioritized = [...diffs].sort((a, b) => {
      const sevOrder: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
      const typeOrder: Record<string, number> = { REMOVED: 0, ADDED: 1, MODIFIED: 2 };
      const sevDiff = (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
      if (sevDiff !== 0) return sevDiff;
      return (typeOrder[a.changeType] ?? 3) - (typeOrder[b.changeType] ?? 3);
    });
    const diffSlice = prioritized.slice(0, 30);
    const diffsJson = diffSlice.map(d => ({
      category: d.category,
      changeType: d.changeType,
      itemKey: d.itemKey,
      oldValue: d.oldValue ? (typeof d.oldValue === 'string' ? d.oldValue.substring(0, 150) : JSON.stringify(d.oldValue).substring(0, 150)) : null,
      newValue: d.newValue ? (typeof d.newValue === 'string' ? d.newValue.substring(0, 150) : JSON.stringify(d.newValue).substring(0, 150)) : null,
      severity: d.severity,
    }));

    // Server-Kontext für bessere Bewertung
    const serverContext = [
      `Hostname: ${hostname}`,
      server.osInfo ? `OS: ${server.osInfo}` : null,
      server.aiPurpose ? `Zweck: ${server.aiPurpose}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `Analysiere die folgenden ${diffs.length} Änderungen auf dem Server "${hostname}" und bewerte ob diese normal (geplante Wartung, Update) oder auffällig (Sicherheitsrisiko, unerwartete Änderung) sind.

## Server-Info
${serverContext}

## Diff-Events (${diffs.length} Änderungen${diffs.length > 30 ? `, die ${diffSlice.length} wichtigsten gezeigt` : ''})
\`\`\`json
${JSON.stringify(diffsJson, null, 2)}
\`\`\`

## Bewertungs-Kriterien
- **normal**: Reguläre Updates, geplante Wartung, harmlose Konfigurationsänderungen
- **suspicious**: Unerwartete neue Dienste, Port-Änderungen, Benutzer-Änderungen, verdächtige Prozesse
- **critical**: Sicherheitsrelevante Änderungen (SSH-Config, Firewall, Root-Zugang), verschwundene Sicherheitsdienste, unerklärliche Disk-Sprünge

## Kategorien-Hinweise
- services: Netzwerkdienste (neue/entfernte Ports sind oft auffällig)
- processes: Laufende Prozesse (neue unbekannte Prozesse prüfen)
- userAccounts: Benutzeränderungen (immer genau prüfen)
- sslCertificates: SSL-Zertifikate (Ablauf = kritisch)
- dockerContainers: Container-Änderungen (oft normal bei Updates)
- systemdUnits: Systemd-Dienste (deaktivierte Sicherheitsdienste = kritisch)
- mounts: Speicher-Änderungen (große Disk-Sprünge prüfen)

Antworte NUR als JSON. Fasse ähnliche Änderungen zusammen (maximal 8 Findings). Halte die Texte kurz:
{
  "overall_risk": "low|medium|high|critical",
  "summary": "Kurze Zusammenfassung (1-2 Sätze)",
  "findings": [
    {
      "event": "Kurze Beschreibung",
      "assessment": "normal|suspicious|critical",
      "reason": "Kurze Begründung",
      "recommendation": "Empfehlung",
      "category": "Kategorie",
      "itemKey": "Key"
    }
  ]
}`;

    const startTime = Date.now();

    try {
      const { data, response } = await this.chatJson<AnomalyResult>(prompt, {
        systemPrompt: 'Du bist ein erfahrener IT-Sicherheitsanalyst und Linux-Administrator. Bewerte Server-Änderungen auf Anomalien und Sicherheitsrisiken. Sei aufmerksam aber nicht übervorsichtig – normale Updates und Wartung sollten als "normal" bewertet werden. Antworte NUR mit validem JSON. Maximal 8 Findings, fasse Ähnliches zusammen.',
        temperature: 0.2,
        maxTokens: 3000,
        _internal: true,
      });
      const durationMs = Date.now() - startTime;

      // Ergebnis validieren und normalisieren
      const validRisks = ['low', 'medium', 'high', 'critical'];
      if (!validRisks.includes(data.overall_risk)) {
        data.overall_risk = 'medium';
      }

      const validAssessments = ['normal', 'suspicious', 'critical'];
      data.findings = (data.findings || []).map(f => ({
        ...f,
        assessment: validAssessments.includes(f.assessment) ? f.assessment : 'normal',
      }));

      // In AiAnalysis speichern
      await this.saveAnalysis({
        serverId,
        purpose: 'anomaly_check',
        treeJson: data,
        rawPrompt: prompt,
        rawResponse: response.content,
        modelUsed: response.model,
        durationMs,
      });

      // Bei critical: automatisch Alert erstellen
      const criticalFindings = data.findings.filter(f => f.assessment === 'critical');
      if (data.overall_risk === 'critical' || criticalFindings.length > 0) {
        const alertMessage = criticalFindings.length > 0
          ? criticalFindings.map(f => `• ${f.event}: ${f.reason}`).join('\n')
          : data.summary || 'Kritische Anomalie erkannt';

        await prisma.alert.create({
          data: {
            serverId,
            title: `🤖 KI-Anomalie: Kritische Änderungen auf ${hostname}`,
            message: alertMessage,
            severity: 'CRITICAL',
            category: 'ai_anomaly',
            metadata: {
              overall_risk: data.overall_risk,
              finding_count: data.findings.length,
              critical_count: criticalFindings.length,
            },
          },
        });
        logger.warn(`🚨 KI-Anomalie-Alert erstellt für ${hostname}: ${criticalFindings.length} kritische Findings`);
      } else if (data.overall_risk === 'high') {
        // Bei high risk: Warning-Alert
        await prisma.alert.create({
          data: {
            serverId,
            title: `🤖 KI-Anomalie: Auffällige Änderungen auf ${hostname}`,
            message: data.summary || 'Auffällige Änderungen erkannt',
            severity: 'WARNING',
            category: 'ai_anomaly',
            metadata: {
              overall_risk: data.overall_risk,
              finding_count: data.findings.length,
            },
          },
        });
        logger.info(`⚠️ KI-Anomalie-Warning erstellt für ${hostname}`);
      }

      logger.info(`🔍 Anomalie-Check abgeschlossen für ${hostname}: risk=${data.overall_risk}, ${data.findings.length} Findings (${durationMs}ms)`);
      return data;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      logger.error(`❌ Anomalie-Check fehlgeschlagen für ${hostname} (${durationMs}ms): ${err.message}`);
      throw err;
    }
  }

  // ── Auto-Runbook (Phase 5.7) ────────────────────────────────────────────

  /**
   * Generiert ein automatisches Wartungs-Runbook für einen Server.
   * Basiert auf: Server-Config, laufende Services, Alerts, Anomalien, Docker-Updates.
   */
  async generateRunbook(serverId: string): Promise<RunbookResult> {
    // Feature-Check
    const enabled = await this.isFeatureEnabled('enableRunbooks');
    if (!enabled) {
      throw new Error('Auto-Runbooks sind deaktiviert. Bitte in den KI-Einstellungen aktivieren.');
    }

    // Server-Daten laden (umfangreich)
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        services: true,
        processes: { orderBy: { cpuPct: 'desc' }, take: 30 },
        mounts: true,
        dockerContainers: true,
        systemdUnits: { where: { enabled: true }, orderBy: { name: 'asc' } },
        sslCertificates: true,
        networkInterfaces: true,
        cronJobs: true,
        alerts: {
          where: { resolved: false },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!server) {
      throw new Error(`Server ${serverId} nicht gefunden`);
    }

    const hostname = server.hostname || server.ip;

    // Anomalie-Analyse laden (falls vorhanden)
    const anomalyAnalysis = await prisma.aiAnalysis.findFirst({
      where: { serverId, purpose: 'anomaly_check' },
      orderBy: { createdAt: 'desc' },
    });

    // Kontext aufbauen
    const contextParts: string[] = [];

    // System-Info
    contextParts.push(`## Server: ${hostname}\n- IP: ${server.ip}\n- OS: ${server.osInfo || 'unbekannt'}\n- Kernel: ${server.kernelInfo || 'unbekannt'}\n- CPU: ${server.cpuInfo || 'unbekannt'}\n- RAM: ${server.memoryMb ? `${server.memoryMb} MB` : 'unbekannt'}\n- Zweck: ${server.aiPurpose || 'nicht klassifiziert'}\n- KI-Zusammenfassung: ${server.aiSummary || 'nicht vorhanden'}`);

    // Offene Alerts
    if ((server as any).alerts?.length > 0) {
      const alertList = (server as any).alerts
        .map((a: any) => `  - [${a.severity}] ${a.title}: ${a.message?.substring(0, 100)}`)
        .join('\n');
      contextParts.push(`## Offene Alerts (${(server as any).alerts.length})\n${alertList}`);
    }

    // Anomalie-Ergebnisse
    if (anomalyAnalysis?.treeJson) {
      const anomaly = anomalyAnalysis.treeJson as any;
      if (anomaly.findings?.length > 0) {
        const findingList = anomaly.findings
          .map((f: any) => `  - [${f.assessment}] ${f.event}: ${f.reason}`)
          .join('\n');
        contextParts.push(`## Letzte Anomalie-Analyse (Risiko: ${anomaly.overall_risk})\n${findingList}`);
      }
    }

    // Docker-Container
    if (server.dockerContainers.length > 0) {
      const dockerList = server.dockerContainers
        .map((c: any) => `  - ${c.name} (Image: ${c.image}, Status: ${c.state})`)
        .join('\n');
      contextParts.push(`## Docker-Container (${server.dockerContainers.length})\n${dockerList}`);
    }

    // SSL-Zertifikate (fokus auf ablaufende)
    if (server.sslCertificates.length > 0) {
      const sslList = server.sslCertificates
        .map((c: any) => `  - ${c.subject || c.path} (${c.isExpired ? 'ABGELAUFEN!' : `${c.daysLeft} Tage übrig`})`)
        .join('\n');
      contextParts.push(`## SSL-Zertifikate (${server.sslCertificates.length})\n${sslList}`);
    }

    // Services / Ports
    if (server.services.length > 0) {
      const svcList = server.services
        .slice(0, 25)
        .map((s: any) => `  - ${s.name} Port ${s.port || '?'}/${s.protocol || 'tcp'} (${s.state})`)
        .join('\n');
      contextParts.push(`## Aktive Services (${server.services.length})\n${svcList}`);
    }

    // Disk-Nutzung
    if (server.mounts.length > 0) {
      const criticalMounts = server.mounts
        .filter((m: any) => !m.mountPoint.startsWith('/snap') && !m.mountPoint.startsWith('/sys'))
        .map((m: any) => `  - ${m.mountPoint} (${m.fsType}, ${m.sizeMb ? `${Math.round(m.sizeMb / 1024)} GB` : '?'}, ${m.usePct ? `${m.usePct}% belegt` : '?'})`)
        .join('\n');
      contextParts.push(`## Storage\n${criticalMounts}`);
    }

    // Systemd-Units mit Problemen
    const failedUnits = server.systemdUnits
      .filter((u: any) => u.activeState === 'failed' || u.activeState === 'inactive');
    if (failedUnits.length > 0) {
      const unitList = failedUnits
        .slice(0, 15)
        .map((u: any) => `  - ${u.name}: ${u.activeState}/${u.subState || '?'}`)
        .join('\n');
      contextParts.push(`## Problematische Systemd-Units (${failedUnits.length})\n${unitList}`);
    }

    // Cron-Jobs
    if (server.cronJobs.length > 0) {
      const cronList = server.cronJobs
        .slice(0, 10)
        .map((c: any) => `  - [${c.schedule}] ${c.command.substring(0, 60)}`)
        .join('\n');
      contextParts.push(`## Cron-Jobs (${server.cronJobs.length})\n${cronList}`);
    }

    const context = contextParts.join('\n\n');

    const prompt = `Erstelle ein Wartungs-Runbook für den folgenden Linux-Server. Das Runbook soll konkrete, ausführbare Schritte enthalten.

${context}

Erstelle das Runbook mit folgenden Schwerpunkten:
1. **Sicherheit**: SSL-Erneuerung, offene Alerts beheben, Anomalien untersuchen
2. **Updates**: System-Pakete, Docker-Container-Images, Service-Updates
3. **Performance**: Disk-Space prüfen, Resource-Bottlenecks, Log-Rotation
4. **Backup**: Backup-Status prüfen, Datenbank-Dumps, Config-Sicherung
5. **Monitoring**: Fehlgeschlagene Systemd-Units, Cron-Jobs prüfen

Antworte NUR als JSON. Halte die Schritte kurz und konkret (Befehle wo möglich). Maximal 6 Abschnitte:
{
  "title": "Wartungs-Runbook für [Hostname]",
  "summary": "Kurze Zusammenfassung (1-2 Sätze)",
  "sections": [
    {
      "title": "Abschnitts-Titel",
      "priority": "routine|important|critical",
      "description": "Warum ist das wichtig?",
      "steps": ["Schritt 1: ...", "Schritt 2: ..."],
      "affectedServices": ["service1", "service2"]
    }
  ]
}`;

    const startTime = Date.now();

    try {
      const { data, response } = await this.chatJson<RunbookResult>(prompt, {
        systemPrompt: 'Du bist ein erfahrener Linux-Systemadministrator und DevOps-Ingenieur. Erstelle präzise, ausführbare Wartungs-Runbooks auf Deutsch. Gib konkrete Befehle an wo möglich. Antworte NUR mit validem JSON.',
        temperature: 0.3,
        maxTokens: 4000,
        _internal: true,
      });
      const durationMs = Date.now() - startTime;

      // Validierung
      data.sections = (data.sections || []).map(s => ({
        ...s,
        priority: ['routine', 'important', 'critical'].includes(s.priority) ? s.priority : 'routine',
        steps: Array.isArray(s.steps) ? s.steps : [],
      }));

      // Sortierung: critical > important > routine
      const priorityOrder: Record<string, number> = { critical: 0, important: 1, routine: 2 };
      data.sections.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));

      data.generatedAt = new Date().toISOString();

      // In AiAnalysis speichern
      await this.saveAnalysis({
        serverId,
        purpose: 'runbook',
        treeJson: data,
        rawPrompt: prompt,
        rawResponse: response.content,
        modelUsed: response.model,
        durationMs,
      });

      logger.info(`📋 Runbook generiert für ${hostname}: ${data.sections.length} Abschnitte (${durationMs}ms)`);
      return data;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      logger.error(`❌ Runbook-Generierung fehlgeschlagen für ${hostname} (${durationMs}ms): ${err.message}`);
      throw err;
    }
  }

  // ── Prozessmap / Baumstruktur (Phase 5.5) ───────────────────────────────

  /**
   * Analysiert die gesammelten Fehler-Logs eines Servers per KI.
   * Fasst die Hauptprobleme zusammen und gibt Handlungsempfehlungen.
   */
  async analyzeServerLogs(serverId: string): Promise<LogAnalysisResult> {
    // Feature-Check
    const enabled = await this.isFeatureEnabled('enableLogAnalysis');
    if (!enabled) {
      throw new Error('Log-Analyse ist deaktiviert. Bitte in den KI-Einstellungen aktivieren.');
    }

    // Server + Logs laden
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      include: {
        serverLogs: { orderBy: { collectedAt: 'desc' }, take: 1 },
      },
    });

    if (!server) {
      throw new Error(`Server ${serverId} nicht gefunden`);
    }

    const logEntry = (server as any).serverLogs?.[0];
    if (!logEntry) {
      throw new Error(`Keine Log-Daten für Server ${serverId} vorhanden. Bitte zuerst einen Scan durchführen.`);
    }

    const hostname = server.hostname || server.ip;

    // Log-Kontext aufbauen – ultra-kompakt für CPU-Ollama
    const logParts: string[] = [];
    const MAX_TOTAL = 2000; // ~500 tokens – damit CPU-Ollama es in 2-3 Min schafft
    let totalChars = 0;

    const addSection = (label: string, content: string | null, limit: number) => {
      if (!content || !content.trim() || totalChars >= MAX_TOTAL) return;
      // Nur Error-relevante Zeilen behalten (error, fail, warn, critical, oom, panic, kill)
      const lines = content.split('\n');
      const filtered = lines.filter(l => /error|fail|warn|crit|oom|panic|kill|denied|segfault/i.test(l));
      const text = (filtered.length > 0 ? filtered : lines).slice(0, 15).join('\n');
      const trimmed = text.substring(0, Math.min(limit, MAX_TOTAL - totalChars));
      if (trimmed.trim()) {
        logParts.push(`${label}:\n${trimmed}`);
        totalChars += trimmed.length + label.length + 2;
      }
    };

    addSection('journal', logEntry.journaldErrors, 600);
    addSection('dmesg', logEntry.dmesgErrors, 400);
    addSection('syslog', logEntry.syslogErrors, 400);
    addSection('auth', logEntry.authErrors, 300);
    addSection('oom', logEntry.oomEvents, 300);

    if (logEntry.appLogs && typeof logEntry.appLogs === 'object') {
      const appLogs = logEntry.appLogs as Record<string, string>;
      for (const [filename, content] of Object.entries(appLogs)) {
        if (content && typeof content === 'string' && totalChars < MAX_TOTAL) {
          addSection(filename, content, 400);
        }
      }
    }

    if (logParts.length === 0) {
      // Keine Logs vorhanden → System ist gesund
      const result: LogAnalysisResult = {
        status_score: 100,
        status: 'healthy',
        summary: ['Keine Fehler-Logs vorhanden – System erscheint gesund.'],
        findings: [],
        analyzedAt: new Date().toISOString(),
      };

      await this.saveAnalysis({
        serverId,
        purpose: 'log_analysis',
        treeJson: result,
        rawPrompt: '(keine Logs vorhanden)',
        rawResponse: '(automatisch: System Healthy)',
        modelUsed: 'auto',
        durationMs: 0,
      });

      return result;
    }

    const logContext = logParts.join('\n');

    const prompt = `${hostname} (${server.ip}) logs:
${logContext}
JSON: {"status_score":<0-100>,"status":"healthy|degraded|critical","summary":["..."],"findings":[{"issue":"...","severity":"warning","source":"journal","recommendation":"..."}]}`;

    const startTime = Date.now();

    try {
      const { data, response } = await this.chatJson<LogAnalysisResult>(prompt, {
        systemPrompt: 'Linux sysadmin. Analyze logs. Reply JSON only.',
        temperature: 0.1,
        maxTokens: 512,
        contextWindow: 2048,
        timeoutMs: 180_000,
        _internal: true,
      });
      const durationMs = Date.now() - startTime;

      // Validierung
      if (typeof data.status_score !== 'number' || data.status_score < 0 || data.status_score > 100) {
        data.status_score = 50;
      }

      const validStatuses = ['healthy', 'degraded', 'critical'];
      if (!validStatuses.includes(data.status)) {
        data.status = data.status_score >= 80 ? 'healthy' : data.status_score >= 40 ? 'degraded' : 'critical';
      }

      data.summary = Array.isArray(data.summary) ? data.summary.slice(0, 5) : [];
      data.findings = (data.findings || []).map(f => ({
        ...f,
        severity: ['info', 'warning', 'error', 'critical'].includes(f.severity) ? f.severity : 'warning',
      })).slice(0, 8);

      data.analyzedAt = new Date().toISOString();

      // In AiAnalysis speichern
      await this.saveAnalysis({
        serverId,
        purpose: 'log_analysis',
        treeJson: data,
        rawPrompt: prompt,
        rawResponse: response.content,
        modelUsed: response.model,
        durationMs,
      });

      // Bei critical status: automatisch Alert erstellen
      if (data.status === 'critical') {
        const alertMsg = data.summary.join('\n• ');
        await prisma.alert.create({
          data: {
            serverId,
            title: `🤖 KI-Log-Analyse: Kritische Fehler auf ${hostname}`,
            message: `Score: ${data.status_score}/100\n• ${alertMsg}`,
            severity: 'CRITICAL',
            category: 'ai_log_analysis',
            metadata: {
              status_score: data.status_score,
              finding_count: data.findings.length,
            },
          },
        });
        logger.warn(`🚨 KI-Log-Alert erstellt für ${hostname}: Score=${data.status_score}`);
      }

      logger.info(`📋 Log-Analyse abgeschlossen für ${hostname}: status=${data.status}, score=${data.status_score} (${durationMs}ms)`);
      return data;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      logger.error(`❌ Log-Analyse fehlgeschlagen für ${hostname} (${durationMs}ms): ${err.message}`);
      throw err;
    }
  }

  /**
   * Schritt 3: Discovery-Befehle generieren und via SSH ausführen.
   * Bekannte Dienste nutzen KNOWN_COMMANDS, unbekannte werden via LLM generiert.
   */
  async generateDiscoveryCommand(processName: string): Promise<string | null> {
    // Bekannte Dienste → kein LLM nötig
    const known = KNOWN_COMMANDS[processName];
    if (known) {
      return known.command;
    }

    // LLM fragen
    try {
      const prompt = `Generiere EINEN einzelnen Bash-Befehl, der den Status und die aktive Konfiguration des Linux-Prozesses "${processName}" anzeigt.
Der Befehl soll in max. 10 Sekunden ausführbar sein und relevante Infos wie Ports, Version, aktive Verbindungen zeigen.
Trenne mehrere Befehle mit " ; echo '---' ; ".

Antworte NUR als JSON:
{ "command": "der bash befehl" }`;

      const { data } = await this.chatJson<{ command: string }>(prompt, {
        temperature: 0.1,
        maxTokens: 500,
        _internal: true,
      });
    } catch (err: any) {
      logger.warn(`Discovery-Befehl für ${processName} konnte nicht generiert werden: ${err.message}`);
      return null;
    }
  }

  /**
   * Schritt 4: LLM wählt die relevantesten Config-Dateien aus.
   * Reduziert Token-Verbrauch für die Baumstruktur-Generierung.
   */
  async selectRelevantConfigs(
    processName: string,
    configPaths: string[],
  ): Promise<string[]> {
    if (configPaths.length <= 3) {
      return configPaths; // Wenige Configs → alle behalten
    }

    try {
      const fileList = configPaths.map((p, i) => `  ${i + 1}. ${p}`).join('\n');

      const prompt = `Prozess: "${processName}"

Folgende Config-Dateien wurden gefunden:
${fileList}

Wähle die Config-Dateien aus, die für eine strukturelle Analyse des Dienstes am wichtigsten sind (Ports, Pfade, Verbindungen, Berechtigungen).
Ignoriere: Logrotate, Bash-Completion, AppArmor/SELinux, Man-Pages.

Antworte NUR als JSON:
{
  "selected": ["/pfad/zur/wichtigen.conf", "/pfad/zur/anderen.cfg"],
  "reason": "Kurze Begründung"
}`;

      const { data } = await this.chatJson<ConfigSelectionResult>(prompt, {
        temperature: 0.1,
        maxTokens: 1000,
        _internal: true,
      });

      // Validierung: nur tatsächlich vorhandene Pfade
      const validPaths = (data.selected || []).filter((p: string) => configPaths.includes(p));
      if (validPaths.length === 0) {
        // Fallback: die ersten 5
        return configPaths.slice(0, 5);
      }
      return validPaths;
    } catch (err: any) {
      logger.warn(`Config-Auswahl für ${processName} fehlgeschlagen, verwende alle: ${err.message}`);
      return configPaths.slice(0, 5);
    }
  }

  /**
   * Schritt 5: Baumstruktur für einen einzelnen Prozess generieren.
   * Kernfunktion portiert aus ansatz2/baum_struktur.py.
   */
  async generateProcessTree(
    processName: string,
    executable: string,
    configContents: Array<{ path: string; content: string }>,
    discoveryOutput?: string,
  ): Promise<ProcessTreeResult> {
    // Config-Inhalte als Markdown aufbereiten
    const configsMd = configContents
      .map((c) => this.configToMarkdown(c.path, this.compressConfig(c.content, 8000)))
      .join('\n\n');

    const discoverySection = discoveryOutput
      ? `\n\n## Discovery-Output\n\n\`\`\`\n${discoveryOutput.substring(0, 5000)}\n\`\`\`\n`
      : '';

    const prompt = `Analysiere den Linux-Prozess "${processName}" (${executable}) und erstelle eine hierarchische Baumstruktur seiner Konfiguration.

${configsMd}${discoverySection}

WICHTIG: Erstelle eine **lineare Kette** von Knoten, die den Informationsfluss abbildet.
Jeder Knoten hat:
- "name": Bezeichnung (z.B. "Listen-Port", "Document-Root", "Upstream-Server")
- "type": Knotentyp – einer von: "config_file", "port", "path", "directory", "vhost", "upstream", "connection", "volume", "parameter", "user", "module", "database", "log"
- "value": Konkreter Wert (z.B. "80", "/var/www/html", "/etc/nginx/nginx.conf")
- "children": Weitere Detail-Knoten (optional, maximal 1 Ebene tief)

Die Struktur soll einen **Baum** ergeben, bei dem jeder Detail-Knoten als eigener visueller Knoten dargestellt wird.
Gruppiere NICHT nach abstrakten Kategorien wie "Netzwerk" oder "Storage", sondern bilde die **reale Konfigurationsstruktur** ab.

Beispiel für Apache2:
- Hauptconfig → /etc/apache2/apache2.conf
  - VHost → default (Port 80) → Document-Root /var/www/html
  - VHost → ssl-site (Port 443) → Document-Root /var/www/secure → SSL-Cert /etc/ssl/...
  - Modul → mod_rewrite
  - Modul → mod_ssl
  - Log → /var/log/apache2/access.log

Beispiel für PostgreSQL:
- Hauptconfig → /etc/postgresql/16/main/postgresql.conf
  - Listen → Port 5432 → Bind 127.0.0.1
  - Datenbank → mydb
  - Log → /var/log/postgresql/postgresql-16-main.log
  - HBA → /etc/postgresql/16/main/pg_hba.conf → local trust → host md5

Antworte NUR als JSON:
{
  "process": "${processName}",
  "executable": "${executable}",
  "service_type": "Typ des Dienstes (z.B. Webserver, Datenbank, Proxy, Container Runtime)",
  "description": "Kurze Beschreibung was der Dienst tut (1 Satz)",
  "children": [
    {
      "name": "Hauptconfig",
      "type": "config_file",
      "value": "/etc/example/main.conf",
      "children": [
        { "name": "Listen-Port", "type": "port", "value": "8080" },
        { "name": "Document-Root", "type": "directory", "value": "/var/www/html" },
        { "name": "Access-Log", "type": "log", "value": "/var/log/example/access.log" }
      ]
    }
  ]
}`;

    const { data, response } = await this.chatJson<ProcessTreeResult>(prompt, {
      systemPrompt: 'Du bist ein erfahrener Linux-Systemadministrator. Analysiere Prozesskonfigurationen und erstelle präzise Baumstrukturen als JSON. Antworte NUR mit validem JSON.',
      temperature: 0.1,
      maxTokens: 4096,
      _internal: true,
    });

    // Felder normalisieren
    data.process = data.process || processName;
    data.executable = data.executable || executable;
    data.children = data.children || [];

    return data;
  }

  // ── Analyse in DB speichern ───────────────────────────────────────────

  /**
   * Speichert ein KI-Analyse-Ergebnis in der AiAnalysis-Tabelle.
   * Bei gleicher purpose+serverId wird der vorherige Eintrag überschrieben.
   */
  async saveAnalysis(params: {
    serverId: string;
    purpose: string;
    treeJson?: any;
    rawPrompt: string;
    rawResponse: string;
    modelUsed: string;
    durationMs: number;
  }): Promise<any> {
    // Alten Eintrag mit gleichem purpose für diesen Server löschen
    await prisma.aiAnalysis.deleteMany({
      where: {
        serverId: params.serverId,
        purpose: params.purpose,
      },
    });

    // Neuen Eintrag erstellen
    const analysis = await prisma.aiAnalysis.create({
      data: {
        serverId: params.serverId,
        purpose: params.purpose,
        treeJson: params.treeJson || null,
        rawPrompt: params.rawPrompt,
        rawResponse: params.rawResponse,
        modelUsed: params.modelUsed,
        durationMs: params.durationMs,
      },
    });

    logger.info(`AiAnalysis gespeichert: purpose=${params.purpose}, server=${params.serverId}, ${params.durationMs}ms`);
    return analysis;
  }

  // ── Hilfsfunktionen ───────────────────────────────────────────────────

  /**
   * Extrahiert JSON aus einem Text – auch wenn Markdown-Codeblöcke enthalten sind.
   * Versucht mehrere Strategien:
   *   1. Direktes JSON.parse
   *   2. JSON aus ```json ... ``` extrahieren
   *   3. Erstes { ... } oder [ ... ] finden
   */
  private extractJson<T>(text: string): T | null {
    const trimmed = text.trim();

    // 1. Direktes Parse
    try {
      return JSON.parse(trimmed) as T;
    } catch {}

    // 2. Markdown Codeblock
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim()) as T;
      } catch {}
    }

    // 3. Erstes JSON-Objekt/Array finden
    const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]) as T;
      } catch {}
    }

    return null;
  }

  /**
   * Komprimiert Config-Inhalte für das Context-Window.
   * Portiert aus ansatz2/baum_struktur.py.
   */
  compressConfig(content: string, maxChars: number = 60000): string {
    let result = content;

    // Kommentarzeilen entfernen (# ... und // ...)
    result = result.replace(/^[ \t]*#(?!!).*$/gm, '');
    result = result.replace(/^[ \t]*\/\/.*$/gm, '');

    // XML-Kommentare entfernen
    result = result.replace(/<!--[\s\S]*?-->/g, '');

    // Mehrfache Leerzeilen auf eine reduzieren
    result = result.replace(/\n{3,}/g, '\n\n');

    // Trailing whitespace entfernen
    result = result.replace(/[ \t]+$/gm, '');

    // Kürzen wenn nötig
    if (result.length > maxChars) {
      result = result.substring(0, maxChars) + '\n\n[... gekürzt, ' +
        (content.length - maxChars) + ' Zeichen ausgelassen ...]';
    }

    return result.trim();
  }

  /**
   * Formatiert Config-Inhalt als Markdown (wie conf2md.sh).
   */
  configToMarkdown(filename: string, content: string): string {
    return `## Konfiguration: ${filename}\n\n\`\`\`\n${content}\n\`\`\`\n`;
  }
}

// Singleton-Export für einfache Verwendung
export const aiService = AiService.getInstance();
