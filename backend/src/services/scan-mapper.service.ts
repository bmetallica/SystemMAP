// ─── Scan Data Mapper v2 (Etappe 2) ──────────────────────────────────────
// Mappt die rohen JSON-Daten vom Gather-Script v2 in alle Prisma-Tabellen.
// Verarbeitung in einer Transaktion mit optimierten Batch-Operationen.

import { PrismaClient, Prisma, ServerStatus } from '@prisma/client';
import { logger } from '../logger';

const prisma = new PrismaClient();

// ─── Typen für sichere Datenextraktion ───────────────────────────────────

type PrismaTransaction = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

interface MapperStats {
  processes: number;
  services: number;
  mounts: number;
  interfaces: number;
  dockerContainers: number;
  cronJobs: number;
  systemdUnits: number;
  sslCertificates: number;
  lvmVolumes: number;
  userAccounts: number;
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────

/** Sicherer parseInt mit Fallback */
function safeInt(val: any, fallback: number = 0): number {
  const n = parseInt(String(val), 10);
  return isNaN(n) ? fallback : n;
}

/** Sicherer parseFloat mit Fallback */
function safeFloat(val: any, fallback: number = 0): number {
  const n = parseFloat(String(val));
  return isNaN(n) ? fallback : n;
}

/** String kürzen */
function truncate(s: any, maxLen: number = 500): string | null {
  if (s == null) return null;
  const str = String(s);
  return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}

/** Datum parsen (SSL-Zertifikate) */
function parseDate(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Hauptfunktion ───────────────────────────────────────────────────────

/**
 * Verarbeitet die Gather-Script-Daten und schreibt sie in die Datenbank.
 * Alle Operationen in einer Transaktion.
 */
export async function mapScanDataToDb(serverId: string, rawData: any): Promise<MapperStats> {
  logger.info(`📦 Mapping Scan-Daten für Server ${serverId}...`);

  const stats: MapperStats = {
    processes: 0,
    services: 0,
    mounts: 0,
    interfaces: 0,
    dockerContainers: 0,
    cronJobs: 0,
    systemdUnits: 0,
    sslCertificates: 0,
    lvmVolumes: 0,
    userAccounts: 0,
  };

  await prisma.$transaction(async (tx) => {
    // ─── 1. OS-Info & Server-Metadaten ─────────────────────────────
    await mapOsInfo(tx, serverId, rawData);

    // ─── 2. Prozesse ───────────────────────────────────────────────
    stats.processes = await mapProcesses(tx, serverId, rawData);

    // ─── 3. Services (aus Listeners) ───────────────────────────────
    stats.services = await mapServices(tx, serverId, rawData);

    // ─── 4. Mounts ─────────────────────────────────────────────────
    stats.mounts = await mapMounts(tx, serverId, rawData);

    // ─── 5. Netzwerk-Interfaces ────────────────────────────────────
    stats.interfaces = await mapInterfaces(tx, serverId, rawData);

    // ─── 6. Docker-Container ───────────────────────────────────────
    stats.dockerContainers = await mapDockerContainers(tx, serverId, rawData);

    // ─── 7. Cron-Jobs ──────────────────────────────────────────────
    stats.cronJobs = await mapCronJobs(tx, serverId, rawData);

    // ─── 8. Systemd-Units ──────────────────────────────────────────
    stats.systemdUnits = await mapSystemdUnits(tx, serverId, rawData);

    // ─── 9. SSL-Zertifikate ────────────────────────────────────────
    stats.sslCertificates = await mapSslCertificates(tx, serverId, rawData);

    // ─── 10. LVM-Volumes ──────────────────────────────────────────
    stats.lvmVolumes = await mapLvmVolumes(tx, serverId, rawData);

    // ─── 11. Benutzer-Accounts ────────────────────────────────────
    stats.userAccounts = await mapUserAccounts(tx, serverId, rawData);
    // ─── 12. Server-Logs ──────────────────────────────────────
    await mapServerLogs(tx, serverId, rawData);  }, {
    maxWait: 10000,  // 10s max warten auf Transaktion
    timeout: 60000,  // 60s max Transaktionsdauer
  });

  logger.info(
    `✅ Scan-Daten gemappt für Server ${serverId}: ` +
    `${stats.processes} Prozesse, ${stats.services} Services, ` +
    `${stats.mounts} Mounts, ${stats.interfaces} Interfaces, ` +
    `${stats.dockerContainers} Container, ${stats.cronJobs} Cron-Jobs, ` +
    `${stats.systemdUnits} Systemd-Units, ${stats.sslCertificates} Zertifikate, ` +
    `${stats.lvmVolumes} LVM-Volumes, ${stats.userAccounts} User-Accounts`
  );

  return stats;
}

// ═══════════════════════════════════════════════════════════════════════════
// Einzelne Mapper
// ═══════════════════════════════════════════════════════════════════════════

async function mapOsInfo(tx: PrismaTransaction, serverId: string, rawData: any): Promise<void> {
  const os = rawData.os || {};

  await tx.server.update({
    where: { id: serverId },
    data: {
      hostname: os.hostname || undefined,
      osInfo: os.os_pretty || undefined,
      kernelInfo: os.kernel || undefined,
      cpuInfo: os.cpu_model
        ? `${os.cpu_model} (${os.cpu_cores || '?'} Cores, ${os.cpu_threads || '?'} Threads, ${os.cpu_sockets || 1} Socket(s))`
        : undefined,
      memoryMb: safeInt(os.memory_total_mb) || undefined,
      rawScanData: rawData as Prisma.InputJsonValue,
      lastScanAt: new Date(),
      lastScanError: null,
      status: ServerStatus.ONLINE,
    },
  });
}

async function mapProcesses(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.process.deleteMany({ where: { serverId } });

  const processes = rawData.processes || [];
  if (processes.length === 0) return 0;

  // In Batches von 200 einfügen (Prisma-Limit)
  const batchSize = 200;
  let total = 0;

  for (let i = 0; i < processes.length; i += batchSize) {
    const batch = processes.slice(i, i + batchSize);
    const data = batch
      .filter((p: any) => p.pid != null)
      .map((p: any) => ({
        serverId,
        pid: safeInt(p.pid),
        ppid: safeInt(p.ppid) || null,
        user: truncate(p.user, 64) || null,
        cpuPct: safeFloat(p.cpu),
        memPct: safeFloat(p.mem),
        vsizeMb: safeFloat(p.vsize_mb) || null,
        rssMb: safeFloat(p.rss_mb) || null,
        command: truncate(p.command, 255) || null,
        fullPath: truncate(p.full_path, 500) || null,
        args: truncate(p.args, 500) || null,
        cgroup: truncate(p.cgroup, 200) || null,
        threads: safeInt(p.threads) || null,
        fdCount: safeInt(p.fd_count) || null,
        startTime: truncate(p.start_time, 64) || null,
      }));

    if (data.length > 0) {
      await tx.process.createMany({ data, skipDuplicates: true });
      total += data.length;
    }
  }

  return total;
}

async function mapServices(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.service.deleteMany({ where: { serverId } });

  const listeners = rawData.listeners || [];
  if (listeners.length === 0) return 0;

  // Duplikate entfernen (gleicher Process + Port + Protocol)
  const seen = new Set<string>();
  const uniqueListeners = listeners.filter((l: any) => {
    const key = `${l.process || 'unknown'}:${l.port}:${l.protocol || 'tcp'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const data = uniqueListeners.map((l: any) => ({
    serverId,
    name: l.process || 'unknown',
    port: safeInt(l.port) || null,
    protocol: l.protocol || 'tcp',
    bindAddress: l.bind || null,
    state: 'ACTIVE' as const,
    pid: safeInt(l.pid) || null,
  }));

  if (data.length > 0) {
    await tx.service.createMany({ data, skipDuplicates: true });
  }

  return data.length;
}

async function mapMounts(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.mount.deleteMany({ where: { serverId } });

  const mounts = rawData.mounts || [];
  if (mounts.length === 0) return 0;

  const data = mounts.map((m: any) => ({
    serverId,
    device: m.device || 'unknown',
    mountPoint: m.mount_point || '/',
    fsType: m.fs_type || 'unknown',
    sizeMb: safeInt(m.size_mb) || null,
    usedMb: safeInt(m.used_mb) || null,
    availMb: safeInt(m.avail_mb) || null,
    usePct: safeFloat(m.use_pct) || null,
  }));

  await tx.mount.createMany({ data, skipDuplicates: true });
  return data.length;
}

async function mapInterfaces(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.networkInterface.deleteMany({ where: { serverId } });

  const interfaces = rawData.interfaces || [];
  if (interfaces.length === 0) return 0;

  const data = interfaces.map((i: any) => ({
    serverId,
    name: i.name || 'unknown',
    ipAddr: i.ip || null,
    macAddr: i.mac || null,
    state: i.state || null,
    mtu: safeInt(i.mtu) || null,
    speed: i.speed || null,
    rxBytes: i.rx_bytes ? BigInt(i.rx_bytes) : null,
    txBytes: i.tx_bytes ? BigInt(i.tx_bytes) : null,
  }));

  await tx.networkInterface.createMany({ data, skipDuplicates: true });
  return data.length;
}

async function mapDockerContainers(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.dockerContainer.deleteMany({ where: { serverId } });

  const containers = rawData.docker_containers || [];
  if (containers.length === 0) return 0;

  const data = containers
    .filter((c: any) => c.id || c.name)
    .map((c: any) => ({
      serverId,
      containerId: c.id || 'unknown',
      name: c.name || 'unknown',
      image: c.image || 'unknown',
      state: c.state || 'unknown',
      ports: c.ports ? (c.ports as Prisma.InputJsonValue) : Prisma.JsonNull,
      networks: c.networks ? (c.networks as Prisma.InputJsonValue) : Prisma.JsonNull,
      envVars: c.env_vars ? (c.env_vars as Prisma.InputJsonValue) : Prisma.JsonNull,
      volumes: c.mounts ? (c.mounts as Prisma.InputJsonValue) : Prisma.JsonNull,
    }));

  if (data.length > 0) {
    await tx.dockerContainer.createMany({ data, skipDuplicates: true });
  }

  return data.length;
}

async function mapCronJobs(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.cronJob.deleteMany({ where: { serverId } });

  const cronJobs = rawData.cron_jobs || [];
  if (cronJobs.length === 0) return 0;

  const data = cronJobs
    .filter((c: any) => c.command)
    .map((c: any) => ({
      serverId,
      user: c.user || 'root',
      schedule: c.schedule || '* * * * *',
      command: truncate(c.command, 1000) || '',
      source: c.source || null,
    }));

  if (data.length > 0) {
    await tx.cronJob.createMany({ data, skipDuplicates: true });
  }

  return data.length;
}

async function mapSystemdUnits(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.systemdUnit.deleteMany({ where: { serverId } });

  const units = rawData.systemd_units || [];
  if (units.length === 0) return 0;

  // Nur aktive/failed Units (nicht alle 200+)
  const relevantUnits = units.filter((u: any) =>
    u.active_state === 'active' || u.active_state === 'failed'
  );

  const data = relevantUnits.map((u: any) => ({
    serverId,
    name: u.name || 'unknown',
    unitType: 'service',
    activeState: u.active_state || 'unknown',
    subState: u.sub_state || null,
    description: truncate(u.description, 255) || null,
    execStart: truncate(u.exec_start, 500) || null,
    mainPid: safeInt(u.main_pid) || null,
    memoryMb: u.memory_mb != null ? safeFloat(u.memory_mb) : null,
    cpuUsageSec: u.cpu_usage_sec != null ? safeFloat(u.cpu_usage_sec) : null,
    enabled: u.enabled ?? false,
  }));

  // In Batches einfügen
  const batchSize = 200;
  let total = 0;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    await tx.systemdUnit.createMany({ data: batch, skipDuplicates: true });
    total += batch.length;
  }

  return total;
}

async function mapSslCertificates(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.sslCertificate.deleteMany({ where: { serverId } });

  const certs = rawData.ssl_certificates || [];
  if (certs.length === 0) return 0;

  const data = certs
    .filter((c: any) => c.path)
    .map((c: any) => ({
      serverId,
      path: c.path,
      subject: truncate(c.subject, 500) || null,
      issuer: truncate(c.issuer, 500) || null,
      validFrom: parseDate(c.valid_from),
      validTo: parseDate(c.valid_to),
      serial: c.serial || null,
      sanDomains: c.san_domains ? (c.san_domains as Prisma.InputJsonValue) : Prisma.JsonNull,
      isExpired: c.is_expired ?? false,
      daysLeft: safeInt(c.days_left) || null,
    }));

  if (data.length > 0) {
    await tx.sslCertificate.createMany({ data, skipDuplicates: true });
  }

  return data.length;
}

async function mapLvmVolumes(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.lvmVolume.deleteMany({ where: { serverId } });

  const lvm = rawData.lvm || {};
  const lvs = lvm.logical_volumes || [];
  if (lvs.length === 0) return 0;

  // Mounts zum Zuordnen von Mountpoints laden
  const mountMap = new Map<string, { mountPoint: string; fsType: string }>();
  for (const m of (rawData.mounts || [])) {
    if (m.device) {
      mountMap.set(m.device, { mountPoint: m.mount_point, fsType: m.fs_type });
    }
  }

  const data = lvs.map((lv: any) => {
    const mountInfo = mountMap.get(lv.lv_path);
    return {
      serverId,
      vgName: lv.vg_name || 'unknown',
      lvName: lv.lv_name || 'unknown',
      lvPath: lv.lv_path || '/dev/unknown',
      sizeMb: safeInt(lv.size_mb) || null,
      mountPoint: mountInfo?.mountPoint || null,
      fsType: mountInfo?.fsType || null,
      isActive: lv.active !== false,
    };
  });

  if (data.length > 0) {
    await tx.lvmVolume.createMany({ data, skipDuplicates: true });
  }

  return data.length;
}

async function mapUserAccounts(tx: PrismaTransaction, serverId: string, rawData: any): Promise<number> {
  await tx.userAccount.deleteMany({ where: { serverId } });

  const users = rawData.user_accounts || [];
  if (users.length === 0) return 0;

  const data = users.map((u: any) => ({
    serverId,
    username: u.username || 'unknown',
    uid: safeInt(u.uid),
    gid: safeInt(u.gid),
    shell: u.shell || null,
    homeDir: u.home_dir || null,
    groups: u.groups ? (u.groups as Prisma.InputJsonValue) : Prisma.JsonNull,
    hasLogin: u.has_login ?? false,
    lastLogin: u.last_login || null,
  }));

  if (data.length > 0) {
    await tx.userAccount.createMany({ data, skipDuplicates: true });
  }

  return data.length;
}

async function mapServerLogs(tx: PrismaTransaction, serverId: string, rawData: any): Promise<void> {
  const logs = rawData.logs;
  if (!logs) return;

  // Alte Log-Einträge löschen (nur den letzten behalten)
  await tx.serverLogEntry.deleteMany({ where: { serverId } });

  await tx.serverLogEntry.create({
    data: {
      serverId,
      journaldErrors: truncate(logs.journald_errors, 50000) || null,
      dmesgErrors: truncate(logs.dmesg_errors, 30000) || null,
      syslogErrors: truncate(logs.syslog_errors, 30000) || null,
      authErrors: truncate(logs.auth_errors, 20000) || null,
      oomEvents: truncate(logs.oom_events, 10000) || null,
      appLogs: logs.app_logs && Object.keys(logs.app_logs).length > 0
        ? (logs.app_logs as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
  });

  const appLogCount = logs.app_logs ? Object.keys(logs.app_logs).length : 0;
  logger.info(`📝 Server-Logs gespeichert: journald=${!!logs.journald_errors}, dmesg=${!!logs.dmesg_errors}, apps=${appLogCount}`);
}
