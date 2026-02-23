// ─── SSH-Service v2 (Etappe 2) ───────────────────────────────────────────
// Robuster SSH-Client mit:
//   - Retry-Logik mit exponentiellem Backoff
//   - Sudo-Support (optional)
//   - Strukturierte Fehler-Kategorien
//   - Konfigurierbare Timeouts
//   - Streaming für große Ausgaben
//   - Verbindungs-Health-Check

import { Client as SSHClient, ConnectConfig } from 'ssh2';
import { decrypt } from './crypto.service';
import { generateGatherScript, GatherScriptOptions } from './gather-script';
import { logger } from '../logger';

// ─── Konfiguration ───────────────────────────────────────────────────────

const DEFAULTS = {
  GATHER_TIMEOUT: 180_000,    // 3 Minuten max für das Gather-Script
  CONNECT_TIMEOUT: 15_000,    // 15s Verbindungstimeout
  MAX_RETRIES: 2,             // Max 2 Wiederholungen
  RETRY_BASE_DELAY: 3_000,   // 3s Basis-Delay
  MAX_OUTPUT_SIZE: 10_000_000, // 10MB max Output
};

const REMOTE_SCRIPT_PATH = '/tmp/.systemmap_gather.sh';

// ─── Typen ───────────────────────────────────────────────────────────────

export interface SSHCredentials {
  host: string;
  port: number;
  username: string;
  passwordEncrypted?: string;
  keyEncrypted?: string;
}

export interface SSHExecOptions {
  /** Timeout in ms für die gesamte Ausführung */
  timeout?: number;
  /** Ob via sudo ausgeführt werden soll */
  sudo?: boolean;
  /** Max Retries bei Verbindungsfehler */
  maxRetries?: number;
  /** Optionen für das Gather-Script */
  gatherOptions?: GatherScriptOptions;
}

export enum SSHErrorCategory {
  AUTH_FAILED = 'AUTH_FAILED',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  HOST_UNREACHABLE = 'HOST_UNREACHABLE',
  DNS_RESOLUTION = 'DNS_RESOLUTION',
  SCRIPT_TIMEOUT = 'SCRIPT_TIMEOUT',
  SCRIPT_ERROR = 'SCRIPT_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  OUTPUT_TOO_LARGE = 'OUTPUT_TOO_LARGE',
  UNKNOWN = 'UNKNOWN',
}

export class SSHError extends Error {
  constructor(
    message: string,
    public readonly category: SSHErrorCategory,
    public readonly host: string,
    public readonly retriable: boolean = false,
  ) {
    super(message);
    this.name = 'SSHError';
  }
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────

function categorizeError(err: any, host: string): SSHError {
  const msg = err.message || String(err);
  const level = err.level || '';

  if (msg.includes('Authentication failed') || msg.includes('All configured authentication methods failed') || level === 'client-authentication') {
    return new SSHError(`Authentifizierung fehlgeschlagen für ${host}`, SSHErrorCategory.AUTH_FAILED, host, false);
  }
  if (msg.includes('ECONNREFUSED') || msg.includes('connect ECONNREFUSED')) {
    return new SSHError(`Verbindung abgelehnt: ${host}`, SSHErrorCategory.CONNECTION_REFUSED, host, true);
  }
  if (msg.includes('ETIMEDOUT') || msg.includes('Timed out') || msg.includes('connect ETIMEDOUT')) {
    return new SSHError(`Verbindungs-Timeout: ${host}`, SSHErrorCategory.CONNECTION_TIMEOUT, host, true);
  }
  if (msg.includes('EHOSTUNREACH') || msg.includes('No route to host')) {
    return new SSHError(`Host nicht erreichbar: ${host}`, SSHErrorCategory.HOST_UNREACHABLE, host, true);
  }
  if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
    return new SSHError(`DNS-Auflösung fehlgeschlagen: ${host}`, SSHErrorCategory.DNS_RESOLUTION, host, false);
  }

  return new SSHError(`SSH-Fehler bei ${host}: ${msg}`, SSHErrorCategory.UNKNOWN, host, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── SSH-Verbindung herstellen ───────────────────────────────────────────

function createSSHConnection(creds: SSHCredentials, connectTimeout: number): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();

    const sshConfig: ConnectConfig = {
      host: creds.host,
      port: creds.port,
      username: creds.username,
      readyTimeout: connectTimeout,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
    };

    // Passwort entschlüsseln
    if (creds.passwordEncrypted) {
      sshConfig.password = decrypt(creds.passwordEncrypted);
    }

    // SSH-Key entschlüsseln
    if (creds.keyEncrypted) {
      sshConfig.privateKey = decrypt(creds.keyEncrypted);
    }

    // Keyboard-Interactive Auth unterstützen (für 2FA etc.)
    if (sshConfig.password) {
      sshConfig.tryKeyboard = true;
      conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        const responses = prompts.map(() => sshConfig.password || '');
        finish(responses);
      });
    }

    conn.on('ready', () => {
      logger.debug(`SSH-Verbindung zu ${creds.host}:${creds.port} hergestellt`);
      resolve(conn);
    });

    conn.on('error', (err) => {
      reject(categorizeError(err, creds.host));
    });

    conn.connect(sshConfig);
  });
}

// ─── SSH-Befehl ausführen ────────────────────────────────────────────────

function execCommand(conn: SSHClient, command: string, timeout: number, host: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end();
      reject(new SSHError(
        `Script-Timeout nach ${timeout / 1000}s auf ${host}`,
        SSHErrorCategory.SCRIPT_TIMEOUT,
        host,
        true,
      ));
    }, timeout);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(new SSHError(
          `SSH-Exec Fehler auf ${host}: ${err.message}`,
          SSHErrorCategory.SCRIPT_ERROR,
          host,
          false,
        ));
        return;
      }

      let stdout = '';
      let stderr = '';
      let outputTruncated = false;

      stream.on('data', (data: Buffer) => {
        if (stdout.length < DEFAULTS.MAX_OUTPUT_SIZE) {
          stdout += data.toString();
        } else if (!outputTruncated) {
          outputTruncated = true;
          logger.warn(`Output von ${host} überschreitet ${DEFAULTS.MAX_OUTPUT_SIZE / 1_000_000}MB – wird abgeschnitten`);
        }
      });

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
        // Stderr auf 100KB begrenzen
        if (stderr.length > 100_000) {
          stderr = stderr.substring(0, 100_000) + '\n[... truncated]';
        }
      });

      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code || 0 });
      });
    });
  });
}

// ─── Hauptfunktion: Gather-Script ausführen ──────────────────────────────

/**
 * Führt das Gather-Script auf einem Remote-Server aus und gibt das JSON zurück.
 * Mit Retry-Logik und strukturierter Fehlerbehandlung.
 */
export async function executeGatherScript(
  creds: SSHCredentials,
  opts: SSHExecOptions = {},
): Promise<any> {
  const timeout = opts.timeout || DEFAULTS.GATHER_TIMEOUT;
  const maxRetries = opts.maxRetries ?? DEFAULTS.MAX_RETRIES;
  const useSudo = opts.sudo ?? false;
  const gatherOpts = opts.gatherOptions;

  const script = generateGatherScript(gatherOpts);

  let lastError: SSHError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = DEFAULTS.RETRY_BASE_DELAY * Math.pow(2, attempt - 1);
      logger.info(`🔄 Retry ${attempt}/${maxRetries} für ${creds.host} in ${delay / 1000}s...`);
      await sleep(delay);
    }

    let conn: SSHClient | null = null;

    try {
      // 1. Verbinden
      logger.debug(`📡 SSH-Verbindung zu ${creds.host}:${creds.port} (Versuch ${attempt + 1})...`);
      conn = await createSSHConnection(creds, DEFAULTS.CONNECT_TIMEOUT);

      // 2. Script hochladen und ausführen
      const sudoPrefix = useSudo ? 'sudo ' : '';
      const uploadCmd = [
        `cat > ${REMOTE_SCRIPT_PATH} << 'SYSTEMMAP_GATHER_EOF'`,
        script,
        'SYSTEMMAP_GATHER_EOF',
        `chmod +x ${REMOTE_SCRIPT_PATH}`,
        `${sudoPrefix}bash ${REMOTE_SCRIPT_PATH}`,
        `rm -f ${REMOTE_SCRIPT_PATH}`,
      ].join('\n');

      logger.debug(`🔧 Führe Gather-Script auf ${creds.host} aus...`);
      const result = await execCommand(conn, uploadCmd, timeout, creds.host);

      // Verbindung sauber schließen
      conn.end();
      conn = null;

      // 3. Stderr loggen (wenn vorhanden)
      if (result.stderr) {
        const stderrPreview = result.stderr.substring(0, 500);
        logger.warn(`Gather-Script stderr von ${creds.host}: ${stderrPreview}`);
      }

      // 4. Exit-Code prüfen
      if (result.code !== 0) {
        throw new SSHError(
          `Gather-Script Exit-Code ${result.code} auf ${creds.host}: ${result.stderr.substring(0, 500)}`,
          SSHErrorCategory.SCRIPT_ERROR,
          creds.host,
          result.code === 137 || result.code === 124, // OOM kill oder timeout → retriable
        );
      }

      // 5. JSON parsen
      const jsonData = parseGatherOutput(result.stdout, creds.host, result.stderr);

      // 6. Basis-Validierung
      validateGatherData(jsonData, creds.host);

      logger.info(`✅ Gather-Script erfolgreich auf ${creds.host} (Versuch ${attempt + 1})`);
      return jsonData;

    } catch (err: any) {
      // Verbindung schließen wenn noch offen
      if (conn) {
        try { conn.end(); } catch { /* ignore */ }
      }

      // Fehler kategorisieren
      if (err instanceof SSHError) {
        lastError = err;
      } else {
        lastError = categorizeError(err, creds.host);
      }

      logger.warn(`⚠️ Versuch ${attempt + 1} fehlgeschlagen für ${creds.host}: ${lastError.message} [${lastError.category}]`);

      // Nicht-wiederholbare Fehler sofort abbrechen
      if (!lastError.retriable) {
        throw lastError;
      }
    }
  }

  // Alle Retries erschöpft
  throw lastError || new SSHError(
    `Alle ${maxRetries + 1} Versuche für ${creds.host} fehlgeschlagen`,
    SSHErrorCategory.UNKNOWN,
    creds.host,
    false,
  );
}

// ─── JSON-Parsing ────────────────────────────────────────────────────────

function parseGatherOutput(stdout: string, host: string, stderr?: string): any {
  // JSON-Anfang und -Ende finden (äußerstes {} Objekt)
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    const stderrHint = stderr ? `\nStderr: ${stderr.substring(0, 500)}` : '';
    const stdoutHint = stdout.length > 0 ? `\nStdout-Vorschau: ${stdout.substring(0, 300)}` : '';
    throw new SSHError(
      `Kein gültiges JSON in der Gather-Script-Ausgabe von ${host} (Stdout-Länge: ${stdout.length})${stderrHint}${stdoutHint}`,
      SSHErrorCategory.PARSE_ERROR,
      host,
      false,
    );
  }

  const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);

  try {
    return JSON.parse(jsonStr);
  } catch (parseErr: any) {
    // Versuchen, den Fehlerort zu finden
    const posMatch = parseErr.message.match(/position (\d+)/);
    const pos = posMatch ? parseInt(posMatch[1]) : -1;
    const context = pos >= 0
      ? `...${jsonStr.substring(Math.max(0, pos - 100), pos + 100)}...`
      : jsonStr.substring(0, 500);

    throw new SSHError(
      `JSON-Parse-Fehler bei ${host}: ${parseErr.message}\nKontext: ${context}`,
      SSHErrorCategory.PARSE_ERROR,
      host,
      false,
    );
  }
}

// ─── Validierung ─────────────────────────────────────────────────────────

function validateGatherData(data: any, host: string): void {
  // Mindestens OS-Daten müssen vorhanden sein
  if (!data.os) {
    throw new SSHError(
      `Gather-Daten von ${host} enthalten keine OS-Informationen`,
      SSHErrorCategory.PARSE_ERROR,
      host,
      false,
    );
  }

  // Warnung bei leeren Abschnitten (nicht fatal)
  const expectedSections = ['processes', 'listeners', 'sockets', 'mounts', 'interfaces'];
  for (const section of expectedSections) {
    if (!data[section] || (Array.isArray(data[section]) && data[section].length === 0)) {
      logger.warn(`⚠️ Gather-Daten von ${host}: Abschnitt "${section}" ist leer`);
    }
  }
}

// ─── Health-Check ────────────────────────────────────────────────────────

/**
 * Schneller SSH-Verbindungstest ohne Gather-Script.
 * Gibt Verbindungszeit in ms zurück oder wirft einen Fehler.
 */
export async function checkSSHHealth(creds: SSHCredentials): Promise<{ reachable: boolean; latencyMs: number; osInfo?: string }> {
  const startTime = Date.now();

  let conn: SSHClient | null = null;
  try {
    conn = await createSSHConnection(creds, 10_000);

    // Einfachen Befehl ausführen
    const result = await execCommand(conn, 'uname -a && hostname', 10_000, creds.host);
    conn.end();

    const latencyMs = Date.now() - startTime;
    return {
      reachable: true,
      latencyMs,
      osInfo: result.stdout.trim().split('\n')[0],
    };
  } catch (err) {
    if (conn) {
      try { conn.end(); } catch { /* ignore */ }
    }
    throw err;
  }
}

// ─── Beliebiges Skript auf Remote ausführen ──────────────────────────────

/**
 * Führt ein beliebiges Bash-Skript auf einem Remote-Server aus.
 * Nutzt dieselbe Upload+Execute-Logik wie executeGatherScript, aber
 * gibt das rohe stdout als String zurück (kein JSON-Parse).
 */
export async function executeRemoteScript(
  creds: SSHCredentials,
  script: string,
  opts?: { timeout?: number },
): Promise<string> {
  const timeout = opts?.timeout || 300_000; // 5 Minuten Default
  let conn: SSHClient | null = null;

  try {
    conn = await createSSHConnection(creds, DEFAULTS.CONNECT_TIMEOUT);

    const remotePath = '/tmp/.systemmap_configgather.sh';
    const uploadCmd = [
      `cat > ${remotePath} << 'SYSTEMMAP_CONFIGGATHER_EOF'`,
      script,
      'SYSTEMMAP_CONFIGGATHER_EOF',
      `chmod +x ${remotePath}`,
      `bash ${remotePath}`,
      `rm -f ${remotePath}`,
    ].join('\n');

    const result = await execCommand(conn, uploadCmd, timeout, creds.host);
    conn.end();
    conn = null;

    if (result.stderr) {
      logger.debug(`Remote-Script stderr von ${creds.host}: ${result.stderr.substring(0, 300)}`);
    }

    return result.stdout;
  } catch (err: any) {
    if (conn) { try { conn.end(); } catch {} }
    if (err instanceof SSHError) throw err;
    throw categorizeError(err, creds.host);
  }
}

/**
 * Führt einen einzelnen Befehl per SSH auf dem Zielserver aus.
 * Für Discovery-Commands (Phase 5.5).
 */
export async function executeRemoteCommand(
  creds: SSHCredentials,
  command: string,
  opts?: { timeout?: number },
): Promise<string> {
  const timeout = opts?.timeout || 30_000; // 30s Default
  let conn: SSHClient | null = null;

  try {
    conn = await createSSHConnection(creds, DEFAULTS.CONNECT_TIMEOUT);
    const result = await execCommand(conn, command, timeout, creds.host);
    conn.end();
    return result.stdout;
  } catch (err: any) {
    if (conn) { try { conn.end(); } catch {} }
    if (err instanceof SSHError) throw err;
    throw categorizeError(err, creds.host);
  }
}
