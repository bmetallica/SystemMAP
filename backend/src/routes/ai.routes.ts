// ─── KI-Funktions-Routen ──────────────────────────────────────────────────
// Phase 5.3: Chat-Endpoint + Service-Verfügbarkeit
// Wird von späteren Phasen erweitert (Summary, ProcessMap, Anomaly, NLP, Runbooks)

import { Router, Request, Response } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { aiService } from '../services/ai';
import { processMapQueue } from '../queues';
import { prisma } from '../lib/prisma';
import { logger } from '../logger';

const router = Router();

router.use(authenticate);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/health – Service-Verfügbarkeit prüfen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const [available, blocked, settings] = await Promise.all([
      aiService.isAvailable(),
      aiService.isBlocked(),
      aiService.getSettings(),
    ]);

    const enabledFeatures = [
      settings.enableSummary && 'summary',
      settings.enableProcessMap && 'processMap',
      settings.enableAnomaly && 'anomaly',
      settings.enableNlp && 'nlp',
      settings.enableRunbooks && 'runbooks',
      settings.enableLogAnalysis && 'logAnalysis',
    ].filter(Boolean);

    res.json({
      available,
      blocked,
      provider: settings.provider,
      model: settings.model,
      enabledFeatures,
    });
  } catch (err: any) {
    logger.error('AI Health-Check fehlgeschlagen:', err);
    res.status(500).json({ error: 'Health-Check fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/chat – Freier Chat mit dem KI-Modell
// ═══════════════════════════════════════════════════════════════════════════
router.post('/chat', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { prompt, systemPrompt, jsonMode, temperature, maxTokens } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'Prompt ist erforderlich' });
      return;
    }

    // Feature-Check: NLP muss aktiviert sein für freien Chat
    const nlpEnabled = await aiService.isFeatureEnabled('enableNlp');
    if (!nlpEnabled) {
      res.status(403).json({
        error: 'NLP-Abfragen sind deaktiviert. Bitte in den KI-Einstellungen aktivieren.',
      });
      return;
    }

    const response = await aiService.chat(prompt.trim(), {
      systemPrompt,
      jsonMode: jsonMode || false,
      temperature,
      maxTokens,
    });

    res.json({
      content: response.content,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      durationMs: response.durationMs,
    });
  } catch (err: any) {
    logger.error('AI Chat fehlgeschlagen:', err);
    const status = err.message?.includes('deaktiviert') ? 400
                 : err.message?.includes('blockiert') ? 423
                 : 500;
    res.status(status).json({ error: err.message || 'Chat fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/chat/json – Chat mit JSON-Antwort
// ═══════════════════════════════════════════════════════════════════════════
router.post('/chat/json', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { prompt, systemPrompt, temperature, maxTokens } = req.body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'Prompt ist erforderlich' });
      return;
    }

    const nlpEnabled = await aiService.isFeatureEnabled('enableNlp');
    if (!nlpEnabled) {
      res.status(403).json({
        error: 'NLP-Abfragen sind deaktiviert.',
      });
      return;
    }

    const { data, response } = await aiService.chatJson(prompt.trim(), {
      systemPrompt,
      temperature,
      maxTokens,
    });

    res.json({
      data,
      model: response.model,
      provider: response.provider,
      usage: response.usage,
      durationMs: response.durationMs,
    });
  } catch (err: any) {
    logger.error('AI JSON-Chat fehlgeschlagen:', err);
    const status = err.message?.includes('deaktiviert') ? 400
                 : err.message?.includes('blockiert') ? 423
                 : err.message?.includes('JSON') ? 422
                 : 500;
    res.status(status).json({ error: err.message || 'JSON-Chat fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/summary/:serverId – KI-Zusammenfassung manuell auslösen
// ═══════════════════════════════════════════════════════════════════════════
router.post('/summary/:serverId', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;

    if (!serverId) {
      res.status(400).json({ error: 'Server-ID erforderlich' });
      return;
    }

    const result = await aiService.generateServerSummary(serverId);

    res.json({
      success: true,
      summary: result,
    });
  } catch (err: any) {
    logger.error(`AI Summary fehlgeschlagen für ${req.params.serverId}:`, err);
    const status = err.message?.includes('deaktiviert') ? 400
                 : err.message?.includes('blockiert') ? 423
                 : err.message?.includes('nicht gefunden') ? 404
                 : 500;
    res.status(status).json({ error: err.message || 'Zusammenfassung fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/ai/summary/:serverId – KI-Zusammenfassung löschen
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/summary/:serverId', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    // AiAnalysis löschen
    await prisma.aiAnalysis.deleteMany({
      where: { serverId, purpose: 'server_summary' },
    });

    // Cache auf Server zurücksetzen
    await prisma.server.update({
      where: { id: serverId },
      data: { aiSummary: null, aiPurpose: null, aiTags: [] },
    });

    await prisma.$disconnect();

    res.json({ success: true });
  } catch (err: any) {
    logger.error(`AI Summary löschen fehlgeschlagen:`, err);
    res.status(500).json({ error: err.message || 'Löschen fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/process-map/:serverId – Prozessmap-Scan starten
// ═══════════════════════════════════════════════════════════════════════════
router.post('/process-map/:serverId', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    // Feature-Check
    const enabled = await aiService.isFeatureEnabled('enableProcessMap');
    if (!enabled) {
      res.status(403).json({ error: 'Prozessmap-Funktion ist deaktiviert.' });
      return;
    }

    // Server prüfen
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, hostname: true, ip: true, status: true },
    });
    if (!server) {
      res.status(404).json({ error: 'Server nicht gefunden' });
      return;
    }

    // Prüfen ob bereits ein Job läuft
    const existingJobs = await processMapQueue.getJobs(['active', 'waiting']);
    const alreadyRunning = existingJobs.some(j => j.data?.serverId === serverId);
    if (alreadyRunning) {
      res.status(409).json({ error: 'Prozessmap-Scan läuft bereits für diesen Server' });
      return;
    }

    // Job einreihen
    const job = await processMapQueue.add('process-map', {
      serverId,
      hostname: server.hostname,
      ip: server.ip,
    }, {
      jobId: `pmap-${serverId}-${Date.now()}`,
    });

    logger.info(`🗺️ Prozessmap-Scan gestartet für ${server.hostname} (${server.ip}), Job: ${job.id}`);

    res.json({
      success: true,
      jobId: job.id,
      message: `Prozessmap-Scan für ${server.hostname} gestartet`,
    });
  } catch (err: any) {
    logger.error(`Process-Map Start fehlgeschlagen:`, err);
    res.status(500).json({ error: err.message || 'Start fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/process-map/:serverId – Prozessmap-Ergebnis abrufen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/process-map/:serverId', authorize('ADMIN', 'OPERATOR', 'VIEWER'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    const analysis = await prisma.aiAnalysis.findFirst({
      where: { serverId, purpose: 'process_map' },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) {
      res.status(404).json({ error: 'Keine Prozessmap vorhanden' });
      return;
    }

    res.json({
      id: analysis.id,
      serverId: analysis.serverId,
      treeJson: analysis.treeJson,
      modelUsed: analysis.modelUsed,
      durationMs: analysis.durationMs,
      createdAt: analysis.createdAt,
    });
  } catch (err: any) {
    logger.error(`Process-Map Abruf fehlgeschlagen:`, err);
    res.status(500).json({ error: err.message || 'Abruf fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/process-map/:serverId/status – Laufenden Job-Status abfragen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/process-map/:serverId/status', authorize('ADMIN', 'OPERATOR', 'VIEWER'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    // Aktive + wartende Jobs suchen
    const jobs = await processMapQueue.getJobs(['active', 'waiting', 'completed', 'failed']);
    const serverJobs = jobs
      .filter(j => j.data?.serverId === serverId)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const job = serverJobs[0];
    if (!job) {
      res.json({ running: false, status: 'idle' });
      return;
    }

    const state = await job.getState();
    const progress = job.progress as any;

    res.json({
      running: state === 'active' || state === 'waiting',
      status: state,
      jobId: job.id,
      progress: progress?.percent || 0,
      step: progress?.step || null,
      message: progress?.message || null,
      processedCount: progress?.processedCount || 0,
      totalCount: progress?.totalCount || 0,
      failedReason: state === 'failed' ? job.failedReason : undefined,
      finishedOn: job.finishedOn,
      timestamp: job.timestamp,
    });
  } catch (err: any) {
    logger.error(`Process-Map Status fehlgeschlagen:`, err);
    res.status(500).json({ error: err.message || 'Status-Abfrage fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/anomaly/:serverId – Letzte Anomalie-Analyse abrufen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/anomaly/:serverId', authorize('ADMIN', 'OPERATOR', 'VIEWER'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    const analysis = await prisma.aiAnalysis.findFirst({
      where: { serverId, purpose: 'anomaly_check' },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) {
      res.status(404).json({ error: 'Keine Anomalie-Analyse vorhanden' });
      return;
    }

    res.json({
      id: analysis.id,
      serverId: analysis.serverId,
      result: analysis.treeJson,
      modelUsed: analysis.modelUsed,
      durationMs: analysis.durationMs,
      createdAt: analysis.createdAt,
    });
  } catch (err: any) {
    logger.error(`Anomalie-Abruf fehlgeschlagen:`, err);
    res.status(500).json({ error: err.message || 'Abruf fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/anomaly/:serverId – Anomalie-Analyse manuell auslösen
// ═══════════════════════════════════════════════════════════════════════════
router.post('/anomaly/:serverId', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;

    // Feature-Check
    const enabled = await aiService.isFeatureEnabled('enableAnomaly');
    if (!enabled) {
      res.status(403).json({ error: 'Anomalie-Erkennung ist deaktiviert. Bitte in den KI-Einstellungen aktivieren.' });
      return;
    }

    // Server prüfen
    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: { id: true, hostname: true, ip: true },
    });
    if (!server) {
      res.status(404).json({ error: 'Server nicht gefunden' });
      return;
    }

    // Letzten Snapshot mit Diffs laden (sucht den neuesten mit tatsächlichen Diffs)
    const latestSnapshot = await prisma.scanSnapshot.findFirst({
      where: {
        serverId,
        diffs: { some: {} },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        diffs: {
          select: {
            id: true,
            category: true,
            changeType: true,
            itemKey: true,
            oldValue: true,
            newValue: true,
            severity: true,
          },
        },
      },
    });

    if (!latestSnapshot || latestSnapshot.diffs.length === 0) {
      res.status(404).json({ error: 'Keine Diffs zum Analysieren gefunden. Ein zweiter Scan wird benötigt.' });
      return;
    }

    const result = await aiService.evaluateAnomalies(serverId, latestSnapshot.diffs);

    res.json({
      success: true,
      result,
      analyzedDiffs: latestSnapshot.diffs.length,
      snapshotId: latestSnapshot.id,
    });
  } catch (err: any) {
    logger.error(`Anomalie-Analyse fehlgeschlagen für ${req.params.serverId}:`, err);
    const status = err.message?.includes('deaktiviert') ? 400
                 : err.message?.includes('blockiert') ? 423
                 : err.message?.includes('nicht gefunden') ? 404
                 : 500;
    res.status(status).json({ error: err.message || 'Anomalie-Analyse fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/runbook/:serverId – Auto-Runbook generieren (Phase 5.7)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/runbook/:serverId', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const result = await aiService.generateRunbook(serverId);
    res.json({ success: true, result });
  } catch (err: any) {
    logger.error(`Runbook-Generierung fehlgeschlagen für ${req.params.serverId}:`, err);
    const status = err.message?.includes('deaktiviert') ? 400
                 : err.message?.includes('blockiert') ? 423
                 : err.message?.includes('nicht gefunden') ? 404
                 : 500;
    res.status(status).json({ error: err.message || 'Runbook-Generierung fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/runbook/:serverId – Gespeichertes Runbook abrufen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/runbook/:serverId', authorize('ADMIN', 'OPERATOR', 'VIEWER'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    const analysis = await prisma.aiAnalysis.findFirst({
      where: { serverId, purpose: 'runbook' },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) {
      return res.json({ success: true, result: null });
    }

    res.json({
      success: true,
      result: analysis.treeJson,
      generatedAt: analysis.createdAt,
      modelUsed: analysis.modelUsed,
      durationMs: analysis.durationMs,
    });
  } catch (err: any) {
    logger.error(`Runbook abrufen fehlgeschlagen für ${req.params.serverId}:`, err);
    res.status(500).json({ error: err.message || 'Runbook abrufen fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/ai/process-map/:serverId – Prozessmap löschen
// ═══════════════════════════════════════════════════════════════════════════
router.delete('/process-map/:serverId', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    const deleted = await prisma.aiAnalysis.deleteMany({
      where: { serverId, purpose: 'process_map' },
    });

    res.json({ success: true, deletedCount: deleted.count });
  } catch (err: any) {
    logger.error(`Process-Map Löschen fehlgeschlagen:`, err);
    res.status(500).json({ error: err.message || 'Löschen fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/log-analysis/:serverId – KI-Log-Analyse auslösen
// ═══════════════════════════════════════════════════════════════════════════
router.post('/log-analysis/:serverId', authorize('ADMIN', 'OPERATOR'), async (req: Request, res: Response) => {
  try {
    const serverId = req.params.serverId as string;
    const result = await aiService.analyzeServerLogs(serverId);
    res.json({ success: true, result });
  } catch (err: any) {
    logger.error(`Log-Analyse fehlgeschlagen für ${req.params.serverId}:`, err);
    const status = err.message?.includes('deaktiviert') ? 400
                 : err.message?.includes('blockiert') ? 423
                 : err.message?.includes('nicht gefunden') ? 404
                 : err.message?.includes('Keine Log-Daten') ? 404
                 : 500;
    res.status(status).json({ error: err.message || 'Log-Analyse fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/log-analysis/:serverId – Gespeicherte Log-Analyse abrufen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/log-analysis/:serverId', authorize('ADMIN', 'OPERATOR', 'VIEWER'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    const analysis = await prisma.aiAnalysis.findFirst({
      where: { serverId, purpose: 'log_analysis' },
      orderBy: { createdAt: 'desc' },
    });

    if (!analysis) {
      return res.json({ success: true, result: null });
    }

    res.json({
      success: true,
      result: analysis.treeJson,
      generatedAt: analysis.createdAt,
      modelUsed: analysis.modelUsed,
      durationMs: analysis.durationMs,
    });
  } catch (err: any) {
    logger.error(`Log-Analyse abrufen fehlgeschlagen für ${req.params.serverId}:`, err);
    res.status(500).json({ error: err.message || 'Log-Analyse abrufen fehlgeschlagen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/logs/:serverId – Roh-Logdaten abrufen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/logs/:serverId', authorize('ADMIN', 'OPERATOR', 'VIEWER'), async (req: Request, res: Response) => {
  try {
    const { serverId } = req.params;

    const logEntry = await prisma.serverLogEntry.findFirst({
      where: { serverId },
      orderBy: { collectedAt: 'desc' },
    });

    if (!logEntry) {
      return res.json({ success: true, logs: null });
    }

    res.json({
      success: true,
      logs: {
        journaldErrors: logEntry.journaldErrors,
        dmesgErrors: logEntry.dmesgErrors,
        syslogErrors: logEntry.syslogErrors,
        authErrors: logEntry.authErrors,
        oomEvents: logEntry.oomEvents,
        appLogs: logEntry.appLogs,
        collectedAt: logEntry.collectedAt,
      },
    });
  } catch (err: any) {
    logger.error(`Logs abrufen fehlgeschlagen für ${req.params.serverId}:`, err);
    res.status(500).json({ error: err.message || 'Logs abrufen fehlgeschlagen' });
  }
});

export default router;
