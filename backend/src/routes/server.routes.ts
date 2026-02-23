// ─── Server Routes ───────────────────────────────────────────────────────
// CRUD für Server inkl. verschlüsselter SSH-Credentials

import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { encrypt, decrypt } from '../services/crypto.service';
import { prisma } from '../lib/prisma';
import { ServerStatus } from '@prisma/client';
import { scanQueue } from '../queues';
import { logger } from '../logger';

const router = Router();

// Helper: Express params.id kann string | string[] sein, wir brauchen string
const paramId = (req: Request): string => req.params.id as string;

// Alle Routen erfordern Authentifizierung
router.use(authenticate);

// ─── GET /api/servers ─────────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const servers = await prisma.server.findMany({
      select: {
        id: true,
        ip: true,
        hostname: true,
        osInfo: true,
        status: true,
        sshUser: true,
        sshPort: true,
        lastScanAt: true,
        lastScanError: true,
        scanSchedule: true,
        aiPurpose: true,
        aiTags: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            services: true,
            outgoingEdges: true,
            incomingEdges: true,
            dockerContainers: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(servers);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/servers/:id ─────────────────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const server = await prisma.server.findUnique({
      where: { id: paramId(req) },
      include: {
        services: true,
        processes: { orderBy: { cpuPct: 'desc' }, take: 100 },
        mounts: true,
        networkInterfaces: true,
        dockerContainers: true,
        cronJobs: { orderBy: { schedule: 'asc' } },
        systemdUnits: { orderBy: [{ activeState: 'asc' }, { name: 'asc' }] },
        sslCertificates: { orderBy: { validTo: 'asc' } },
        lvmVolumes: { orderBy: { vgName: 'asc' } },
        userAccounts: { orderBy: { uid: 'asc' } },
        outgoingEdges: {
          include: { targetServer: { select: { id: true, ip: true, hostname: true } } },
        },
        incomingEdges: {
          include: { sourceServer: { select: { id: true, ip: true, hostname: true } } },
        },
        aiAnalyses: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (!server) {
      res.status(404).json({ error: 'Server nicht gefunden' });
      return;
    }

    // SSH-Passwort NIEMALS an den Client senden
    const { sshPasswordEncrypted, sshKeyEncrypted, rawScanData, ...safeServer } = server;
    res.json({
      ...safeServer,
      hasSshPassword: !!sshPasswordEncrypted,
      hasSshKey: !!sshKeyEncrypted,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/servers ────────────────────────────────────────────────────
router.post(
  '/',
  authorize('ADMIN', 'OPERATOR'),
  [
    body('ip').isIP().withMessage('Gültige IP-Adresse erforderlich'),
    body('hostname').optional().isString(),
    body('sshUser').optional().isString(),
    body('sshPassword').optional().isString(),
    body('sshPort').optional().isInt({ min: 1, max: 65535 }),
    body('sshKey').optional().isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { ip, hostname, sshUser, sshPassword, sshPort, sshKey } = req.body;

      // Prüfen ob Server mit dieser IP bereits existiert
      const existing = await prisma.server.findUnique({ where: { ip } });
      if (existing) {
        res.status(409).json({ error: `Server mit IP ${ip} existiert bereits` });
        return;
      }

      const data: any = {
        ip,
        hostname: hostname || null,
        sshUser: sshUser || null,
        sshPort: sshPort || 22,
        status: sshUser ? ServerStatus.CONFIGURED : ServerStatus.DISCOVERED,
      };

      // SSH-Passwort verschlüsseln
      if (sshPassword) {
        data.sshPasswordEncrypted = encrypt(sshPassword);
      }

      // SSH-Key verschlüsseln
      if (sshKey) {
        data.sshKeyEncrypted = encrypt(sshKey);
      }

      const server = await prisma.server.create({ data });

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'SERVER_CREATED',
          target: `server:${server.id}`,
          details: { ip, hostname },
        },
      });

      logger.info(`Server angelegt: ${ip} (${hostname || 'kein Hostname'})`);

      res.status(201).json({
        ...server,
        sshPasswordEncrypted: undefined,
        sshKeyEncrypted: undefined,
        hasSshPassword: !!sshPassword,
        hasSshKey: !!sshKey,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── PUT /api/servers/:id ─────────────────────────────────────────────────
router.put(
  '/:id',
  authorize('ADMIN', 'OPERATOR'),
  [
    param('id').isUUID(),
    body('hostname').optional().isString(),
    body('sshUser').optional().isString(),
    body('sshPassword').optional().isString(),
    body('sshPort').optional().isInt({ min: 1, max: 65535 }),
    body('sshKey').optional().isString(),
    body('scanSchedule').optional({ nullable: true }).isString(),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    try {
      const { hostname, sshUser, sshPassword, sshPort, sshKey, scanSchedule } = req.body;

      const data: any = {};
      if (hostname !== undefined) data.hostname = hostname;
      if (sshUser !== undefined) data.sshUser = sshUser;
      if (sshPort !== undefined) data.sshPort = sshPort;
      if (scanSchedule !== undefined) data.scanSchedule = scanSchedule;

      if (sshPassword) {
        data.sshPasswordEncrypted = encrypt(sshPassword);
      }
      if (sshKey) {
        data.sshKeyEncrypted = encrypt(sshKey);
      }

      // Status auf CONFIGURED setzen wenn SSH-Daten vorhanden
      if (sshUser || sshPassword) {
        data.status = ServerStatus.CONFIGURED;
      }

      const server = await prisma.server.update({
        where: { id: paramId(req) },
        data,
      });

      // Audit-Log
      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'SERVER_UPDATED',
          target: `server:${server.id}`,
          details: { fields: Object.keys(data) },
        },
      });

      res.json({
        ...server,
        sshPasswordEncrypted: undefined,
        sshKeyEncrypted: undefined,
        hasSshPassword: !!server.sshPasswordEncrypted,
        hasSshKey: !!server.sshKeyEncrypted,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── DELETE /api/servers/:id ──────────────────────────────────────────────
router.delete(
  '/:id',
  authorize('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      await prisma.server.delete({ where: { id: paramId(req) } });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'SERVER_DELETED',
          target: `server:${paramId(req)}`,
        },
      });

      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── POST /api/servers/:id/scan ───────────────────────────────────────────
// Manuellen Scan triggern
router.post(
  '/:id/scan',
  authorize('ADMIN', 'OPERATOR'),
  async (req: Request, res: Response) => {
    try {
      const server = await prisma.server.findUnique({ where: { id: paramId(req) } });
      if (!server) {
        res.status(404).json({ error: 'Server nicht gefunden' });
        return;
      }

      if (!server.sshUser || !server.sshPasswordEncrypted) {
        res.status(400).json({ error: 'SSH-Zugangsdaten müssen zuerst konfiguriert werden' });
        return;
      }

      if (server.status === ServerStatus.SCANNING) {
        res.status(409).json({ error: 'Scan läuft bereits' });
        return;
      }

      // Job in BullMQ-Queue einreihen
      const job = await scanQueue.add('server-scan', {
        serverId: server.id,
        triggeredBy: req.user!.userId,
      }, {
        jobId: `scan-${server.id}-${Date.now()}`,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      });

      await prisma.server.update({
        where: { id: server.id },
        data: { status: ServerStatus.SCANNING },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: 'SCAN_TRIGGERED',
          target: `server:${server.id}`,
          details: { jobId: job.id },
        },
      });

      logger.info(`Scan gestartet für ${server.ip} (Job: ${job.id})`);

      res.json({ message: 'Scan gestartet', jobId: job.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
