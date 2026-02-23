// ─── Diff Routes (Etappe 4) ──────────────────────────────────────────────
// API für Differenz-Erkennung: Snapshots, Diffs, Timeline

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';
import {
  getServerDiffTimeline,
  getDiffSummary,
  getServerSnapshots,
} from '../services/diff.service';

const router = Router();
router.use(authenticate);

// ─── GET /api/diffs/summary ──────────────────────────────────────────────
// Globale Diff-Zusammenfassung (für Dashboard)
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const summary = await getDiffSummary();
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/diffs/server/:serverId ─────────────────────────────────────
// Diff-Timeline für einen Server
router.get('/server/:serverId', async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const { category, severity, acknowledged, limit } = req.query;

    const diffs = await getServerDiffTimeline(serverId as string, {
      category: category as string | undefined,
      severity: severity as string | undefined,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined,
      limit: limit ? parseInt(limit as string, 10) : 100,
    });

    res.json(diffs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/diffs/server/:serverId/summary ─────────────────────────────
// Diff-Zusammenfassung für einen Server
router.get('/server/:serverId/summary', async (req: Request, res: Response) => {
  try {
    const summary = await getDiffSummary(req.params.serverId as string);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/diffs/server/:serverId/snapshots ───────────────────────────
// Snapshot-History für einen Server
router.get('/server/:serverId/snapshots', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const snapshots = await getServerSnapshots(req.params.serverId as string, limit);
    res.json(snapshots);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/diffs/snapshot/:snapshotId ─────────────────────────────────
// Alle Diffs eines einzelnen Snapshots
router.get('/snapshot/:snapshotId', async (req: Request, res: Response) => {
  try {
    const snapshot = await prisma.scanSnapshot.findUnique({
      where: { id: req.params.snapshotId as string },
      include: {
        diffs: { orderBy: { severity: 'asc' } },
        server: { select: { ip: true, hostname: true } },
      },
    });

    if (!snapshot) {
      res.status(404).json({ error: 'Snapshot nicht gefunden' });
      return;
    }

    res.json(snapshot);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/diffs/:id/acknowledge ──────────────────────────────────────
// Diff als "bestätigt" markieren
router.put('/:id/acknowledge', async (req: Request, res: Response) => {
  try {
    const diff = await prisma.diffEvent.update({
      where: { id: req.params.id as string },
      data: { acknowledged: true },
    });
    res.json(diff);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/diffs/server/:serverId/acknowledge-all ─────────────────────
// Alle Diffs eines Servers als bestätigt markieren
router.put('/server/:serverId/acknowledge-all', async (req: Request, res: Response) => {
  try {
    const result = await prisma.diffEvent.updateMany({
      where: {
        serverId: req.params.serverId as string,
        acknowledged: false,
      },
      data: { acknowledged: true },
    });
    res.json({ acknowledged: result.count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/diffs/recent ───────────────────────────────────────────────
// Letzte Diffs aller Server (für globale Ansicht)
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const severity = req.query.severity as string | undefined;

    const where: any = {};
    if (severity) where.severity = severity;

    const diffs = await prisma.diffEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        server: { select: { ip: true, hostname: true } },
        snapshot: { select: { scanNumber: true } },
      },
    });

    res.json(diffs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
