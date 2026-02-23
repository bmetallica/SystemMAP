// ─── Alert Routes (Etappe 4) ─────────────────────────────────────────────
// CRUD für Alarmregeln, Alert-Listing, Resolve, Summary

import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { getAlerts, getAlertSummary } from '../services/alert.service';

const router = Router();
router.use(authenticate);

// ─── GET /api/alerts ─────────────────────────────────────────────────────
// Alle Alerts (optional gefiltert)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { serverId, severity, resolved, limit, offset } = req.query;
    const result = await getAlerts({
      serverId: serverId as string | undefined,
      severity: severity as string | undefined,
      resolved: resolved !== undefined ? resolved === 'true' : undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/alerts/summary ─────────────────────────────────────────────
// Alert-Zusammenfassung (Dashboard-Widget)
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await getAlertSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/alerts/:id/resolve ─────────────────────────────────────────
// Alert als gelöst markieren
router.put('/:id/resolve', async (req: Request, res: Response) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.id as string },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: (req as any).user?.username || 'system',
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.userId,
        action: 'ALERT_RESOLVED',
        target: `alert:${alert.id}`,
        details: { title: alert.title, severity: alert.severity } as any,
      },
    });

    res.json(alert);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/alerts/resolve-all ─────────────────────────────────────────
// Alle offenen Alerts auflösen
router.put('/resolve-all', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { serverId, severity } = req.query;
    const where: any = { resolved: false };
    if (serverId) where.serverId = serverId;
    if (severity) where.severity = severity;

    const result = await prisma.alert.updateMany({
      where,
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: (req as any).user?.username || 'admin',
      },
    });

    res.json({ resolved: result.count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/alerts/:id ──────────────────────────────────────────────
// Alert löschen
router.delete('/:id', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    await prisma.alert.delete({
      where: { id: req.params.id as string },
    });
    res.json({ message: 'Alert gelöscht' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/alerts/live ─────────────────────────────────────────────────
// Aktuelle System-Warnungen (live aus Serverdaten berechnet, nicht aus Alert-Tabelle)
// Respektiert deaktivierte Alert-Regeln: Wenn alle Regeln einer Prüfung deaktiviert sind,
// wird die entsprechende Warnung unterdrückt.
router.get('/live', async (_req: Request, res: Response) => {
  try {
    // Lade alle Alert-Regeln um deaktivierte Checks zu identifizieren
    const allRules = await prisma.alertRule.findMany({
      select: { category: true, enabled: true, condition: true },
    });

    // Hilfsfunktion: Prüfe ob mindestens eine aktive Regel mit gegebenem Typ existiert
    const hasEnabledRule = (conditionType: string, extraMatch?: (cond: any) => boolean): boolean => {
      const matching = allRules.filter(r => {
        const cond = r.condition as any;
        if (cond?.type !== conditionType) return false;
        if (extraMatch && !extraMatch(cond)) return false;
        return true;
      });
      // Wenn keine Regeln für diesen Typ existieren → Warnung trotzdem anzeigen (Fallback)
      if (matching.length === 0) return true;
      // Wenn mindestens eine davon aktiv ist → anzeigen
      return matching.some(r => r.enabled);
    };

    const warnings: Array<{
      type: 'critical' | 'warning' | 'info';
      category: string;
      title: string;
      message: string;
      target?: string;
      targetId?: string;
      detail?: any;
    }> = [];

    // Abgelaufene SSL-Zertifikate (Regel: ssl_expiry mit daysLeft=0)
    if (hasEnabledRule('ssl_expiry', c => (c.daysLeft ?? 0) === 0)) {
      const expiredCerts = await prisma.sslCertificate.findMany({
        where: { isExpired: true },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
      });
      for (const cert of expiredCerts) {
        warnings.push({
          type: 'critical',
          category: 'ssl',
          title: 'SSL-Zertifikat abgelaufen',
          message: `${cert.subject || cert.path}`,
          target: cert.server.hostname || cert.server.ip,
          targetId: cert.server.id,
          detail: { path: cert.path, subject: cert.subject, daysLeft: cert.daysLeft },
        });
      }
    }

    // SSL-Zertifikate die bald ablaufen (≤ 30 Tage) (Regel: ssl_expiry mit daysLeft>0)
    if (hasEnabledRule('ssl_expiry', c => (c.daysLeft ?? 0) > 0)) {
      const expiringCerts = await prisma.sslCertificate.findMany({
        where: { isExpired: false, daysLeft: { not: null, lte: 30 } },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
      });
      for (const cert of expiringCerts) {
        warnings.push({
          type: (cert.daysLeft ?? 0) <= 7 ? 'critical' : 'warning',
          category: 'ssl',
          title: `SSL-Zertifikat läuft in ${cert.daysLeft} Tagen ab`,
          message: `${cert.subject || cert.path}`,
          target: cert.server.hostname || cert.server.ip,
          targetId: cert.server.id,
          detail: { path: cert.path, subject: cert.subject, daysLeft: cert.daysLeft },
        });
      }
    }

    // Fehlgeschlagene Systemd-Units (Regel: systemd_failed)
    if (hasEnabledRule('systemd_failed')) {
      const failedUnits = await prisma.systemdUnit.findMany({
        where: { activeState: 'failed' },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
      });
      for (const unit of failedUnits) {
        warnings.push({
          type: 'critical',
          category: 'systemd',
          title: 'Systemd-Unit fehlgeschlagen',
          message: unit.name,
          target: unit.server.hostname || unit.server.ip,
          targetId: unit.server.id,
        });
      }
    }

    // Festplatten mit ≥ 90% Nutzung (Regel: disk_usage)
    if (hasEnabledRule('disk_usage')) {
      // Niedrigstem aktiven Schwellwert aus Regeln verwenden
      const diskRules = allRules.filter(r => {
        const cond = r.condition as any;
        return cond?.type === 'disk_usage' && r.enabled;
      });
      const minThreshold = diskRules.length > 0
        ? Math.min(...diskRules.map(r => (r.condition as any).threshold ?? 90))
        : 90;

      const criticalDisks = await prisma.mount.findMany({
        where: { usePct: { gte: minThreshold } },
        include: { server: { select: { id: true, ip: true, hostname: true } } },
        orderBy: { usePct: 'desc' },
      });
      for (const disk of criticalDisks) {
        warnings.push({
          type: (disk.usePct ?? 0) >= 95 ? 'critical' : 'warning',
          category: 'disk',
          title: `Disk-Auslastung ${disk.usePct}%`,
          message: `${disk.mountPoint} auf ${disk.server.hostname || disk.server.ip}`,
          target: disk.server.hostname || disk.server.ip,
          targetId: disk.server.id,
          detail: { mountPoint: disk.mountPoint, usePct: disk.usePct, sizeMb: disk.sizeMb, usedMb: disk.usedMb },
        });
      }
    }

    // Server mit Fehlern (immer anzeigen – keine zugehörige Regel)
    const errorServers = await prisma.server.findMany({
      where: { status: 'ERROR' },
      select: { id: true, ip: true, hostname: true, lastScanError: true },
    });
    for (const server of errorServers) {
      warnings.push({
        type: 'warning',
        category: 'scan',
        title: 'Scan-Fehler',
        message: server.lastScanError || 'Unbekannter Fehler',
        target: server.hostname || server.ip,
        targetId: server.id,
      });
    }

    // Sortieren: critical > warning > info
    const priority: Record<string, number> = { critical: 0, warning: 1, info: 2 };
    warnings.sort((a, b) => (priority[a.type] ?? 2) - (priority[b.type] ?? 2));

    res.json({ warnings, total: warnings.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════
// Alert-Regeln (CRUD)
// ═════════════════════════════════════════════════════════════════════════

// ─── GET /api/alerts/rules ───────────────────────────────────────────────
router.get('/rules', async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.alertRule.findMany({
      orderBy: [{ severity: 'asc' }, { name: 'asc' }],
      include: {
        server: { select: { ip: true, hostname: true } },
        _count: { select: { alerts: true } },
      },
    });
    res.json(rules);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/alerts/rules ─────────────────────────────────────────────
router.post('/rules', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const { name, description, category, condition, severity, enabled, serverId, cooldownMin } = req.body;

    if (!name || !category || !condition) {
      res.status(400).json({ error: 'name, category und condition sind Pflichtfelder' });
      return;
    }

    const rule = await prisma.alertRule.create({
      data: {
        name,
        description: description || null,
        category,
        condition,
        severity: severity || 'WARNING',
        enabled: enabled !== false,
        serverId: serverId || null,
        cooldownMin: cooldownMin || 60,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: (req as any).user?.userId,
        action: 'ALERT_RULE_CREATED',
        target: `rule:${rule.id}`,
        details: { name, category, severity } as any,
      },
    });

    res.status(201).json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/alerts/rules/:id ───────────────────────────────────────────
router.put('/rules/:id', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const { name, description, category, condition, severity, enabled, serverId, cooldownMin } = req.body;

    const rule = await prisma.alertRule.update({
      where: { id: req.params.id as string },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(condition !== undefined && { condition }),
        ...(severity !== undefined && { severity }),
        ...(enabled !== undefined && { enabled }),
        ...(serverId !== undefined && { serverId: serverId || null }),
        ...(cooldownMin !== undefined && { cooldownMin }),
      },
    });

    res.json(rule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/alerts/rules/:id ────────────────────────────────────────
router.delete('/rules/:id', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    await prisma.alertRule.delete({
      where: { id: req.params.id as string },
    });
    res.json({ message: 'Regel gelöscht' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/alerts/rules/:id/toggle ────────────────────────────────────
// Regel aktivieren/deaktivieren
router.put('/rules/:id/toggle', async (req: Request, res: Response) => {
  try {
    const rule = await prisma.alertRule.findUnique({ where: { id: req.params.id as string } });
    if (!rule) {
      res.status(404).json({ error: 'Regel nicht gefunden' });
      return;
    }

    const updated = await prisma.alertRule.update({
      where: { id: rule.id },
      data: { enabled: !rule.enabled },
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
