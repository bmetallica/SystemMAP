// ─── Dashboard Routes v2 ─────────────────────────────────────────────────
// Erweitert um: SSL-Warnings, Systemd-Failures, Disk-Alerts,
// Scan-History, Scheduler-Stats, Top-Server-Widgets

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { getSchedulerStats } from '../services/scheduler.service';
import { scanQueue, networkScanQueue } from '../queues';

const router = Router();
router.use(authenticate);

// ─── GET /api/dashboard ──────────────────────────────────────────────────
// Hauptendpunkt für das Dashboard mit allen Widgets
router.get('/', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalServers,
      onlineServers,
      offlineServers,
      discoveredServers,
      configuredServers,
      scanningServers,
      errorServers,
      totalServices,
      totalEdges,
      totalContainers,
      totalCronJobs,
      totalSystemdUnits,
      totalSslCerts,
      totalMounts,
      totalUserAccounts,
      recentScans,
      recentAudit,
      // SSL-Warnungen
      expiringSslCerts,
      expiredSslCerts,
      // Systemd-Failures
      failedSystemdUnits,
      // Disk-Alerts (> 90% Nutzung)
      criticalDisks,
      // Scan-Historie letzte 7 Tage
      recentNetScans,
      // Queue-Status
      scanWaiting,
      scanActive,
      netWaiting,
      netActive,
    ] = await Promise.all([
      prisma.server.count(),
      prisma.server.count({ where: { status: 'ONLINE' } }),
      prisma.server.count({ where: { status: 'OFFLINE' } }),
      prisma.server.count({ where: { status: 'DISCOVERED' } }),
      prisma.server.count({ where: { status: 'CONFIGURED' } }),
      prisma.server.count({ where: { status: 'SCANNING' } }),
      prisma.server.count({ where: { status: 'ERROR' } }),
      prisma.service.count(),
      prisma.connectionEdge.count(),
      prisma.dockerContainer.count(),
      prisma.cronJob.count(),
      prisma.systemdUnit.count(),
      prisma.sslCertificate.count(),
      prisma.mount.count(),
      prisma.userAccount.count(),
      prisma.networkScan.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 15,
        include: { user: { select: { username: true } } },
      }),
      // SSL-Zertifikate die in 30 Tagen ablaufen
      prisma.sslCertificate.findMany({
        where: {
          isExpired: false,
          daysLeft: { not: null, lte: 30 },
        },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
        orderBy: { daysLeft: 'asc' },
        take: 10,
      }),
      // Bereits abgelaufene SSL-Zertifikate
      prisma.sslCertificate.count({
        where: { isExpired: true },
      }),
      // Fehlgeschlagene Systemd-Units
      prisma.systemdUnit.findMany({
        where: { activeState: 'failed' },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
        take: 10,
      }),
      // Festplatten mit > 90% Nutzung
      prisma.mount.findMany({
        where: { usePct: { gte: 90 } },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
        orderBy: { usePct: 'desc' },
        take: 10,
      }),
      // Netzwerk-Scans der letzten 7 Tage
      prisma.networkScan.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // Queue-Status
      scanQueue.getWaitingCount(),
      scanQueue.getActiveCount(),
      networkScanQueue.getWaitingCount(),
      networkScanQueue.getActiveCount(),
    ]);

    // Scheduler-Statistiken
    const schedulerStats = getSchedulerStats();

    // ── AlertRule-Filter: deaktivierte Kategorien unterdrücken ──
    const alertRules = await prisma.alertRule.findMany({
      where: { category: { in: ['ssl', 'disk', 'systemd'] } },
      select: { category: true, enabled: true, condition: true },
    });

    // Prüfe ob ALLE Regeln einer Kategorie deaktiviert sind
    const sslRules = alertRules.filter(r => r.category === 'ssl');
    const diskRules = alertRules.filter(r => r.category === 'disk');
    const systemdRules = alertRules.filter(r => r.category === 'systemd');

    // SSL: getrennt nach expired (daysLeft=0) und expiring (daysLeft>0)
    const sslExpiredRuleEnabled = sslRules.some(r => {
      const cond = r.condition as any;
      return r.enabled && cond?.type === 'ssl_expiry' && (cond?.daysLeft === 0 || cond?.daysLeft === undefined);
    });
    const sslExpiringRuleEnabled = sslRules.some(r => {
      const cond = r.condition as any;
      return r.enabled && cond?.type === 'ssl_expiry' && (cond?.daysLeft ?? 0) > 0;
    });
    const anySslEnabled = sslRules.length === 0 || sslRules.some(r => r.enabled);
    const anyDiskEnabled = diskRules.length === 0 || diskRules.some(r => r.enabled);
    const anySystemdEnabled = systemdRules.length === 0 || systemdRules.some(r => r.enabled);

    // Letzte Scan-Ergebnisse pro Server (Top 5 zuletzt gescannt)
    const recentServerScans = await prisma.server.findMany({
      where: { lastScanAt: { not: null } },
      orderBy: { lastScanAt: 'desc' },
      take: 5,
      select: {
        id: true,
        ip: true,
        hostname: true,
        status: true,
        lastScanAt: true,
        lastScanError: true,
        _count: {
          select: {
            services: true,
            dockerContainers: true,
            processes: true,
          },
        },
      },
    });

    res.json({
      // ─── Server-Übersicht ────────────────────────────────────
      servers: {
        total: totalServers,
        online: onlineServers,
        offline: offlineServers,
        discovered: discoveredServers,
        configured: configuredServers,
        scanning: scanningServers,
        error: errorServers,
      },

      // ─── Ressourcen-Zähler ───────────────────────────────────
      resources: {
        services: totalServices,
        connections: totalEdges,
        containers: totalContainers,
        cronJobs: totalCronJobs,
        systemdUnits: totalSystemdUnits,
        sslCertificates: totalSslCerts,
        mounts: totalMounts,
        userAccounts: totalUserAccounts,
      },

      // ─── Warnungen / Alerts (respektiert deaktivierte AlertRules) ──
      alerts: {
        expiringSslCerts: sslExpiringRuleEnabled ? expiringSslCerts : [],
        expiredSslCertsCount: sslExpiredRuleEnabled ? expiredSslCerts : 0,
        failedSystemdUnits: anySystemdEnabled ? failedSystemdUnits : [],
        criticalDisks: anyDiskEnabled ? criticalDisks : [],
        staleScanCount: schedulerStats.staleScansDetected,
        failedScansLast24h: schedulerStats.failedScansLast24h,
      },

      // ─── Queue-Status ────────────────────────────────────────
      queues: {
        serverScans: { waiting: scanWaiting, active: scanActive },
        networkScans: { waiting: netWaiting, active: netActive },
      },

      // ─── Scheduler ──────────────────────────────────────────
      scheduler: schedulerStats,

      // ─── Letzte Aktivitäten ──────────────────────────────────
      recentScans,
      recentAudit,
      recentServerScans,
      recentNetScans,

      // ─── Legacy-Kompatibilität ──────────────────────────────
      services: totalServices,
      connections: totalEdges,
      containers: totalContainers,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dashboard/alerts ──────────────────────────────────────────
// Nur Warnungen und kritische Hinweise
router.get('/alerts', async (_req: Request, res: Response) => {
  try {
    const alerts: Array<{
      type: 'critical' | 'warning' | 'info';
      category: string;
      message: string;
      target?: string;
      targetId?: string;
    }> = [];

    // ── AlertRule-Filter laden ──
    const alertRules = await prisma.alertRule.findMany({
      where: { category: { in: ['ssl', 'disk', 'systemd'] } },
      select: { category: true, enabled: true, condition: true },
    });
    const sslRules = alertRules.filter(r => r.category === 'ssl');
    const sslExpiredEnabled = sslRules.length === 0 || sslRules.some(r => {
      const cond = r.condition as any;
      return r.enabled && cond?.type === 'ssl_expiry' && (cond?.daysLeft === 0 || cond?.daysLeft === undefined);
    });
    const sslExpiringEnabled = sslRules.length === 0 || sslRules.some(r => {
      const cond = r.condition as any;
      return r.enabled && cond?.type === 'ssl_expiry' && (cond?.daysLeft ?? 0) > 0;
    });
    const diskRules = alertRules.filter(r => r.category === 'disk');
    const anyDiskEnabled = diskRules.length === 0 || diskRules.some(r => r.enabled);
    const systemdRules = alertRules.filter(r => r.category === 'systemd');
    const anySystemdEnabled = systemdRules.length === 0 || systemdRules.some(r => r.enabled);

    // Abgelaufene SSL-Zertifikate (nur wenn Regel aktiv)
    if (sslExpiredEnabled) {
      const expiredCerts = await prisma.sslCertificate.findMany({
        where: { isExpired: true },
        include: { server: { select: { ip: true, hostname: true } } },
      });
      for (const cert of expiredCerts) {
        alerts.push({
          type: 'critical',
          category: 'SSL',
          message: `SSL-Zertifikat abgelaufen: ${cert.subject || cert.path}`,
          target: cert.server.hostname || cert.server.ip,
          targetId: cert.serverId,
        });
      }
    }

    // SSL-Zertifikate die bald ablaufen (nur wenn Regel aktiv)
    if (sslExpiringEnabled) {
      const expiringCerts = await prisma.sslCertificate.findMany({
        where: { isExpired: false, daysLeft: { not: null, lte: 30 } },
        include: { server: { select: { ip: true, hostname: true } } },
      });
      for (const cert of expiringCerts) {
        alerts.push({
          type: cert.daysLeft! <= 7 ? 'critical' : 'warning',
          category: 'SSL',
          message: `SSL-Zertifikat läuft in ${cert.daysLeft} Tagen ab: ${cert.subject || cert.path}`,
          target: cert.server.hostname || cert.server.ip,
          targetId: cert.serverId,
        });
      }
    }

    // Fehlgeschlagene Systemd-Units (nur wenn Regel aktiv)
    if (anySystemdEnabled) {
      const failedUnits = await prisma.systemdUnit.findMany({
        where: { activeState: 'failed' },
        include: { server: { select: { ip: true, hostname: true } } },
      });
      for (const unit of failedUnits) {
        alerts.push({
          type: 'critical',
          category: 'Systemd',
          message: `Dienst fehlgeschlagen: ${unit.name}`,
          target: unit.server.hostname || unit.server.ip,
          targetId: unit.serverId,
        });
      }
    }

    // Kritische Disk-Nutzung (nur wenn Regel aktiv)
    if (anyDiskEnabled) {
      const criticalDisks = await prisma.mount.findMany({
        where: { usePct: { gte: 90 } },
        include: { server: { select: { ip: true, hostname: true } } },
      });
      for (const disk of criticalDisks) {
        alerts.push({
          type: disk.usePct! >= 95 ? 'critical' : 'warning',
          category: 'Disk',
          message: `Festplatte ${disk.mountPoint} zu ${disk.usePct}% voll`,
          target: disk.server.hostname || disk.server.ip,
          targetId: disk.serverId,
        });
      }
    }

    // Server mit Fehlern
    const errorServers = await prisma.server.findMany({
      where: { status: 'ERROR' },
      select: { id: true, ip: true, hostname: true, lastScanError: true },
    });
    for (const server of errorServers) {
      alerts.push({
        type: 'warning',
        category: 'Scan',
        message: `Scan-Fehler: ${server.lastScanError || 'Unbekannter Fehler'}`,
        target: server.hostname || server.ip,
        targetId: server.id,
      });
    }

    // Sortieren: critical > warning > info
    const priority = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => priority[a.type] - priority[b.type]);

    res.json({ alerts, total: alerts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/dashboard/scan-history ────────────────────────────────────
// Scan-Verlauf für Charts
router.get('/scan-history', async (_req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Server-Scan-Historie (basierend auf Audit-Logs)
    const scanLogs = await prisma.auditLog.findMany({
      where: {
        action: {
          in: [
            'SCAN_TRIGGERED',
            'SCHEDULED_SCAN_TRIGGERED',
            'MANUAL_SCAN_TRIGGERED',
            'NETWORK_SCAN_TRIGGERED',
            'SCHEDULED_NETWORK_SCAN_TRIGGERED',
          ],
        },
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
      select: { action: true, createdAt: true },
    });

    // Gruppiere nach Tag
    const dailyStats = new Map<string, { serverScans: number; networkScans: number }>();

    for (const log of scanLogs) {
      const day = log.createdAt.toISOString().split('T')[0];
      const entry = dailyStats.get(day) || { serverScans: 0, networkScans: 0 };

      if (log.action.includes('NETWORK')) {
        entry.networkScans++;
      } else {
        entry.serverScans++;
      }

      dailyStats.set(day, entry);
    }

    const history = Array.from(dailyStats.entries()).map(([date, counts]) => ({
      date,
      ...counts,
    }));

    res.json({ history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
