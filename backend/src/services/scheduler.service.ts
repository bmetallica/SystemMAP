// ─── Scheduler-Service v2 ─────────────────────────────────────────────────
// Erweiterter Scheduler mit:
// - Schedule-Management (CRUD)
// - Scan-History Tracking
// - Health-Monitoring (stale scans, failed scans)
// - Auto-Discovery Scheduling

import cron from 'node-cron';
import { PrismaClient, ServerStatus, NetworkScanStatus } from '@prisma/client';
import { scanQueue, networkScanQueue } from '../queues';
import { logger } from '../logger';

const prisma = new PrismaClient();

// Map von key → cron.ScheduledTask
const activeSchedules = new Map<string, cron.ScheduledTask>();

// ─── Scheduler-Statistiken (für Dashboard-Widgets) ───────────────────────
export interface SchedulerStats {
  activeServerSchedules: number;
  activeNetworkSchedules: number;
  totalScansTriggered: number;
  lastSyncAt: Date | null;
  staleScansDetected: number;
  failedScansLast24h: number;
  upcomingScans: Array<{
    type: 'server' | 'network';
    target: string;
    schedule: string;
    id: string;
  }>;
}

let schedulerStats: SchedulerStats = {
  activeServerSchedules: 0,
  activeNetworkSchedules: 0,
  totalScansTriggered: 0,
  lastSyncAt: null,
  staleScansDetected: 0,
  failedScansLast24h: 0,
  upcomingScans: [],
};

/**
 * Gibt aktuelle Scheduler-Statistiken zurück
 */
export function getSchedulerStats(): SchedulerStats {
  return { ...schedulerStats };
}

/**
 * Gibt alle aktiven Schedule-Keys zurück
 */
export function getActiveScheduleKeys(): string[] {
  return Array.from(activeSchedules.keys());
}

/**
 * Startet den Scheduler-Dienst.
 */
export function startScheduler(): void {
  logger.info('⏰ Scheduler-Service v2 gestartet');

  // Schedules alle 60 Sekunden synchronisieren
  cron.schedule('* * * * *', async () => {
    await syncSchedules();
  });

  // Stale-Scan-Detection alle 5 Minuten
  cron.schedule('*/5 * * * *', async () => {
    await detectStaleScans();
  });

  // Health-Monitoring alle 15 Minuten
  cron.schedule('*/15 * * * *', async () => {
    await updateHealthStats();
  });

  // Initial ausführen
  syncSchedules();
  updateHealthStats();
}

/**
 * Synchronisiert Schedules aus der Datenbank
 */
async function syncSchedules(): Promise<void> {
  try {
    const upcomingScans: typeof schedulerStats.upcomingScans = [];

    // ─── Server-Scan Schedules ────────────────────────────────────
    const scheduledServers = await prisma.server.findMany({
      where: {
        scanSchedule: { not: null },
        sshUser: { not: null },
        sshPasswordEncrypted: { not: null },
      },
      select: { id: true, ip: true, hostname: true, scanSchedule: true, status: true },
    });

    const activeKeys = new Set<string>();
    let serverScheduleCount = 0;

    for (const server of scheduledServers) {
      activeKeys.add(server.id);
      serverScheduleCount++;

      upcomingScans.push({
        type: 'server',
        target: server.hostname || server.ip,
        schedule: server.scanSchedule!,
        id: server.id,
      });

      // Nur neue Schedules registrieren
      if (activeSchedules.has(server.id)) continue;

      if (!server.scanSchedule || !cron.validate(server.scanSchedule)) {
        logger.warn(`Ungültiger Cron-Ausdruck für Server ${server.ip}: ${server.scanSchedule}`);
        continue;
      }

      const task = cron.schedule(server.scanSchedule, async () => {
        const current = await prisma.server.findUnique({
          where: { id: server.id },
          select: { status: true, ip: true },
        });

        if (current?.status === ServerStatus.SCANNING) {
          logger.debug(`⏭️  Scan für ${current.ip} übersprungen – läuft bereits`);
          return;
        }

        logger.info(`⏰ Geplanter Scan für ${server.ip} wird gestartet`);

        await scanQueue.add('server-scan', {
          serverId: server.id,
          triggeredBy: 'scheduler',
        }, {
          jobId: `scheduled-scan-${server.id}-${Date.now()}`,
          attempts: 2,
          backoff: { type: 'exponential', delay: 5000 },
        });

        await prisma.server.update({
          where: { id: server.id },
          data: { status: ServerStatus.SCANNING },
        });

        await prisma.auditLog.create({
          data: {
            action: 'SCHEDULED_SCAN_TRIGGERED',
            target: `server:${server.id}`,
            details: { ip: server.ip, schedule: server.scanSchedule },
          },
        });

        schedulerStats.totalScansTriggered++;
      });

      activeSchedules.set(server.id, task);
      logger.info(`⏰ Scan-Schedule registriert: ${server.ip} (${server.scanSchedule})`);
    }

    // ─── Network-Scan Schedules ──────────────────────────────────
    const scheduledNetScans = await prisma.networkScan.findMany({
      where: { schedule: { not: null } },
      select: { id: true, subnet: true, schedule: true },
    });

    let networkScheduleCount = 0;

    // Nur unique Subnets + Schedules (der letzte Scan mit Schedule zählt)
    const uniqueNetSchedules = new Map<string, typeof scheduledNetScans[0]>();
    for (const scan of scheduledNetScans) {
      const key = `${scan.subnet}:${scan.schedule}`;
      uniqueNetSchedules.set(key, scan);
    }

    for (const [, scan] of uniqueNetSchedules) {
      const scheduleKey = `net-${scan.subnet}-${scan.schedule}`;
      activeKeys.add(scheduleKey);
      networkScheduleCount++;

      upcomingScans.push({
        type: 'network',
        target: scan.subnet,
        schedule: scan.schedule!,
        id: scan.id,
      });

      if (activeSchedules.has(scheduleKey)) continue;

      if (!scan.schedule || !cron.validate(scan.schedule)) continue;

      const task = cron.schedule(scan.schedule, async () => {
        logger.info(`⏰ Geplanter Netzwerkscan für ${scan.subnet} wird gestartet`);

        const newScan = await prisma.networkScan.create({
          data: { subnet: scan.subnet, schedule: scan.schedule },
        });

        await networkScanQueue.add('network-scan', {
          scanId: newScan.id,
          subnet: scan.subnet,
          triggeredBy: 'scheduler',
        });

        await prisma.auditLog.create({
          data: {
            action: 'SCHEDULED_NETWORK_SCAN_TRIGGERED',
            target: `network_scan:${newScan.id}`,
            details: { subnet: scan.subnet, schedule: scan.schedule },
          },
        });

        schedulerStats.totalScansTriggered++;
      });

      activeSchedules.set(scheduleKey, task);
      logger.info(`⏰ Netzwerkscan-Schedule registriert: ${scan.subnet} (${scan.schedule})`);
    }

    // Entfernte Schedules stoppen
    for (const [key, task] of activeSchedules.entries()) {
      if (!activeKeys.has(key)) {
        task.stop();
        activeSchedules.delete(key);
        logger.info(`⏰ Schedule entfernt: ${key}`);
      }
    }

    // Stats aktualisieren
    schedulerStats.activeServerSchedules = serverScheduleCount;
    schedulerStats.activeNetworkSchedules = networkScheduleCount;
    schedulerStats.lastSyncAt = new Date();
    schedulerStats.upcomingScans = upcomingScans;

  } catch (err: any) {
    logger.error(`Scheduler-Fehler: ${err.message}`);
  }
}

/**
 * Erkennt Scans die seit > 30 Minuten im Status SCANNING hängen
 * und setzt sie auf ERROR zurück.
 */
async function detectStaleScans(): Promise<void> {
  try {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);

    // Stale Server-Scans
    const staleServers = await prisma.server.findMany({
      where: {
        status: ServerStatus.SCANNING,
        updatedAt: { lt: thirtyMinAgo },
      },
    });

    for (const server of staleServers) {
      logger.warn(`⚠️ Stale Scan erkannt: Server ${server.ip} seit > 30 Min im SCANNING-Status`);

      await prisma.server.update({
        where: { id: server.id },
        data: {
          status: ServerStatus.ERROR,
          lastScanError: 'Scan-Timeout: Scan lief länger als 30 Minuten und wurde abgebrochen',
        },
      });

      await prisma.auditLog.create({
        data: {
          action: 'STALE_SCAN_DETECTED',
          target: `server:${server.id}`,
          details: { ip: server.ip, staleSince: server.updatedAt },
        },
      });
    }

    // Stale Network-Scans
    const staleNetScans = await prisma.networkScan.findMany({
      where: {
        status: NetworkScanStatus.RUNNING,
        startedAt: { lt: thirtyMinAgo },
      },
    });

    for (const scan of staleNetScans) {
      logger.warn(`⚠️ Stale Netzwerkscan erkannt: ${scan.subnet}`);

      await prisma.networkScan.update({
        where: { id: scan.id },
        data: {
          status: NetworkScanStatus.FAILED,
          finishedAt: new Date(),
          error: 'Scan-Timeout: Scan lief länger als 30 Minuten',
        },
      });
    }

    schedulerStats.staleScansDetected = staleServers.length + staleNetScans.length;

  } catch (err: any) {
    logger.error(`Stale-Scan-Detection Fehler: ${err.message}`);
  }
}

/**
 * Aktualisiert Health-Statistiken
 */
async function updateHealthStats(): Promise<void> {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const failedServers = await prisma.server.count({
      where: {
        status: ServerStatus.ERROR,
        updatedAt: { gte: twentyFourHoursAgo },
      },
    });

    const failedNetScans = await prisma.networkScan.count({
      where: {
        status: NetworkScanStatus.FAILED,
        createdAt: { gte: twentyFourHoursAgo },
      },
    });

    schedulerStats.failedScansLast24h = failedServers + failedNetScans;

  } catch (err: any) {
    logger.error(`Health-Stats Fehler: ${err.message}`);
  }
}
