// ─── Server-Scan Worker ──────────────────────────────────────────────────
// Verarbeitet Server-Scan-Jobs aus der BullMQ-Queue

import { Worker, Job } from 'bullmq';
import { PrismaClient, ServerStatus } from '@prisma/client';
import { redisConnection } from '../queues';
import { executeGatherScript } from '../services/ssh.service';
import { mapScanDataToDb } from '../services/scan-mapper.service';
import { correlateConnections } from '../services/topology.service';
import { createSnapshotAndDiff } from '../services/diff.service';
import { evaluateAlertRules } from '../services/alert.service';
import { aiService } from '../services/ai';
import { logger } from '../logger';

const prisma = new PrismaClient();

interface ScanJobData {
  serverId: string;
  triggeredBy: string;
}

export function startScanWorker(): Worker {
  const worker = new Worker<ScanJobData>(
    'server-scan',
    async (job: Job<ScanJobData>) => {
      const { serverId, triggeredBy } = job.data;
      logger.info(`🔍 Scan-Worker: Starte Scan für Server ${serverId} (ausgelöst von ${triggeredBy})`);

      const server = await prisma.server.findUnique({ where: { id: serverId } });
      if (!server) {
        throw new Error(`Server ${serverId} nicht gefunden`);
      }

      if (!server.sshUser || !server.sshPasswordEncrypted) {
        throw new Error(`Server ${serverId}: SSH-Zugangsdaten fehlen`);
      }

      try {
        // Status auf SCANNING setzen
        await prisma.server.update({
          where: { id: serverId },
          data: { status: ServerStatus.SCANNING },
        });

        await job.updateProgress(10);

        // 1. Gather-Script via SSH ausführen
        logger.info(`📡 Verbinde mit ${server.ip}:${server.sshPort}...`);
        const rawData = await executeGatherScript({
          host: server.ip,
          port: server.sshPort,
          username: server.sshUser,
          passwordEncrypted: server.sshPasswordEncrypted,
          keyEncrypted: server.sshKeyEncrypted || undefined,
        });

        await job.updateProgress(50);

        // 2. Scan-Daten in die Datenbank mappen
        logger.info(`💾 Mappe Scan-Daten für ${server.ip}...`);
        await mapScanDataToDb(serverId, rawData);

        await job.updateProgress(80);

        // 3. Topology-Korrelation durchführen
        logger.info(`🔗 Korreliere Verbindungen für ${server.ip}...`);
        const edgeCount = await correlateConnections(serverId);

        await job.updateProgress(85);

        // 4. Snapshot erstellen + Diffs berechnen
        logger.info(`📸 Erstelle Snapshot für ${server.ip}...`);
        const diffResult = await createSnapshotAndDiff(serverId);

        await job.updateProgress(92);

        // 5. Alert-Regeln evaluieren
        let alertsTriggered = 0;
        if (diffResult.diffsCount > 0 || diffResult.isFirstScan) {
          // Diffs für Alert-Kontext laden
          const { PrismaClient: PC } = require('@prisma/client');
          const p = new PC();
          const diffs = diffResult.diffsCount > 0
            ? await p.diffEvent.findMany({ where: { snapshotId: diffResult.snapshotId } })
            : [];
          await p.$disconnect();

          alertsTriggered = await evaluateAlertRules(serverId, {
            serverId,
            diffCount: diffResult.diffsCount,
            diffs,
          });
        } else {
          // Auch ohne Diffs evaluieren (SSL, Disk, Systemd)
          alertsTriggered = await evaluateAlertRules(serverId, { serverId });
        }

        await job.updateProgress(100);

        logger.info(`✅ Scan abgeschlossen für ${server.ip}: ${edgeCount} Verbindungen, ${diffResult.diffsCount} Diffs, ${alertsTriggered} Alerts`);

        // 6. KI-Zusammenfassung generieren (wenn aktiviert)
        let aiSummaryGenerated = false;
        try {
          const summaryEnabled = await aiService.isFeatureEnabled('enableSummary');
          const blocked = await aiService.isBlocked();
          if (summaryEnabled && !blocked) {
            logger.info(`🤖 Generiere KI-Zusammenfassung für ${server.ip}...`);
            await aiService.generateServerSummary(serverId);
            aiSummaryGenerated = true;
            logger.info(`🤖 KI-Zusammenfassung erstellt für ${server.ip}`);
          }
        } catch (aiErr: any) {
          // KI-Fehler sollen den Scan NICHT zum Scheitern bringen
          logger.warn(`⚠️ KI-Zusammenfassung fehlgeschlagen für ${server.ip}: ${aiErr.message}`);
        }

        // 7. KI-Anomalie-Erkennung (Phase 5.6) – wenn aktiviert und Diffs vorhanden
        let anomalyResult: any = null;
        try {
          const anomalyEnabled = await aiService.isFeatureEnabled('enableAnomaly');
          const blocked = await aiService.isBlocked();
          if (anomalyEnabled && !blocked && diffResult.diffsCount > 0) {
            logger.info(`🔍 Starte KI-Anomalie-Check für ${server.ip} (${diffResult.diffsCount} Diffs)...`);

            // Diffs für Anomalie-Check laden
            const anomalyDiffs = await prisma.diffEvent.findMany({
              where: { snapshotId: diffResult.snapshotId },
              select: {
                id: true,
                category: true,
                changeType: true,
                itemKey: true,
                oldValue: true,
                newValue: true,
                severity: true,
              },
            });

            anomalyResult = await aiService.evaluateAnomalies(serverId, anomalyDiffs);
            logger.info(`🔍 KI-Anomalie-Check abgeschlossen für ${server.ip}: risk=${anomalyResult.overall_risk}`);
          }
        } catch (anomalyErr: any) {
          // Anomalie-Fehler sollen den Scan NICHT zum Scheitern bringen
          logger.warn(`⚠️ KI-Anomalie-Check fehlgeschlagen für ${server.ip}: ${anomalyErr.message}`);
        }

        // 8. KI-Log-Analyse – wenn aktiviert, max. 1x pro Tag
        let logAnalysisResult: any = null;
        try {
          const logAnalysisEnabled = await aiService.isFeatureEnabled('enableLogAnalysis');
          const blocked = await aiService.isBlocked();
          if (logAnalysisEnabled && !blocked) {
            // Prüfen ob heute schon eine Log-Analyse erstellt wurde
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const existingAnalysis = await prisma.aiAnalysis.findFirst({
              where: {
                serverId,
                purpose: 'log_analysis',
                createdAt: { gte: oneDayAgo },
              },
            });

            if (!existingAnalysis) {
              logger.info(`📋 Starte KI-Log-Analyse für ${server.ip}...`);
              logAnalysisResult = await aiService.analyzeServerLogs(serverId);
              logger.info(`📋 KI-Log-Analyse abgeschlossen für ${server.ip}: status=${logAnalysisResult.status}, score=${logAnalysisResult.status_score}`);
            } else {
              logger.debug(`📋 KI-Log-Analyse für ${server.ip} übersprungen (letzte Analyse < 24h)`);
            }
          }
        } catch (logErr: any) {
          // Log-Analyse-Fehler sollen den Scan NICHT zum Scheitern bringen
          logger.warn(`⚠️ KI-Log-Analyse fehlgeschlagen für ${server.ip}: ${logErr.message}`);
        }

        return {
          serverId,
          ip: server.ip,
          edgeCount,
          aiSummaryGenerated,
          anomalyRisk: anomalyResult?.overall_risk || null,
          logAnalysisStatus: logAnalysisResult?.status || null,
          timestamp: new Date().toISOString(),
        };
      } catch (err: any) {
        const errorCategory = err.category || 'UNKNOWN';
        const errorMessage = err.message || String(err);
        logger.error(`❌ Scan fehlgeschlagen für ${server.ip} [${errorCategory}]: ${errorMessage}`);

        // Detaillierte Fehlermeldung für die DB speichern
        const dbError = `[${errorCategory}] ${errorMessage}`.substring(0, 2000);
        await prisma.server.update({
          where: { id: serverId },
          data: {
            status: ServerStatus.ERROR,
            lastScanError: dbError,
          },
        });

        throw err;
      }
    },
    {
      connection: redisConnection as any,
      concurrency: 3, // Max 3 parallele Server-Scans
      limiter: {
        max: 10,
        duration: 60000, // Max 10 Scans pro Minute
      },
    }
  );

  worker.on('completed', (job) => {
    logger.info(`✅ Scan-Job ${job.id} abgeschlossen`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`❌ Scan-Job ${job?.id} fehlgeschlagen: ${err.message}`);
  });

  return worker;
}
