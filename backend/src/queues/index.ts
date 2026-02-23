// ─── BullMQ Queue-Konfiguration ──────────────────────────────────────────

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';

// Gemeinsame Redis-Verbindung für alle Queues
export const redisConnection = new IORedis({
  host: config.redis.host,
  port: config.redis.port,
  maxRetriesPerRequest: null, // BullMQ-Anforderung
});

// Cast nötig wegen ioredis-Versionskonflikt (top-level vs bullmq-bundled)
const conn = redisConnection as any;

// ─── Server-Scan Queue ──────────────────────────────────────────────────
// Deep-Dive Analyse einzelner Server via SSH
export const scanQueue = new Queue('server-scan', {
  connection: conn,
  defaultJobOptions: {
    removeOnComplete: { age: 86400, count: 100 },  // 24h oder max 100
    removeOnFail: { age: 604800, count: 200 },     // 7 Tage oder max 200
  },
});

// ─── Netzwerk-Scan Queue ────────────────────────────────────────────────
// Nmap-Discovery-Scans
export const networkScanQueue = new Queue('network-scan', {
  connection: conn,
  defaultJobOptions: {
    removeOnComplete: { age: 86400, count: 50 },
    removeOnFail: { age: 604800, count: 100 },
  },
});

// ─── KI-Analyse Queue (Etappe 5) ───────────────────────────────────────
// Streng sequenziell – Concurrency: 1
export const aiQueue = new Queue('ai-analysis', {
  connection: conn,
  defaultJobOptions: {
    removeOnComplete: { age: 604800, count: 50 },
    removeOnFail: { age: 604800, count: 50 },
  },
});

// ─── Process-Map Queue (Phase 5.5) ─────────────────────────────────────
// KI-Prozessmap-Scans – Concurrency: 1
export const processMapQueue = new Queue('process-map', {
  connection: conn,
  defaultJobOptions: {
    removeOnComplete: { age: 604800, count: 20 },
    removeOnFail: { age: 604800, count: 20 },
    attempts: 1, // Kein Retry – zu langwierig
  },
});
