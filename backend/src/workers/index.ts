// ─── Worker-Startpunkt ──────────────────────────────────────────────────
// Startet alle BullMQ-Worker-Prozesse

import { config, validateConfig } from '../config';
import { startScanWorker } from './scan.worker';
import { startNetworkScanWorker } from './network-discovery.worker';
import { startProcessMapWorker } from './process-map.worker';
import { logger } from '../logger';

validateConfig();

logger.info('🚀 SystemMAP Worker-Prozess wird gestartet...');

const scanWorker = startScanWorker();
logger.info('✅ Server-Scan Worker aktiv (Concurrency: 3)');

const networkWorker = startNetworkScanWorker();
logger.info('✅ Network-Discovery Worker aktiv (Concurrency: 1)');

const processMapWorker = startProcessMapWorker();
logger.info('✅ Process-Map Worker aktiv (Concurrency: 1)');

// Graceful Shutdown
process.on('SIGTERM', async () => {
  logger.info('⏳ Shutting down workers...');
  await scanWorker.close();
  await networkWorker.close();
  await processMapWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('⏳ Shutting down workers...');
  await scanWorker.close();
  await networkWorker.close();
  await processMapWorker.close();
  process.exit(0);
});
