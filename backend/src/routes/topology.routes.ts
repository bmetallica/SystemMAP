// ─── Topology Routes ─────────────────────────────────────────────────────
// API für die Graphen-Visualisierung (Knoten & Kanten)

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticate);

// ─── GET /api/topology ────────────────────────────────────────────────────
// Liefert alle Knoten (Server + Services) und Kanten (ConnectionEdges)
// für die Topologie-Ansicht
router.get('/', async (_req: Request, res: Response) => {
  try {
    const [servers, edges] = await Promise.all([
      prisma.server.findMany({
        select: {
          id: true,
          ip: true,
          hostname: true,
          osInfo: true,
          status: true,
          services: {
            select: { id: true, name: true, port: true, state: true },
          },
          _count: {
            select: { dockerContainers: true },
          },
        },
      }),
      prisma.connectionEdge.findMany({
        include: {
          sourceServer: { select: { id: true, ip: true, hostname: true } },
          targetServer: { select: { id: true, ip: true, hostname: true } },
        },
      }),
    ]);

    // Für die Graphen-Visualisierung: Knoten und Kanten getrennt
    const nodes = servers.map((s) => ({
      id: s.id,
      type: 'server',
      label: s.hostname || s.ip,
      ip: s.ip,
      status: s.status,
      services: s.services,
      containerCount: s._count.dockerContainers,
    }));

    const links = edges.map((e) => ({
      id: e.id,
      source: e.sourceServerId,
      target: e.targetServerId,
      targetIp: e.targetIp,
      targetPort: e.targetPort,
      sourceProcess: e.sourceProcess,
      detectionMethod: e.detectionMethod,
      details: e.details,
      isExternal: e.isExternal,
    }));

    res.json({ nodes, links });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/topology/edge/:id ───────────────────────────────────────────
// Detail-Info zu einer einzelnen Verbindungskante
router.get('/edge/:id', async (req: Request, res: Response) => {
  try {
    const edge = await prisma.connectionEdge.findUnique({
      where: { id: req.params.id as string },
      include: {
        sourceServer: { select: { id: true, ip: true, hostname: true } },
        targetServer: { select: { id: true, ip: true, hostname: true } },
      },
    });

    if (!edge) {
      res.status(404).json({ error: 'Verbindung nicht gefunden' });
      return;
    }

    res.json(edge);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
