// ─── SystemMAP Backend – Haupteinstiegspunkt ──────────────────────────────

// BigInt JSON-Serialisierung (Prisma gibt BigInt für große Zahlen zurück)
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

import express from 'express';
import cors from 'cors';
import { config, validateConfig } from './config';
import { selfTest } from './services/crypto.service';
import { startScheduler } from './services/scheduler.service';
import { logger } from './logger';

// Routes
import authRoutes from './routes/auth.routes';
import serverRoutes from './routes/server.routes';
import scanRoutes from './routes/scan.routes';
import topologyRoutes from './routes/topology.routes';
import dashboardRoutes from './routes/dashboard.routes';
import scheduleRoutes from './routes/schedule.routes';
import discoveryRoutes from './routes/discovery.routes';
import diffRoutes from './routes/diff.routes';
import alertRoutes from './routes/alert.routes';
import exportRoutes from './routes/export.routes';
import aiSettingsRoutes from './routes/ai-settings.routes';
import aiRoutes from './routes/ai.routes';
import { ensureDefaultRules } from './services/alert.service';

// ─── Konfiguration validieren ────────────────────────────────────────────
validateConfig();

// ─── Crypto Self-Test ────────────────────────────────────────────────────
if (!selfTest()) {
  logger.error('❌ Crypto Self-Test fehlgeschlagen! ENCRYPTION_MASTER_KEY prüfen.');
  process.exit(1);
}
logger.info('🔐 Crypto Self-Test bestanden');

// ─── Express App ─────────────────────────────────────────────────────────
const app = express();

// Middleware
app.use(cors({
  origin: config.nodeEnv === 'development'
    ? ['http://localhost:5173', 'http://localhost:3000']
    : process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Request-Logging
app.use((req, _res, next) => {
  if (config.nodeEnv === 'development') {
    logger.debug(`${req.method} ${req.path}`);
  }
  next();
});

// ─── API Routes ──────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/scans', scanRoutes);
app.use('/api/topology', topologyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/diffs', diffRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/ai', aiSettingsRoutes);
app.use('/api/ai', aiRoutes);

// Health-Check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Route nicht gefunden' });
});

// Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unbehandelter Fehler:', err);
  res.status(500).json({
    error: config.nodeEnv === 'development' ? err.message : 'Interner Serverfehler',
  });
});

// ─── Server starten ──────────────────────────────────────────────────────
app.listen(config.port, () => {
  logger.info(`🚀 SystemMAP Backend läuft auf Port ${config.port}`);
  logger.info(`📊 Environment: ${config.nodeEnv}`);
  logger.info(`🔗 API: http://localhost:${config.port}/api`);

  // Scheduler starten
  startScheduler();

  // Standard-Alertregeln sicherstellen
  ensureDefaultRules().catch(err => logger.error('Alertregeln-Init fehlgeschlagen:', err));
});

export default app;
