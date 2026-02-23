// ─── KI-Einstellungen API ─────────────────────────────────────────────────
// Phase 5.1: CRUD für AiSettings + Provider-Status/Test

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { encrypt, decrypt } from '../services/crypto.service';
import { logger } from '../logger';
import fs from 'fs';
import path from 'path';

const router = Router();
const prisma = new PrismaClient();

// Alle AI-Routen erfordern Authentifizierung
router.use(authenticate);

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────

/** Stellt sicher, dass genau eine AiSettings-Zeile existiert (Singleton) */
async function getOrCreateSettings() {
  let settings = await prisma.aiSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.aiSettings.create({
      data: { id: 1 },
    });
  }
  return settings;
}

/** Maskiert den API-Key für die Ausgabe */
function maskApiKey(key: string): string {
  if (!key || key.length < 8) return key ? '••••••••' : '';
  return key.substring(0, 4) + '••••••••' + key.substring(key.length - 4);
}

/** Bekannte Provider und deren Defaults */
const PROVIDER_DEFAULTS: Record<string, { apiUrl: string; model: string }> = {
  llamacpp: { apiUrl: 'http://localhost:8001/v1/chat/completions', model: 'gemma2' },
  ollama:   { apiUrl: 'http://localhost:11434/api/generate', model: 'qwen2.5-coder:7b' },
  openai:   { apiUrl: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  gemini:   { apiUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.0-flash' },
  claude:   { apiUrl: 'https://api.anthropic.com/v1/messages', model: 'claude-sonnet-4-20250514' },
  copilot:  { apiUrl: 'https://models.inference.ai.azure.com/chat/completions', model: 'gpt-4o' },
  custom:   { apiUrl: '', model: '' },
};

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/settings – Einstellungen laden
// ═══════════════════════════════════════════════════════════════════════════
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = await getOrCreateSettings();

    // API-Key maskiert zurückgeben
    res.json({
      ...settings,
      apiKey: maskApiKey(settings.apiKey),
      hasApiKey: settings.apiKey.length > 0,
    });
  } catch (err: any) {
    logger.error('Fehler beim Laden der KI-Einstellungen:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUT /api/ai/settings – Einstellungen aktualisieren
// ═══════════════════════════════════════════════════════════════════════════
router.put(
  '/settings',
  authorize('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const {
        provider,
        apiUrl,
        apiKey,
        model,
        enableSummary,
        enableProcessMap,
        enableAnomaly,
        enableNlp,
        enableRunbooks,
        enableLogAnalysis,
        maxTokens,
        temperature,
        contextWindow,
        timeout,
      } = req.body;

      // Validierung: Provider
      const validProviders = ['disabled', 'llamacpp', 'ollama', 'openai', 'gemini', 'claude', 'copilot', 'custom'];
      if (provider && !validProviders.includes(provider)) {
        res.status(400).json({
          error: `Ungültiger Provider. Erlaubt: ${validProviders.join(', ')}`,
        });
        return;
      }

      // Bestehende Einstellungen laden
      const current = await getOrCreateSettings();

      // Update-Objekt aufbauen – nur gesetzte Felder übernehmen
      const updateData: any = {};

      if (provider !== undefined) updateData.provider = provider;
      if (apiUrl !== undefined)   updateData.apiUrl = apiUrl;
      if (model !== undefined)    updateData.model = model;

      // API-Key: nur aktualisieren wenn explizit gesendet (nicht maskiert)
      if (apiKey !== undefined && !apiKey.includes('••••')) {
        updateData.apiKey = apiKey;
      }

      // Feature-Toggles
      if (enableSummary !== undefined)    updateData.enableSummary = Boolean(enableSummary);
      if (enableProcessMap !== undefined) updateData.enableProcessMap = Boolean(enableProcessMap);
      if (enableAnomaly !== undefined)    updateData.enableAnomaly = Boolean(enableAnomaly);
      if (enableNlp !== undefined)        updateData.enableNlp = Boolean(enableNlp);
      if (enableRunbooks !== undefined)   updateData.enableRunbooks = Boolean(enableRunbooks);
      if (enableLogAnalysis !== undefined) updateData.enableLogAnalysis = Boolean(enableLogAnalysis);

      // Erweiterte Optionen
      if (maxTokens !== undefined)    updateData.maxTokens = parseInt(maxTokens, 10) || 4096;
      if (temperature !== undefined)  updateData.temperature = parseFloat(temperature) || 0.1;
      if (contextWindow !== undefined) updateData.contextWindow = parseInt(contextWindow, 10) || 16000;
      if (timeout !== undefined)      updateData.timeout = parseInt(timeout, 10) || 300;

      // Wenn Provider auf 'disabled' → alle Features deaktivieren
      if (provider === 'disabled') {
        updateData.enableSummary = false;
        updateData.enableProcessMap = false;
        updateData.enableAnomaly = false;
        updateData.enableNlp = false;
        updateData.enableRunbooks = false;
        updateData.enableLogAnalysis = false;
      }

      const updated = await prisma.aiSettings.update({
        where: { id: 1 },
        data: updateData,
      });

      logger.info(`KI-Einstellungen aktualisiert: provider=${updated.provider}, model=${updated.model}`);

      res.json({
        ...updated,
        apiKey: maskApiKey(updated.apiKey),
        hasApiKey: updated.apiKey.length > 0,
      });
    } catch (err: any) {
      logger.error('Fehler beim Speichern der KI-Einstellungen:', err);
      res.status(500).json({ error: 'Fehler beim Speichern der Einstellungen' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/status – LLM-Verbindungsstatus prüfen
// ═══════════════════════════════════════════════════════════════════════════
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const settings = await getOrCreateSettings();

    if (settings.provider === 'disabled') {
      res.json({
        provider: 'disabled',
        available: false,
        message: 'KI ist deaktiviert',
        blocked: false,
      });
      return;
    }

    // Blocking-Check
    const blocked = settings.processMapRunning &&
      ['llamacpp', 'ollama'].includes(settings.provider);

    if (blocked) {
      res.json({
        provider: settings.provider,
        available: false,
        blocked: true,
        blockingServerId: settings.processMapServerId,
        message: 'KI-Prozessmap-Scan läuft. Alle KI-Funktionen sind vorübergehend blockiert.',
      });
      return;
    }

    // Verbindungstest je nach Provider
    let available = false;
    let message = '';
    let modelInfo: any = null;

    try {
      if (settings.provider === 'llamacpp' || settings.provider === 'custom') {
        // OpenAI-kompatibel → /v1/models oder Health-Check
        const modelsUrl = settings.apiUrl.replace('/v1/chat/completions', '/v1/models');
        const resp = await fetch(modelsUrl, {
          signal: AbortSignal.timeout(5000),
          headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
        });
        available = resp.ok;
        if (resp.ok) {
          const data = await resp.json() as any;
          modelInfo = data;
          message = 'Verbunden';
        } else {
          message = `HTTP ${resp.status}: ${resp.statusText}`;
        }
      } else if (settings.provider === 'ollama') {
        // Ollama-API: GET /api/tags
        const baseUrl = settings.apiUrl.replace(/\/api\/.*$/, '');
        const resp = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        available = resp.ok;
        if (resp.ok) {
          const data = await resp.json() as any;
          modelInfo = data;
          message = `Verbunden – ${data.models?.length || 0} Modelle verfügbar`;
        } else {
          message = `HTTP ${resp.status}: ${resp.statusText}`;
        }
      } else if (settings.provider === 'openai') {
        // OpenAI: /v1/models
        const resp = await fetch('https://api.openai.com/v1/models', {
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${settings.apiKey}` },
        });
        available = resp.ok;
        message = resp.ok ? 'Verbunden mit OpenAI' : `HTTP ${resp.status}: Ungültiger API-Key?`;
      } else if (settings.provider === 'gemini') {
        // Gemini: OpenAI-kompatiblen Endpunkt prüfen
        const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/models', {
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${settings.apiKey}` },
        });
        available = resp.ok;
        message = resp.ok ? 'Verbunden mit Google Gemini' : `HTTP ${resp.status}: Ungültiger API-Key?`;
      } else if (settings.provider === 'claude') {
        // Claude/Anthropic: Models-Endpoint prüfen
        const resp = await fetch('https://api.anthropic.com/v1/models', {
          signal: AbortSignal.timeout(5000),
          headers: {
            'x-api-key': settings.apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        available = resp.ok;
        message = resp.ok ? 'Verbunden mit Anthropic Claude' : `HTTP ${resp.status}: Ungültiger API-Key?`;
      } else if (settings.provider === 'copilot') {
        // GitHub Copilot / Models: OpenAI-kompatibel
        const resp = await fetch('https://models.inference.ai.azure.com/models', {
          signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${settings.apiKey}` },
        });
        available = resp.ok;
        message = resp.ok ? 'Verbunden mit GitHub Copilot' : `HTTP ${resp.status}: Ungültiger GitHub-Token?`;
      }
    } catch (connErr: any) {
      available = false;
      message = `Nicht erreichbar: ${connErr.message || connErr}`;
    }

    res.json({
      provider: settings.provider,
      model: settings.model,
      apiUrl: settings.apiUrl,
      available,
      blocked: false,
      message,
      modelInfo,
    });
  } catch (err: any) {
    logger.error('Fehler beim Status-Check:', err);
    res.status(500).json({ error: 'Fehler beim Status-Check' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/models – Verfügbare Modelle auflisten
// ═══════════════════════════════════════════════════════════════════════════
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const settings = await getOrCreateSettings();
    const models: Array<{ id: string; name: string; size?: string }> = [];

    if (settings.provider === 'disabled') {
      res.json({ provider: 'disabled', models: [] });
      return;
    }

    // GGUF-Dateien aus ansatz2/models/ immer auflisten (bei llamacpp)
    if (settings.provider === 'llamacpp') {
      const modelsDir = '/h/ansatz2/models';
      if (fs.existsSync(modelsDir)) {
        const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.gguf'));
        for (const f of files) {
          const stat = fs.statSync(path.join(modelsDir, f));
          const sizeMb = Math.round(stat.size / 1024 / 1024);
          models.push({
            id: f.replace('.gguf', ''),
            name: f.replace('.gguf', ''),
            size: `${sizeMb} MB`,
          });
        }
      }
    }

    try {
      if (settings.provider === 'llamacpp') {
        // llama.cpp: /v1/models Endpunkt (aktuell geladenes Modell)
        const modelsUrl = settings.apiUrl.replace('/v1/chat/completions', '/v1/models');
        const resp = await fetch(modelsUrl, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const data = await resp.json() as any;
          if (data.data && Array.isArray(data.data)) {
            for (const m of data.data) {
              const existing = models.find(mod => mod.id === m.id);
              if (!existing) {
                models.push({ id: m.id, name: m.id });
              }
            }
          }
        }
      } else if (settings.provider === 'ollama') {
        // Ollama: GET /api/tags
        const baseUrl = settings.apiUrl.replace(/\/api\/.*$/, '');
        const resp = await fetch(`${baseUrl}/api/tags`, {
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          const data = await resp.json() as any;
          for (const m of (data.models || [])) {
            const sizeMb = m.size ? Math.round(m.size / 1024 / 1024) : undefined;
            models.push({
              id: m.name || m.model,
              name: m.name || m.model,
              size: sizeMb ? `${sizeMb} MB` : undefined,
            });
          }
        }
      } else if (settings.provider === 'openai') {
        // OpenAI: fest definierte Modelle
        models.push(
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
        );
      } else if (settings.provider === 'gemini') {
        // Gemini: fest definierte Modelle
        models.push(
          { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
          { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite' },
          { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
          { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
        );
      } else if (settings.provider === 'claude') {
        // Claude/Anthropic: fest definierte Modelle
        models.push(
          { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
        );
      } else if (settings.provider === 'copilot') {
        // GitHub Copilot / Models: verfügbare Modelle
        models.push(
          { id: 'gpt-4o', name: 'GPT-4o (via GitHub)' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini (via GitHub)' },
          { id: 'o3-mini', name: 'o3-mini (via GitHub)' },
          { id: 'Mistral-Large-2411', name: 'Mistral Large (via GitHub)' },
          { id: 'DeepSeek-R1', name: 'DeepSeek R1 (via GitHub)' },
          { id: 'Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B (via GitHub)' },
        );
      } else if (settings.provider === 'custom') {
        // Custom: /v1/models probieren
        const modelsUrl = settings.apiUrl.replace('/v1/chat/completions', '/v1/models');
        const resp = await fetch(modelsUrl, {
          signal: AbortSignal.timeout(5000),
          headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
        });
        if (resp.ok) {
          const data = await resp.json() as any;
          if (data.data && Array.isArray(data.data)) {
            for (const m of data.data) {
              models.push({ id: m.id, name: m.id });
            }
          }
        }
      }
    } catch (err: any) {
      logger.warn('Modell-Abfrage fehlgeschlagen:', err.message);
    }

    res.json({ provider: settings.provider, models });
  } catch (err: any) {
    logger.error('Fehler beim Modell-Listing:', err);
    res.status(500).json({ error: 'Fehler beim Laden der Modelle' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/ai/test – Verbindungstest mit Mini-Prompt
// ═══════════════════════════════════════════════════════════════════════════
router.post('/test', authorize('ADMIN'), async (req: Request, res: Response) => {
  try {
    const settings = await getOrCreateSettings();

    if (settings.provider === 'disabled') {
      res.status(400).json({ error: 'KI ist deaktiviert. Bitte Provider konfigurieren.' });
      return;
    }

    // Optional: Temporäre Einstellungen aus dem Request nutzen (für Test VOR Speichern)
    const testApiUrl = req.body.apiUrl || settings.apiUrl;
    const testModel = req.body.model || settings.model;
    const testApiKey = req.body.apiKey || settings.apiKey;
    const testProvider = req.body.provider || settings.provider;

    if (!testApiUrl) {
      res.status(400).json({ error: 'Keine API-URL konfiguriert' });
      return;
    }

    const startTime = Date.now();
    let response = '';
    let success = false;

    try {
      if (testProvider === 'ollama') {
        // Ollama-Format
        const resp = await fetch(testApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: testModel,
            prompt: 'Antworte nur mit dem Wort: OK',
            stream: false,
            options: { temperature: 0, num_predict: 10 },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
        }

        const data = await resp.json() as any;
        response = data.response || '';
        success = true;
      } else if (testProvider === 'claude') {
        // Anthropic Claude – eigenes API-Format
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        };
        if (testApiKey && !testApiKey.includes('••••')) {
          headers['x-api-key'] = testApiKey;
        }

        const resp = await fetch(testApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: testModel,
            max_tokens: 10,
            messages: [
              { role: 'user', content: 'Antworte nur mit dem Wort: OK' },
            ],
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
        }

        const data = await resp.json() as any;
        response = data.content?.[0]?.text || '';
        success = true;
      } else {
        // OpenAI-kompatibel (llamacpp, openai, gemini, copilot, custom)
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (testApiKey && !testApiKey.includes('••••')) {
          headers['Authorization'] = `Bearer ${testApiKey}`;
        }

        const resp = await fetch(testApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: testModel,
            messages: [
              { role: 'user', content: 'Antworte nur mit dem Wort: OK' },
            ],
            temperature: 0,
            max_tokens: 10,
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text.substring(0, 200)}`);
        }

        const data = await resp.json() as any;
        response = data.choices?.[0]?.message?.content || '';
        success = true;
      }
    } catch (testErr: any) {
      res.json({
        success: false,
        error: testErr.message || 'Verbindung fehlgeschlagen',
        durationMs: Date.now() - startTime,
      });
      return;
    }

    const durationMs = Date.now() - startTime;

    logger.info(`KI-Verbindungstest: provider=${testProvider}, model=${testModel}, ${durationMs}ms, response="${response.substring(0, 50)}"`);

    res.json({
      success,
      response: response.trim(),
      model: testModel,
      provider: testProvider,
      durationMs,
    });
  } catch (err: any) {
    logger.error('Fehler beim KI-Verbindungstest:', err);
    res.status(500).json({ error: 'Fehler beim Verbindungstest' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/ai/providers – Verfügbare Provider mit Defaults
// ═══════════════════════════════════════════════════════════════════════════
router.get('/providers', (_req: Request, res: Response) => {
  res.json({
    providers: [
      {
        id: 'disabled',
        name: 'Deaktiviert',
        description: 'Alle KI-Funktionen sind deaktiviert',
        local: false,
        defaults: { apiUrl: '', model: '' },
      },
      {
        id: 'llamacpp',
        name: 'llama.cpp (lokal)',
        description: 'Lokaler LLM-Server via llama.cpp – GGUF-Modelle',
        local: true,
        defaults: PROVIDER_DEFAULTS.llamacpp,
      },
      {
        id: 'ollama',
        name: 'Ollama (lokal/remote)',
        description: 'Ollama LLM-Server – einfache Modellverwaltung',
        local: true,
        defaults: PROVIDER_DEFAULTS.ollama,
      },
      {
        id: 'openai',
        name: 'OpenAI API',
        description: 'OpenAI Cloud API – Daten werden an externe Server gesendet',
        local: false,
        requiresApiKey: true,
        privacyWarning: 'Server-Konfigurationen werden an OpenAI übertragen. Nur in nicht-kritischen Umgebungen verwenden.',
        defaults: PROVIDER_DEFAULTS.openai,
      },
      {
        id: 'gemini',
        name: 'Google Gemini',
        description: 'Google Gemini API – OpenAI-kompatibel via AI Studio',
        local: false,
        requiresApiKey: true,
        privacyWarning: 'Server-Konfigurationen werden an Google übertragen. Nur in nicht-kritischen Umgebungen verwenden.',
        defaults: PROVIDER_DEFAULTS.gemini,
      },
      {
        id: 'claude',
        name: 'Anthropic Claude',
        description: 'Anthropic Claude API – eigenes API-Format',
        local: false,
        requiresApiKey: true,
        privacyWarning: 'Server-Konfigurationen werden an Anthropic übertragen. Nur in nicht-kritischen Umgebungen verwenden.',
        defaults: PROVIDER_DEFAULTS.claude,
      },
      {
        id: 'copilot',
        name: 'GitHub Copilot',
        description: 'GitHub Models API – nutzt GitHub PAT (Personal Access Token)',
        local: false,
        requiresApiKey: true,
        privacyWarning: 'Server-Konfigurationen werden an GitHub/Azure übertragen. Nur in nicht-kritischen Umgebungen verwenden.',
        defaults: PROVIDER_DEFAULTS.copilot,
      },
      {
        id: 'custom',
        name: 'Benutzerdefiniert',
        description: 'Beliebiger OpenAI-kompatibler Endpunkt',
        local: false,
        defaults: PROVIDER_DEFAULTS.custom,
      },
    ],
  });
});

export default router;
