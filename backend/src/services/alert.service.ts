// ─── Alert-Service (Etappe 4) ────────────────────────────────────────────
// Regelbasierte Alarmierung für Server-Infrastruktur-Änderungen.
// Evaluiert Regeln nach jedem Scan und erzeugt Alerts.

import { PrismaClient } from '@prisma/client';
import { logger } from '../logger';

const prisma = new PrismaClient();

// ─── Typen ───────────────────────────────────────────────────────────────

interface AlertCondition {
  type: string;           // diff_count, ssl_expiry, disk_usage, systemd_failed, service_missing, custom
  threshold?: number;     // Schwellwert
  category?: string;      // Für diff: services, mounts, etc.
  changeType?: string;    // ADDED, REMOVED, MODIFIED
  serviceName?: string;   // Für service_missing
  mountPoint?: string;    // Für disk_usage
  daysLeft?: number;      // Für ssl_expiry
}

interface EvalContext {
  serverId: string;
  diffCount?: number;
  diffs?: any[];
}

// ─── Default-Regeln erstellen ────────────────────────────────────────────

export async function ensureDefaultRules(): Promise<void> {
  const count = await prisma.alertRule.count();
  if (count > 0) return;

  const defaultRules = [
    {
      name: 'SSL-Zertifikat läuft bald ab',
      description: 'Warnung wenn ein SSL-Zertifikat in weniger als 30 Tagen abläuft',
      category: 'ssl',
      condition: { type: 'ssl_expiry', daysLeft: 30 } as any,
      severity: 'WARNING',
      cooldownMin: 1440, // 24h
    },
    {
      name: 'SSL-Zertifikat abgelaufen',
      description: 'Kritischer Alarm bei abgelaufenem SSL-Zertifikat',
      category: 'ssl',
      condition: { type: 'ssl_expiry', daysLeft: 0 } as any,
      severity: 'CRITICAL',
      cooldownMin: 1440,
    },
    {
      name: 'Disk-Auslastung kritisch',
      description: 'Alarm wenn eine Partition über 90% belegt ist',
      category: 'disk',
      condition: { type: 'disk_usage', threshold: 90 } as any,
      severity: 'CRITICAL',
      cooldownMin: 60,
    },
    {
      name: 'Disk-Auslastung hoch',
      description: 'Warnung wenn eine Partition über 80% belegt ist',
      category: 'disk',
      condition: { type: 'disk_usage', threshold: 80 } as any,
      severity: 'WARNING',
      cooldownMin: 360,
    },
    {
      name: 'Systemd-Unit fehlgeschlagen',
      description: 'Alarm wenn eine Systemd-Unit im Status "failed" ist',
      category: 'systemd',
      condition: { type: 'systemd_failed' } as any,
      severity: 'CRITICAL',
      cooldownMin: 30,
    },
    {
      name: 'Neuer Benutzer hinzugefügt',
      description: 'Warnung bei neuen Benutzer-Accounts mit Login-Shell',
      category: 'diff',
      condition: { type: 'diff_count', category: 'userAccounts', changeType: 'ADDED', threshold: 1 } as any,
      severity: 'WARNING',
      cooldownMin: 60,
    },
    {
      name: 'Service entfernt',
      description: 'Warnung wenn ein Service nicht mehr gefunden wird',
      category: 'diff',
      condition: { type: 'diff_count', category: 'services', changeType: 'REMOVED', threshold: 1 } as any,
      severity: 'WARNING',
      cooldownMin: 60,
    },
    {
      name: 'Docker-Container-Änderung',
      description: 'Info bei Änderungen an Docker-Containern',
      category: 'diff',
      condition: { type: 'diff_count', category: 'dockerContainers', threshold: 1 } as any,
      severity: 'INFO',
      cooldownMin: 30,
    },
  ];

  await prisma.alertRule.createMany({ data: defaultRules });
  logger.info(`📋 ${defaultRules.length} Standard-Alertregeln erstellt`);
}

// ─── Regel-Evaluation ────────────────────────────────────────────────────

async function evaluateRule(
  rule: any,
  serverId: string,
  context: EvalContext,
): Promise<{ triggered: boolean; title: string; message: string; metadata?: any }> {
  const condition = rule.condition as AlertCondition;

  switch (condition.type) {
    case 'ssl_expiry': {
      const threshold = condition.daysLeft ?? 30;
      const certs = await prisma.sslCertificate.findMany({
        where: {
          serverId,
          ...(threshold === 0
            ? { isExpired: true }
            : {
                daysLeft: { lte: threshold },
                isExpired: false,
              }),
        },
      });
      if (certs.length > 0) {
        const certNames = certs.map(c => c.subject || c.path).join(', ');
        return {
          triggered: true,
          title: threshold === 0
            ? `SSL-Zertifikat abgelaufen auf Server`
            : `SSL-Zertifikat läuft in ≤${threshold} Tagen ab`,
          message: `${certs.length} Zertifikat(e) betroffen: ${certNames}`,
          metadata: { certificates: certs.map(c => ({ path: c.path, daysLeft: c.daysLeft, subject: c.subject })) },
        };
      }
      break;
    }

    case 'disk_usage': {
      const threshold = condition.threshold ?? 90;
      const mounts = await prisma.mount.findMany({
        where: {
          serverId,
          usePct: { gte: threshold },
        },
      });
      if (mounts.length > 0) {
        return {
          triggered: true,
          title: `Disk-Auslastung ≥${threshold}%`,
          message: mounts.map(m => `${m.mountPoint}: ${m.usePct}%`).join(', '),
          metadata: { mounts: mounts.map(m => ({ mountPoint: m.mountPoint, usePct: m.usePct, usedMb: m.usedMb, sizeMb: m.sizeMb })) },
        };
      }
      break;
    }

    case 'systemd_failed': {
      const failed = await prisma.systemdUnit.findMany({
        where: { serverId, activeState: 'failed' },
      });
      if (failed.length > 0) {
        return {
          triggered: true,
          title: `Systemd-Units fehlgeschlagen`,
          message: `${failed.length} Unit(s): ${failed.map(u => u.name).join(', ')}`,
          metadata: { units: failed.map(u => ({ name: u.name, subState: u.subState })) },
        };
      }
      break;
    }

    case 'diff_count': {
      if (!context.diffs) break;
      const threshold = condition.threshold ?? 1;
      let matchingDiffs = context.diffs;

      if (condition.category) {
        matchingDiffs = matchingDiffs.filter(d => d.category === condition.category);
      }
      if (condition.changeType) {
        matchingDiffs = matchingDiffs.filter(d => d.changeType === condition.changeType);
      }

      if (matchingDiffs.length >= threshold) {
        return {
          triggered: true,
          title: `${matchingDiffs.length} Änderung(en) erkannt [${condition.category || 'alle'}]`,
          message: matchingDiffs.slice(0, 5).map(d =>
            `${d.changeType}: ${d.itemKey}`
          ).join('; '),
          metadata: { diffs: matchingDiffs.slice(0, 10) },
        };
      }
      break;
    }

    case 'service_missing': {
      if (!condition.serviceName) break;
      const exists = await prisma.service.count({
        where: { serverId, name: condition.serviceName },
      });
      if (exists === 0) {
        return {
          triggered: true,
          title: `Service "${condition.serviceName}" nicht gefunden`,
          message: `Der überwachte Service "${condition.serviceName}" ist nicht mehr aktiv.`,
          metadata: { serviceName: condition.serviceName },
        };
      }
      break;
    }
  }

  return { triggered: false, title: '', message: '' };
}

// ─── Öffentliche API ─────────────────────────────────────────────────────

/**
 * Evaluiert alle aktiven Regeln für einen Server nach einem Scan.
 * Wird vom Scan-Worker nach createSnapshotAndDiff aufgerufen.
 */
export async function evaluateAlertRules(
  serverId: string,
  context: EvalContext,
): Promise<number> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { ip: true, hostname: true },
  });
  if (!server) return 0;

  // Aktive Regeln laden (global + serverspezifisch)
  const rules = await prisma.alertRule.findMany({
    where: {
      enabled: true,
      OR: [
        { serverId: null },
        { serverId },
      ],
    },
  });

  let alertsCreated = 0;

  for (const rule of rules) {
    // Cooldown prüfen
    if (rule.lastTriggeredAt) {
      const cooldownMs = rule.cooldownMin * 60 * 1000;
      if (Date.now() - rule.lastTriggeredAt.getTime() < cooldownMs) {
        continue; // Noch in Cooldown
      }
    }

    try {
      const result = await evaluateRule(rule, serverId, context);

      if (result.triggered) {
        const serverLabel = server.hostname || server.ip;

        // Alert erstellen
        await prisma.alert.create({
          data: {
            ruleId: rule.id,
            serverId,
            title: `[${serverLabel}] ${result.title}`,
            message: result.message,
            severity: rule.severity,
            category: rule.category,
            metadata: result.metadata,
          },
        });

        // Cooldown aktualisieren
        await prisma.alertRule.update({
          where: { id: rule.id },
          data: { lastTriggeredAt: new Date() },
        });

        alertsCreated++;
        logger.info(`🔔 Alert ausgelöst: [${rule.severity}] ${result.title} auf ${serverLabel}`);
      }
    } catch (err) {
      logger.error(`Fehler bei Alert-Evaluation (Regel: ${rule.name}):`, err);
    }
  }

  if (alertsCreated > 0) {
    // Audit-Log
    await prisma.auditLog.create({
      data: {
        action: 'ALERTS_TRIGGERED',
        target: `server:${serverId}`,
        details: { count: alertsCreated } as any,
      },
    });
  }

  return alertsCreated;
}

/**
 * Gibt alle Alerts zurück, optional gefiltert.
 */
export async function getAlerts(options?: {
  serverId?: string;
  severity?: string;
  resolved?: boolean;
  limit?: number;
  offset?: number;
}) {
  const where: any = {};
  if (options?.serverId) where.serverId = options.serverId;
  if (options?.severity) where.severity = options.severity;
  if (options?.resolved !== undefined) where.resolved = options.resolved;

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
      include: {
        server: { select: { ip: true, hostname: true } },
        rule: { select: { name: true, category: true } },
      },
    }),
    prisma.alert.count({ where }),
  ]);

  return { alerts, total };
}

/**
 * Alert-Zusammenfassung (für Dashboard-Widget).
 */
export async function getAlertSummary() {
  const [total, open, bySeverity, byCategory, recentCritical] = await Promise.all([
    prisma.alert.count(),
    prisma.alert.count({ where: { resolved: false } }),
    prisma.alert.groupBy({
      by: ['severity'],
      where: { resolved: false },
      _count: true,
    }),
    prisma.alert.groupBy({
      by: ['category'],
      where: { resolved: false },
      _count: true,
    }),
    prisma.alert.findMany({
      where: { resolved: false, severity: 'CRITICAL' },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        server: { select: { ip: true, hostname: true } },
      },
    }),
  ]);

  return {
    total,
    open,
    bySeverity: Object.fromEntries(bySeverity.map(s => [s.severity, s._count])),
    byCategory: Object.fromEntries(byCategory.map(c => [c.category, c._count])),
    recentCritical,
  };
}
