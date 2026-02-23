// ─── Schedule-Management Routes ──────────────────────────────────────────
// CRUD-Operationen für Server-Scan und Netzwerk-Scan Schedules

import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { getSchedulerStats, getActiveScheduleKeys } from '../services/scheduler.service';
import { scanQueue } from '../queues';
import { logger } from '../logger';
import cron from 'node-cron';

const router = Router();
router.use(authenticate);

// ─── GET /api/schedules ─────────────────────────────────────────────────
// Alle aktiven Schedules + Scheduler-Statistiken
router.get('/', async (_req: Request, res: Response) => {
  try {
    const stats = getSchedulerStats();

    // Server mit Schedules
    const serverSchedules = await prisma.server.findMany({
      where: { scanSchedule: { not: null } },
      select: {
        id: true,
        ip: true,
        hostname: true,
        scanSchedule: true,
        status: true,
        lastScanAt: true,
        lastScanError: true,
      },
      orderBy: { ip: 'asc' },
    });

    // Netzwerk-Scan-Schedules (unique subnet + schedule Kombinationen)
    const networkSchedules = await prisma.networkScan.findMany({
      where: { schedule: { not: null } },
      select: {
        id: true,
        subnet: true,
        schedule: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Einzigartige Netzwerk-Schedules
    const uniqueNetSchedules = new Map<string, typeof networkSchedules[0]>();
    for (const ns of networkSchedules) {
      const key = `${ns.subnet}:${ns.schedule}`;
      if (!uniqueNetSchedules.has(key)) {
        uniqueNetSchedules.set(key, ns);
      }
    }

    res.json({
      stats,
      serverSchedules,
      networkSchedules: Array.from(uniqueNetSchedules.values()),
      activeKeys: getActiveScheduleKeys(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/schedules/server/:id ──────────────────────────────────────
// Server-Scan-Schedule setzen/aktualisieren
router.put(
  '/server/:id',
  authorize('ADMIN', 'OPERATOR'),
  [
    param('id').isUUID(),
    body('scanSchedule').optional({ nullable: true }).isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { id } = req.params;
      const { scanSchedule } = req.body;

      // Cron-Ausdruck validieren
      if (scanSchedule && !cron.validate(scanSchedule)) {
        res.status(400).json({ error: `Ungültiger Cron-Ausdruck: ${scanSchedule}` });
        return;
      }

      const server = await prisma.server.update({
        where: { id: id as string },
        data: { scanSchedule: scanSchedule || null },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: scanSchedule ? 'SCHEDULE_UPDATED' : 'SCHEDULE_REMOVED',
          target: `server:${server.id}`,
          details: { ip: server.ip, scanSchedule },
        },
      });

      logger.info(`Schedule für ${server.ip} aktualisiert: ${scanSchedule || 'entfernt'}`);

      res.json({ server });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── DELETE /api/schedules/server/:id ───────────────────────────────────
// Server-Scan-Schedule entfernen
router.delete(
  '/server/:id',
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const server = await prisma.server.update({
        where: { id: id as string },
        data: { scanSchedule: null },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'SCHEDULE_REMOVED',
          target: `server:${server.id}`,
          details: { ip: server.ip },
        },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/schedules/server/:id/trigger ─────────────────────────────
// Sofort-Scan manuell auslösen (auch ohne Schedule)
router.post(
  '/server/:id/trigger',
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const server = await prisma.server.findUnique({
        where: { id: id as string },
        select: { id: true, ip: true, status: true, sshUser: true, sshPasswordEncrypted: true },
      });

      if (!server) {
        res.status(404).json({ error: 'Server nicht gefunden' });
        return;
      }

      if (!server.sshUser || !server.sshPasswordEncrypted) {
        res.status(400).json({ error: 'Server hat keine SSH-Zugangsdaten – Scan nicht möglich' });
        return;
      }

      if (server.status === 'SCANNING') {
        res.status(409).json({ error: 'Scan läuft bereits für diesen Server' });
        return;
      }

      const job = await scanQueue.add('server-scan', {
        serverId: server.id,
        triggeredBy: req.user!.userId,
      }, {
        jobId: `manual-scan-${server.id}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      });

      await prisma.server.update({
        where: { id: server.id },
        data: { status: 'SCANNING' },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'MANUAL_SCAN_TRIGGERED',
          target: `server:${server.id}`,
          details: { ip: server.ip, jobId: job.id },
        },
      });

      res.json({ success: true, jobId: job.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── DELETE /api/schedules/network/:id ───────────────────────────────────
// Netzwerk-Scan-Schedule entfernen (setzt schedule auf null)
router.delete(
  '/network/:id',
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const scan = await prisma.networkScan.findUnique({
        where: { id: id as string },
      });

      if (!scan) {
        res.status(404).json({ error: 'Netzwerk-Scan nicht gefunden' });
        return;
      }

      await prisma.networkScan.update({
        where: { id: id as string },
        data: { schedule: null },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'NETWORK_SCHEDULE_REMOVED',
          target: `network_scan:${id}`,
          details: { subnet: scan.subnet, previousSchedule: scan.schedule },
        },
      });

      logger.info(`Netzwerk-Schedule für ${scan.subnet} entfernt`);

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── PUT /api/schedules/network/:id ─────────────────────────────────────
// Netzwerk-Scan-Schedule aktualisieren
router.put(
  '/network/:id',
  authorize('ADMIN', 'OPERATOR'),
  [
    param('id').isUUID(),
    body('schedule').notEmpty().isString().withMessage('Cron-Ausdruck erforderlich'),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { id } = req.params;
      const { schedule } = req.body;

      if (!cron.validate(schedule)) {
        res.status(400).json({ error: `Ungültiger Cron-Ausdruck: ${schedule}` });
        return;
      }

      const scan = await prisma.networkScan.update({
        where: { id: id as string },
        data: { schedule },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'NETWORK_SCHEDULE_UPDATED',
          target: `network_scan:${id}`,
          details: { subnet: scan.subnet, schedule },
        },
      });

      logger.info(`Netzwerk-Schedule für ${scan.subnet} aktualisiert: ${schedule}`);

      res.json({ scan });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/schedules/stats ───────────────────────────────────────────
// Reine Scheduler-Statistiken (für Dashboard-Widget)
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = getSchedulerStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
