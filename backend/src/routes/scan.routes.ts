// ─── Scan / Discovery Routes ─────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { networkScanQueue, scanQueue } from '../queues';
import { logger } from '../logger';

const router = Router();
router.use(authenticate);

// ─── POST /api/scans/network ──────────────────────────────────────────────
// Nmap-Netzwerkscan starten
router.post(
  '/network',
  authorize('ADMIN', 'OPERATOR'),
  [
    body('subnet').notEmpty().withMessage('Subnetz erforderlich (z.B. 192.168.1.0/24)'),
    body('schedule').optional({ nullable: true }).isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { subnet, schedule } = req.body;

      // NetworkScan in DB anlegen
      const scan = await prisma.networkScan.create({
        data: {
          subnet,
          schedule: schedule || null,
        },
      });

      // Job in Queue
      const job = await networkScanQueue.add('network-scan', {
        scanId: scan.id,
        subnet,
        triggeredBy: req.user!.userId,
      }, {
        jobId: `netscan-${scan.id}`,
        attempts: 1,
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'NETWORK_SCAN_TRIGGERED',
          target: `network_scan:${scan.id}`,
          details: { subnet, jobId: job.id },
        },
      });

      logger.info(`Netzwerkscan gestartet: ${subnet} (Job: ${job.id})`);

      res.status(201).json({ scan, jobId: job.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/scans/network ──────────────────────────────────────────────
// Alle Netzwerkscans abrufen
router.get('/network', async (req: Request, res: Response) => {
  try {
    const scans = await prisma.networkScan.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json(scans);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/scans/network/:id ──────────────────────────────────────────
router.get('/network/:id', async (req: Request, res: Response) => {
  try {
    const scan = await prisma.networkScan.findUnique({
      where: { id: req.params.id as string },
    });
    if (!scan) {
      res.status(404).json({ error: 'Scan nicht gefunden' });
      return;
    }
    res.json(scan);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/scans/network/:id ──────────────────────────────────────
// Einzelnen Netzwerkscan aus Historie löschen
router.delete(
  '/network/:id',
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response) => {
    try {
      const scan = await prisma.networkScan.findUnique({
        where: { id: req.params.id as string },
      });
      if (!scan) {
        res.status(404).json({ error: 'Scan nicht gefunden' });
        return;
      }
      if (scan.status === 'RUNNING') {
        res.status(409).json({ error: 'Laufender Scan kann nicht gelöscht werden' });
        return;
      }
      await prisma.networkScan.delete({
        where: { id: req.params.id as string },
      });
      logger.info(`Netzwerkscan ${scan.subnet} (${scan.id}) gelöscht`);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/scans/jobs/status ──────────────────────────────────────────
// BullMQ Queue-Status abrufen
router.get('/jobs/status', async (_req: Request, res: Response) => {
  try {
    const [
      scanWaiting, scanActive, scanCompleted, scanFailed,
      netWaiting, netActive, netCompleted, netFailed,
    ] = await Promise.all([
      scanQueue.getWaitingCount(),
      scanQueue.getActiveCount(),
      scanQueue.getCompletedCount(),
      scanQueue.getFailedCount(),
      networkScanQueue.getWaitingCount(),
      networkScanQueue.getActiveCount(),
      networkScanQueue.getCompletedCount(),
      networkScanQueue.getFailedCount(),
    ]);

    res.json({
      serverScans: { waiting: scanWaiting, active: scanActive, completed: scanCompleted, failed: scanFailed },
      networkScans: { waiting: netWaiting, active: netActive, completed: netCompleted, failed: netFailed },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
