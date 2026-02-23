// ─── Auto-Discovery Engine ───────────────────────────────────────────────
// Erweiterte Netzwerk-Discovery:
// - Subnet-Range Discovery (mehrere Subnetze gleichzeitig)
// - Auto-Configure: Versucht SSH-Verbindung mit bekannten Credentials
// - Discovery-Profiles: Vordefinierte Scan-Konfigurationen
// - Discovery-History: Tracking aller Discovery-Läufe

import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import { networkScanQueue, scanQueue } from '../queues';
import { logger } from '../logger';

const router = Router();
router.use(authenticate);

// ─── POST /api/discovery/multi-scan ─────────────────────────────────────
// Mehrere Subnetze gleichzeitig scannen
router.post(
  '/multi-scan',
  authorize('ADMIN', 'OPERATOR'),
  [
    body('subnets').isArray({ min: 1 }).withMessage('Mindestens ein Subnetz erforderlich'),
    body('subnets.*').isString().notEmpty(),
    body('schedule').optional({ nullable: true }).isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { subnets, schedule } = req.body;
      const results: Array<{ subnet: string; scanId: string; jobId: string }> = [];

      for (const subnet of subnets) {
        const scan = await prisma.networkScan.create({
          data: { subnet, schedule: schedule || null },
        });

        const job = await networkScanQueue.add('network-scan', {
          scanId: scan.id,
          subnet,
          triggeredBy: req.user!.userId,
        }, {
          jobId: `netscan-${scan.id}`,
          attempts: 1,
        });

        results.push({ subnet, scanId: scan.id, jobId: job.id as string });
      }

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'MULTI_NETWORK_SCAN_TRIGGERED',
          target: `subnets:${subnets.length}`,
          details: { subnets, schedule },
        },
      });

      logger.info(`Multi-Scan gestartet: ${subnets.length} Subnetze`);
      res.status(201).json({ scans: results, total: results.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/discovery/auto-configure ─────────────────────────────────
// Versucht, discovered Server automatisch mit SSH-Credentials zu konfigurieren
// und triggert dann einen Deep-Scan
router.post(
  '/auto-configure',
  authorize('ADMIN'),
  [
    body('serverIds').optional().isArray(),
    body('sshUser').notEmpty().withMessage('SSH-Benutzername erforderlich'),
    body('sshPassword').notEmpty().withMessage('SSH-Passwort erforderlich'),
    body('sshPort').optional().isInt({ min: 1, max: 65535 }).default(22),
    body('autoScan').optional().isBoolean().default(true),
    body('scanSchedule').optional({ nullable: true }).isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { serverIds, sshUser, sshPassword, sshPort = 22, autoScan = true, scanSchedule } = req.body;

      // Dynamisch importieren wegen circular dependency
      const { encrypt } = await import('../services/crypto.service');

      // Ziel-Server: Entweder spezifische IDs oder alle DISCOVERED Server
      let targetServers;
      if (serverIds && serverIds.length > 0) {
        targetServers = await prisma.server.findMany({
          where: { id: { in: serverIds } },
        });
      } else {
        targetServers = await prisma.server.findMany({
          where: { status: 'DISCOVERED' },
        });
      }

      if (targetServers.length === 0) {
        res.status(404).json({ error: 'Keine Server zum Konfigurieren gefunden' });
        return;
      }

      const encryptedPassword = encrypt(sshPassword);
      const configured: string[] = [];
      const scanJobs: string[] = [];

      for (const server of targetServers) {
        // SSH-Credentials setzen
        await prisma.server.update({
          where: { id: server.id },
          data: {
            sshUser,
            sshPasswordEncrypted: encryptedPassword,
            sshPort,
            status: 'CONFIGURED',
            scanSchedule: scanSchedule || null,
          },
        });

        configured.push(server.ip);

        // Optional sofort scannen
        if (autoScan) {
          const job = await scanQueue.add('server-scan', {
            serverId: server.id,
            triggeredBy: req.user!.userId,
          }, {
            jobId: `auto-config-scan-${server.id}-${Date.now()}`,
            attempts: 2,
            backoff: { type: 'exponential', delay: 5000 },
          });

          await prisma.server.update({
            where: { id: server.id },
            data: { status: 'SCANNING' },
          });

          scanJobs.push(job.id as string);
        }
      }

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'AUTO_CONFIGURE_SERVERS',
          target: `servers:${configured.length}`,
          details: {
            count: configured.length,
            servers: configured,
            autoScan,
            hasSchedule: !!scanSchedule,
          },
        },
      });

      logger.info(`Auto-Configure: ${configured.length} Server konfiguriert, ${scanJobs.length} Scans gestartet`);

      res.json({
        configured: configured.length,
        servers: configured,
        scansStarted: scanJobs.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── GET /api/discovery/discovered ──────────────────────────────────────
// Alle entdeckten (noch nicht konfigurierten) Server
router.get('/discovered', async (_req: Request, res: Response) => {
  try {
    const servers = await prisma.server.findMany({
      where: { status: 'DISCOVERED' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ip: true,
        hostname: true,
        osInfo: true,
        createdAt: true,
        _count: { select: { services: true } },
      },
    });

    res.json({ servers, total: servers.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/discovery/summary ─────────────────────────────────────────
// Discovery-Zusammenfassung: Wie viele Server in welchem Status, letzte Scans
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const [
      totalDiscovered,
      totalConfigured,
      totalOnline,
      totalError,
      recentScans,
      scannedSubnets,
    ] = await Promise.all([
      prisma.server.count({ where: { status: 'DISCOVERED' } }),
      prisma.server.count({ where: { status: 'CONFIGURED' } }),
      prisma.server.count({ where: { status: 'ONLINE' } }),
      prisma.server.count({ where: { status: 'ERROR' } }),
      prisma.networkScan.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          subnet: true,
          status: true,
          schedule: true,
          results: true,
          error: true,
          createdAt: true,
          finishedAt: true,
        },
      }),
      // Unique Subnetze die gescannt wurden
      prisma.networkScan.groupBy({
        by: ['subnet'],
        _count: { id: true },
        _max: { createdAt: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    res.json({
      counts: {
        discovered: totalDiscovered,
        configured: totalConfigured,
        online: totalOnline,
        error: totalError,
      },
      recentScans,
      scannedSubnets: scannedSubnets.map((s) => ({
        subnet: s.subnet,
        scanCount: s._count.id,
        lastScan: s._max.createdAt,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/discovery/purge-discovered ──────────────────────────────
// Alle DISCOVERED Server löschen (die nicht konfiguriert wurden)
router.delete(
  '/purge-discovered',
  authorize('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const result = await prisma.server.deleteMany({
        where: { status: 'DISCOVERED' },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'PURGE_DISCOVERED_SERVERS',
          target: `servers:${result.count}`,
          details: { deleted: result.count },
        },
      });

      logger.info(`${result.count} entdeckte Server gelöscht`);
      res.json({ deleted: result.count });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
