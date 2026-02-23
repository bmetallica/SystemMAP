// ─── KI-Einstellungen ─────────────────────────────────────────────────────
// Phase 5.2: Settings-Page für KI/LLM-Konfiguration

import { useState, useEffect, useCallback } from 'react';
import api from '../api/client';

// ─── Typen ────────────────────────────────────────────────────────────────

interface AiSettingsData {
  provider: string;
  apiUrl: string;
  apiKey: string;
  hasApiKey: boolean;
  model: string;
  enableSummary: boolean;
  enableProcessMap: boolean;
  enableAnomaly: boolean;
  enableNlp: boolean;
  enableRunbooks: boolean;
  enableLogAnalysis: boolean;
  maxTokens: number;
  temperature: number;
  contextWindow: number;
  timeout: number;
  processMapRunning: boolean;
  processMapServerId: number | null;
  updatedAt: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  local: boolean;
  requiresApiKey?: boolean;
  privacyWarning?: string;
  defaults: { apiUrl: string; model: string };
}

interface ModelInfo {
  id: string;
  name: string;
  size?: string;
}

interface TestResult {
  success: boolean;
  response?: string;
  error?: string;
  durationMs: number;
  model?: string;
  provider?: string;
}

interface StatusInfo {
  provider: string;
  available: boolean;
  blocked: boolean;
  message: string;
  model?: string;
  apiUrl?: string;
  blockingServerId?: number;
}

// ─── Komponente ───────────────────────────────────────────────────────────

export default function AiSettings() {
  // ── State ───────────────────────────────────────────────────────────────
  const [settings, setSettings] = useState<AiSettingsData | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Lokale Formular-Werte
  const [form, setForm] = useState({
    provider: 'disabled',
    apiUrl: '',
    apiKey: '',
    model: '',
    enableSummary: false,
    enableProcessMap: false,
    enableAnomaly: false,
    enableNlp: false,
    enableRunbooks: false,
    enableLogAnalysis: false,
    maxTokens: 4096,
    temperature: 0.1,
    contextWindow: 16000,
    timeout: 300,
  });

  // ── Daten laden ─────────────────────────────────────────────────────────

  const loadSettings = useCallback(async () => {
    try {
      const [settingsRes, providersRes, statusRes] = await Promise.all([
        api.get('/ai/settings'),
        api.get('/ai/providers'),
        api.get('/ai/status'),
      ]);

      const s = settingsRes.data;
      setSettings(s);
      setProviders(providersRes.data.providers);
      setStatus(statusRes.data);

      setForm({
        provider: s.provider,
        apiUrl: s.apiUrl,
        apiKey: s.apiKey,
        model: s.model,
        enableSummary: s.enableSummary,
        enableProcessMap: s.enableProcessMap,
        enableAnomaly: s.enableAnomaly,
        enableNlp: s.enableNlp,
        enableRunbooks: s.enableRunbooks,
        enableLogAnalysis: s.enableLogAnalysis,
        maxTokens: s.maxTokens,
        temperature: s.temperature,
        contextWindow: s.contextWindow,
        timeout: s.timeout,
      });
      setDirty(false);
    } catch (err: any) {
      setError('Fehler beim Laden der KI-Einstellungen');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    try {
      const res = await api.get('/ai/models');
      setModels(res.data.models || []);
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Modelle laden wenn Provider != disabled
  useEffect(() => {
    if (settings && settings.provider !== 'disabled') {
      loadModels();
    }
  }, [settings?.provider, loadModels]);

  // ── Form-Handler ────────────────────────────────────────────────────────

  const updateForm = (field: string, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
    setError('');
    setSuccess('');
  };

  const handleProviderChange = (newProvider: string) => {
    const provider = providers.find((p) => p.id === newProvider);
    setForm((prev) => ({
      ...prev,
      provider: newProvider,
      apiUrl: provider?.defaults?.apiUrl || prev.apiUrl,
      model: provider?.defaults?.model || prev.model,
      apiKey: newProvider === 'disabled' ? '' : prev.apiKey,
    }));
    setDirty(true);
    setTestResult(null);
    setError('');
    setSuccess('');
  };

  // ── Speichern ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload: any = { ...form };
      // Maskierten Key nicht senden
      if (payload.apiKey && payload.apiKey.includes('••••')) {
        delete payload.apiKey;
      }
      const res = await api.put('/ai/settings', payload);
      setSettings(res.data);
      setDirty(false);
      setSuccess('Einstellungen gespeichert');

      // Status neu laden
      const statusRes = await api.get('/ai/status');
      setStatus(statusRes.data);

      // Modelle neu laden wenn Provider aktiv
      if (form.provider !== 'disabled') {
        loadModels();
      } else {
        setModels([]);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  // ── Verbindungstest ─────────────────────────────────────────────────────

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload: any = {
        provider: form.provider,
        apiUrl: form.apiUrl,
        model: form.model,
      };
      // API-Key nur senden wenn nicht maskiert
      if (form.apiKey && !form.apiKey.includes('••••')) {
        payload.apiKey = form.apiKey;
      }
      const res = await api.post('/ai/test', payload);
      setTestResult(res.data);
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.response?.data?.error || 'Test fehlgeschlagen',
        durationMs: 0,
      });
    } finally {
      setTesting(false);
    }
  };

  // ── Hilfsfunktionen ────────────────────────────────────────────────────

  const currentProvider = providers.find((p) => p.id === form.provider);
  const isDisabled = form.provider === 'disabled';

  const featureToggles = [
    { key: 'enableSummary', label: 'Server-Zusammenfassung', icon: '📝', desc: 'Erstellt eine KI-Zusammenfassung der Server-Konfiguration nach jedem Scan' },
    { key: 'enableProcessMap', label: 'KI-Prozessmap', icon: '🗺️', desc: 'Generiert eine hierarchische Baumstruktur aller Prozesse und deren Konfigurationen' },
    { key: 'enableAnomaly', label: 'Anomalie-Erkennung', icon: '🔍', desc: 'Analysiert Konfigurations-Änderungen auf potenzielle Probleme' },
    { key: 'enableNlp', label: 'NLP-Abfragen', icon: '💬', desc: 'Ermöglicht natürlichsprachige Fragen an die Infrastruktur-Daten' },
    { key: 'enableRunbooks', label: 'Auto-Runbooks', icon: '📋', desc: 'Generiert automatisch Runbooks aus der erkannten Infrastruktur' },
    { key: 'enableLogAnalysis', label: 'Log-Analyse', icon: '🏥', desc: 'Analysiert Fehler-Logs (journald, dmesg, syslog, auth) per KI und gibt Handlungsempfehlungen' },
  ] as const;

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        <span className="ml-3 text-gray-400">KI-Einstellungen laden…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            🤖 KI-Einstellungen
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Konfiguration der LLM/KI-Integration – alle Funktionen sind standardmäßig deaktiviert
          </p>
        </div>
        {/* Status-Badge */}
        {status && (
          <div
            className={`px-3 py-1.5 rounded-full text-sm font-medium ${
              status.provider === 'disabled'
                ? 'bg-gray-700 text-gray-300'
                : status.blocked
                ? 'bg-yellow-900/50 text-yellow-300 border border-yellow-700'
                : status.available
                ? 'bg-green-900/50 text-green-300 border border-green-700'
                : 'bg-red-900/50 text-red-300 border border-red-700'
            }`}
          >
            {status.provider === 'disabled'
              ? '⭘ Deaktiviert'
              : status.blocked
              ? '⏳ Blockiert'
              : status.available
              ? '● Verbunden'
              : '○ Nicht verbunden'}
          </div>
        )}
      </div>

      {/* Meldungen */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 px-4 py-3 rounded-lg">
          ❌ {error}
        </div>
      )}
      {success && (
        <div className="bg-green-900/30 border border-green-700 text-green-300 px-4 py-3 rounded-lg">
          ✅ {success}
        </div>
      )}

      {/* Blocking-Warnung */}
      {status?.blocked && (
        <div className="bg-yellow-900/30 border border-yellow-700 text-yellow-200 px-4 py-3 rounded-lg">
          ⚠️ <strong>KI-Prozessmap-Scan läuft</strong> – Alle KI-Funktionen sind vorübergehend blockiert,
          da der lokale LLM-Server exklusiv genutzt wird.
          {status.blockingServerId && ` (Server-ID: ${status.blockingServerId})`}
        </div>
      )}

      {/* ═══ Provider-Auswahl ═══ */}
      <section className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          ⚡ LLM-Provider
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => handleProviderChange(p.id)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                form.provider === p.id
                  ? 'border-blue-500 bg-blue-900/30'
                  : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-white text-sm">{p.name}</span>
                {p.local && (
                  <span className="text-xs bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">
                    Lokal
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">{p.description}</p>
            </button>
          ))}
        </div>

        {/* Privacy-Warnung */}
        {currentProvider?.privacyWarning && (
          <div className="mt-4 bg-orange-900/30 border border-orange-700 text-orange-200 px-4 py-3 rounded-lg text-sm">
            ⚠️ <strong>Datenschutz-Hinweis:</strong> {currentProvider.privacyWarning}
          </div>
        )}
      </section>

      {/* ═══ Verbindungs-Einstellungen ═══ */}
      {!isDisabled && (
        <section className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            🔌 Verbindung
          </h2>

          <div className="space-y-4">
            {/* API-URL */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                API-URL
              </label>
              <input
                type="text"
                value={form.apiUrl}
                onChange={(e) => updateForm('apiUrl', e.target.value)}
                placeholder="http://localhost:8001/v1/chat/completions"
                className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5
                           focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500
                           font-mono text-sm"
              />
            </div>

            {/* API-Key */}
            {(currentProvider?.requiresApiKey || form.provider === 'custom') && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  API-Key
                </label>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => updateForm('apiKey', e.target.value)}
                  placeholder={settings?.hasApiKey ? 'Gespeichert (zum Ändern neuen Key eingeben)' : 'API-Key eingeben'}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500
                             font-mono text-sm"
                />
                {settings?.hasApiKey && (
                  <p className="text-xs text-gray-500 mt-1">
                    🔒 Ein API-Key ist gespeichert. Leer lassen um den bestehenden zu behalten.
                  </p>
                )}
              </div>
            )}

            {/* Modell-Auswahl */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Modell
              </label>
              <div className="flex gap-2">
                <select
                  value={form.model}
                  onChange={(e) => updateForm('model', e.target.value)}
                  className="flex-1 bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">— Modell wählen —</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.size ? ` (${m.size})` : ''}
                    </option>
                  ))}
                  {/* Auch freie Eingabe ermöglichen */}
                  {form.model && !models.find((m) => m.id === form.model) && (
                    <option value={form.model}>{form.model} (benutzerdefiniert)</option>
                  )}
                </select>
                <button
                  onClick={loadModels}
                  disabled={modelsLoading}
                  className="px-3 py-2 bg-gray-700 border border-gray-600 text-gray-300 rounded-lg
                             hover:bg-gray-600 transition-colors disabled:opacity-50"
                  title="Modelle neu laden"
                >
                  {modelsLoading ? '⟳' : '🔄'}
                </button>
              </div>
              {modelsLoading && (
                <p className="text-xs text-gray-500 mt-1">Modelle werden geladen…</p>
              )}
              {!modelsLoading && models.length === 0 && form.provider !== 'disabled' && (
                <p className="text-xs text-yellow-500 mt-1">
                  Keine Modelle gefunden. Ist der Server erreichbar?
                </p>
              )}
            </div>

            {/* Verbindungstest */}
            <div className="pt-2">
              <button
                onClick={handleTest}
                disabled={testing || !form.apiUrl}
                className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-500
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                           font-medium text-sm flex items-center gap-2"
              >
                {testing ? (
                  <>
                    <span className="animate-spin">⟳</span> Teste Verbindung…
                  </>
                ) : (
                  <>🔗 Verbindung testen</>
                )}
              </button>

              {/* Test-Ergebnis */}
              {testResult && (
                <div
                  className={`mt-3 px-4 py-3 rounded-lg border text-sm ${
                    testResult.success
                      ? 'bg-green-900/30 border-green-700 text-green-200'
                      : 'bg-red-900/30 border-red-700 text-red-200'
                  }`}
                >
                  {testResult.success ? (
                    <>
                      <p className="font-medium">✅ Verbindung erfolgreich!</p>
                      <p className="text-xs mt-1 opacity-80">
                        Antwort: „{testResult.response}" • Dauer: {testResult.durationMs}ms
                        {testResult.model && ` • Modell: ${testResult.model}`}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">❌ Verbindung fehlgeschlagen</p>
                      <p className="text-xs mt-1 opacity-80">{testResult.error}</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ═══ Feature-Toggles ═══ */}
      <section className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
          🎛️ KI-Funktionen
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Einzelne KI-Funktionen aktivieren oder deaktivieren. Alle sind standardmäßig aus.
        </p>

        {isDisabled && (
          <div className="bg-gray-700/50 rounded-lg px-4 py-3 text-gray-400 text-sm mb-4">
            💡 Wähle einen Provider aus, um KI-Funktionen aktivieren zu können.
          </div>
        )}

        <div className="space-y-3">
          {featureToggles.map((ft) => (
            <div
              key={ft.key}
              className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                (form as any)[ft.key]
                  ? 'border-blue-600/50 bg-blue-900/20'
                  : 'border-gray-700 bg-gray-700/30'
              } ${isDisabled ? 'opacity-50' : ''}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl">{ft.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{ft.label}</p>
                  <p className="text-xs text-gray-400 truncate">{ft.desc}</p>
                </div>
              </div>
              <button
                onClick={() => updateForm(ft.key, !(form as any)[ft.key])}
                disabled={isDisabled}
                className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                  (form as any)[ft.key] ? 'bg-blue-600' : 'bg-gray-600'
                } ${isDisabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                    (form as any)[ft.key] ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Erweiterte Einstellungen ═══ */}
      {!isDisabled && (
        <section className="bg-gray-800 rounded-xl border border-gray-700">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-700/50 rounded-xl transition-colors"
          >
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              ⚙️ Erweiterte Einstellungen
            </h2>
            <span className={`text-gray-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>

          {showAdvanced && (
            <div className="px-6 pb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Max Tokens */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={form.maxTokens}
                  onChange={(e) => updateForm('maxTokens', parseInt(e.target.value) || 4096)}
                  min={256}
                  max={128000}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Maximale Ausgabelänge pro Anfrage</p>
              </div>

              {/* Temperature */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Temperatur: {form.temperature}
                </label>
                <input
                  type="range"
                  value={form.temperature}
                  onChange={(e) => updateForm('temperature', parseFloat(e.target.value))}
                  min={0}
                  max={2}
                  step={0.05}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>0 (Deterministisch)</span>
                  <span>2 (Kreativ)</span>
                </div>
              </div>

              {/* Context Window */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Context Window
                </label>
                <input
                  type="number"
                  value={form.contextWindow}
                  onChange={(e) => updateForm('contextWindow', parseInt(e.target.value) || 16000)}
                  min={2048}
                  max={131072}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">n_ctx für llama.cpp / Kontextgröße</p>
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Timeout (Sekunden)
                </label>
                <input
                  type="number"
                  value={form.timeout}
                  onChange={(e) => updateForm('timeout', parseInt(e.target.value) || 300)}
                  min={30}
                  max={3600}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded-lg px-4 py-2.5
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Maximale Wartezeit pro KI-Anfrage</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ═══ Speichern-Leiste ═══ */}
      <div className="flex items-center justify-between bg-gray-800 rounded-xl border border-gray-700 p-4 sticky bottom-4">
        <div className="text-sm text-gray-400">
          {dirty ? (
            <span className="text-yellow-400">● Ungespeicherte Änderungen</span>
          ) : settings?.updatedAt ? (
            <span>
              Zuletzt gespeichert: {new Date(settings.updatedAt).toLocaleString('de-DE')}
            </span>
          ) : null}
        </div>
        <div className="flex gap-3">
          {dirty && (
            <button
              onClick={() => {
                if (settings) {
                  setForm({
                    provider: settings.provider,
                    apiUrl: settings.apiUrl,
                    apiKey: settings.apiKey,
                    model: settings.model,
                    enableSummary: settings.enableSummary,
                    enableProcessMap: settings.enableProcessMap,
                    enableAnomaly: settings.enableAnomaly,
                    enableNlp: settings.enableNlp,
                    enableRunbooks: settings.enableRunbooks,
                    enableLogAnalysis: settings.enableLogAnalysis,
                    maxTokens: settings.maxTokens,
                    temperature: settings.temperature,
                    contextWindow: settings.contextWindow,
                    timeout: settings.timeout,
                  });
                  setDirty(false);
                  setTestResult(null);
                }
              }}
              className="px-4 py-2 text-sm text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600 transition-colors"
            >
              Verwerfen
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg
                       hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors flex items-center gap-2"
          >
            {saving ? (
              <>
                <span className="animate-spin">⟳</span> Speichern…
              </>
            ) : (
              <>💾 Speichern</>
            )}
          </button>
        </div>
      </div>

      {/* ═══ Info-Box ═══ */}
      <section className="bg-gray-800/50 rounded-xl border border-gray-700/50 p-5 text-sm text-gray-400">
        <h3 className="font-semibold text-gray-300 mb-2">ℹ️ Hinweise</h3>
        <ul className="space-y-1.5 list-disc list-inside">
          <li>
            Bei Verwendung von <strong className="text-gray-300">llama.cpp</strong> oder <strong className="text-gray-300">Ollama</strong> (lokal)
            werden während eines KI-Prozessmap-Scans alle anderen KI-Funktionen blockiert.
          </li>
          <li>
            GGUF-Modelle werden aus <code className="text-xs bg-gray-700 px-1 py-0.5 rounded">/h/ansatz2/models/</code> geladen
            und müssen manuell dort abgelegt werden.
          </li>
          <li>
            Bei <strong className="text-gray-300">OpenAI</strong> und externen Providern werden
            Server-Konfigurationsdaten an den jeweiligen Dienst übertragen.
          </li>
          <li>
            Alle KI-Scans müssen <strong className="text-gray-300">manuell ausgelöst</strong> werden –
            es gibt keine automatische KI-Analyse.
          </li>
        </ul>
      </section>
    </div>
  );
}
