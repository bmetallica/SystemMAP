// ─── KI-Chat (NLP-Abfragen) ───────────────────────────────────────────────
// Phase 5.7: Natürlichsprachige Fragen an die Infrastruktur-Daten

import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api/client';

// ─── Typen ────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  model?: string;
  provider?: string;
  durationMs?: number;
  error?: boolean;
}

interface ServerOption {
  id: string;
  ip: string;
  hostname: string | null;
  aiPurpose: string | null;
}

interface HealthInfo {
  available: boolean;
  blocked: boolean;
  provider: string;
  model: string;
  enabledFeatures: string[];
}

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function formatDuration(ms?: number) {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Einfaches Markdown → HTML (fett, kursiv, code, listen, headers)
function renderMarkdown(text: string): string {
  return text
    // Code-Blöcke
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-gray-900 rounded p-3 my-2 overflow-x-auto text-sm"><code>$2</code></pre>')
    // Inline-Code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-700 px-1.5 py-0.5 rounded text-sm text-emerald-300">$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold text-white mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold text-white mt-3 mb-1">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold text-white mt-3 mb-1">$1</h1>')
    // Fett + Kursiv
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Aufzählungen
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    // Zeilenumbrüche
    .replace(/\n\n/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}

// ─── Vorschläge ───────────────────────────────────────────────────────────

const SUGGESTIONS = [
  { icon: '🔍', text: 'Welche Server haben abgelaufene SSL-Zertifikate?' },
  { icon: '🐳', text: 'Zeige mir alle Server mit Docker-Containern' },
  { icon: '⚠️', text: 'Gibt es Server mit kritischen Alarmen?' },
  { icon: '📊', text: 'Fasse den aktuellen Zustand meiner Infrastruktur zusammen' },
  { icon: '🔧', text: 'Welche Services laufen auf den meisten Servern?' },
  { icon: '💾', text: 'Gibt es Server mit wenig Speicherplatz?' },
];

// ─── Komponente ───────────────────────────────────────────────────────────

export default function AiChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [selectedServer, setSelectedServer] = useState<string>('');
  const [showServerCtx, setShowServerCtx] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Health + Server-Liste laden
  useEffect(() => {
    Promise.all([
      api.get('/ai/health').catch(() => ({ data: null })),
      api.get('/servers').catch(() => ({ data: [] })),
    ]).then(([healthRes, serversRes]) => {
      setHealth(healthRes.data);
      setServers(
        (serversRes.data || []).map((s: any) => ({
          id: s.id,
          ip: s.ip,
          hostname: s.hostname,
          aiPurpose: s.aiPurpose,
        }))
      );
      setHealthLoading(false);
    });
  }, []);

  const nlpEnabled = health?.enabledFeatures?.includes('nlp');

  // Nachricht senden
  const sendMessage = useCallback(async (text?: string) => {
    const prompt = (text || input).trim();
    if (!prompt || loading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: prompt,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // System-Prompt mit Server-Kontext bauen
      let systemPrompt = `Du bist ein hilfreicher Infrastruktur-Assistent für SystemMAP. 
Du beantwortest Fragen über Server, Services, Docker-Container, SSL-Zertifikate, Netzwerk-Topologie und System-Konfigurationen.
Antworte auf Deutsch, präzise und strukturiert. Verwende Markdown für Formatierung.
Aktuelles Datum: ${new Date().toLocaleDateString('de-DE')}.`;

      // Wenn ein Server ausgewählt ist, Kontext laden
      if (selectedServer) {
        try {
          const serverRes = await api.get(`/servers/${selectedServer}`);
          const s = serverRes.data;
          systemPrompt += `\n\nKontext – ausgewählter Server:
- IP: ${s.ip}
- Hostname: ${s.hostname || 'unbekannt'}
- OS: ${s.osInfo || 'unbekannt'}
- Status: ${s.status}
- Docker-Container: ${s.dockerContainers?.length || 0}
- Services: ${s.services?.length || 0}
- Systemd-Units: ${s.systemdUnits?.length || 0}
- Mounts: ${s.mounts?.length || 0}
- SSL-Zertifikate: ${s.sslCertificates?.length || 0}
- KI-Zusammenfassung: ${s.aiSummary || 'nicht vorhanden'}
- KI-Zweck: ${s.aiPurpose || 'nicht klassifiziert'}
- KI-Tags: ${(s.aiTags || []).join(', ') || 'keine'}`;

          if (s.dockerContainers?.length > 0) {
            const containers = s.dockerContainers.slice(0, 20).map((c: any) =>
              `  - ${c.name} (${c.image}) [${c.state}]`
            ).join('\n');
            systemPrompt += `\n\nDocker-Container:\n${containers}`;
          }

          if (s.services?.length > 0) {
            const services = s.services.slice(0, 20).map((svc: any) =>
              `  - Port ${svc.port}/${svc.protocol}: ${svc.service || 'unbekannt'}`
            ).join('\n');
            systemPrompt += `\n\nNetzwerk-Services:\n${services}`;
          }

          if (s.systemdUnits?.length > 0) {
            const units = s.systemdUnits.filter((u: any) => u.activeState !== 'active').slice(0, 10).map((u: any) =>
              `  - ${u.unit}: ${u.activeState}/${u.subState}`
            ).join('\n');
            if (units) {
              systemPrompt += `\n\nProblematische Systemd-Units:\n${units}`;
            }
          }

          if (s.sslCertificates?.length > 0) {
            const certs = s.sslCertificates.slice(0, 10).map((c: any) =>
              `  - ${c.subject} (Port ${c.port}): gültig bis ${c.validTo ? new Date(c.validTo).toLocaleDateString('de-DE') : '?'}, Tage übrig: ${c.daysRemaining ?? '?'}`
            ).join('\n');
            systemPrompt += `\n\nSSL-Zertifikate:\n${certs}`;
          }
        } catch {
          // Server-Details konnten nicht geladen werden
        }
      }

      const res = await api.post('/ai/chat', {
        prompt,
        systemPrompt,
        temperature: 0.7,
      });

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: res.data.content,
        timestamp: new Date(),
        model: res.data.model,
        provider: res.data.provider,
        durationMs: res.data.durationMs,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errorContent =
        err.response?.data?.error ||
        err.message ||
        'Unbekannter Fehler bei der Kommunikation mit dem KI-Service.';

      const errorMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: `❌ **Fehler:** ${errorContent}`,
        timestamp: new Date(),
        error: true,
      };

      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, selectedServer]);

  // Enter zum Senden (Shift+Enter für Zeilenumbruch)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Chat leeren
  const clearChat = () => {
    setMessages([]);
    inputRef.current?.focus();
  };

  // ─── Render ───────────────────────────────────────────────────────────

  // NLP deaktiviert
  if (!healthLoading && (!health?.available || !nlpEnabled)) {
    return (
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-white mb-6">💬 KI-Chat</h1>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-6 text-center">
          <span className="text-4xl mb-3 block">🚫</span>
          <h2 className="text-lg font-semibold text-yellow-400 mb-2">
            {!health?.available ? 'KI-Service nicht verfügbar' : 'NLP-Abfragen deaktiviert'}
          </h2>
          <p className="text-gray-400 mb-4">
            {!health?.available
              ? 'Der KI-Provider ist nicht erreichbar. Bitte prüfe die KI-Einstellungen und stelle sicher, dass der Provider läuft.'
              : 'NLP-Abfragen sind in den KI-Einstellungen deaktiviert. Aktiviere die Funktion, um den Chat zu nutzen.'}
          </p>
          <a
            href="/ai-settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors text-sm"
          >
            🤖 KI-Einstellungen öffnen
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            💬 KI-Chat
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Stelle Fragen zu deiner Infrastruktur
            {health && (
              <span className="ml-2 text-xs text-gray-500">
                ({health.provider} · {health.model})
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Server-Kontext Toggle */}
          <button
            onClick={() => setShowServerCtx(!showServerCtx)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
              selectedServer
                ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title="Server-Kontext auswählen"
          >
            🖥️ {selectedServer ? 'Server aktiv' : 'Server-Kontext'}
          </button>

          {/* Chat leeren */}
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
              title="Chat leeren"
            >
              🗑️ Leeren
            </button>
          )}
        </div>
      </div>

      {/* Server-Kontext Auswahl */}
      {showServerCtx && (
        <div className="mb-3 bg-gray-800 border border-gray-700 rounded-lg p-3">
          <label className="block text-xs font-medium text-gray-400 mb-1.5">
            Server-Kontext (optional – liefert Details zum Server im Prompt)
          </label>
          <select
            value={selectedServer}
            onChange={(e) => setSelectedServer(e.target.value)}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
          >
            <option value="">Kein Server (allgemeine Frage)</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.ip} – {s.hostname || 'unbekannt'}
                {s.aiPurpose ? ` (${s.aiPurpose})` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Chat-Bereich */}
      <div className="flex-1 overflow-y-auto bg-gray-800/50 border border-gray-700 rounded-xl p-4 mb-4 space-y-4">
        {healthLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="animate-spin h-8 w-8 border-2 border-blue-400 border-t-transparent rounded-full" />
          </div>
        ) : messages.length === 0 ? (
          /* Willkommen + Vorschläge */
          <div className="flex flex-col items-center justify-center h-full text-center">
            <span className="text-5xl mb-4">🤖</span>
            <h2 className="text-xl font-semibold text-white mb-2">
              Infrastruktur-Assistent
            </h2>
            <p className="text-gray-400 mb-6 max-w-md">
              Stelle Fragen zu deinen Servern, Services, Containern, SSL-Zertifikaten und mehr.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(s.text)}
                  className="flex items-center gap-2 px-3 py-2.5 bg-gray-700/50 hover:bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-300 hover:text-white transition-colors text-left"
                >
                  <span>{s.icon}</span>
                  <span className="line-clamp-2">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Nachrichten */
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.error
                      ? 'bg-red-500/10 border border-red-500/30 text-red-300'
                      : 'bg-gray-700 text-gray-200'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <div
                      className="text-sm prose-invert leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }}
                    />
                  )}

                  {/* Meta-Info */}
                  <div className={`flex items-center gap-2 mt-2 text-xs ${
                    msg.role === 'user' ? 'text-blue-200' : 'text-gray-500'
                  }`}>
                    <span>
                      {msg.timestamp.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {msg.model && (
                      <span className="bg-gray-800/50 px-1.5 py-0.5 rounded text-gray-400">
                        {msg.model}
                      </span>
                    )}
                    {msg.durationMs && (
                      <span className="text-gray-500">
                        ⏱ {formatDuration(msg.durationMs)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Loading-Indikator */}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-700 rounded-2xl px-4 py-3 max-w-[85%]">
                  <div className="flex items-center gap-2 text-gray-400">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span className="text-sm">KI denkt nach...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Eingabe-Bereich */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-3">
        {health?.blocked && (
          <div className="text-xs text-yellow-400 mb-2 flex items-center gap-1.5">
            ⏳ KI-Service ist gerade beschäftigt (Scan/Zusammenfassung läuft). Antworten können länger dauern.
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              selectedServer
                ? `Frage zum Server ${servers.find(s => s.id === selectedServer)?.ip || ''} stellen...`
                : 'Stelle eine Frage zu deiner Infrastruktur...'
            }
            className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-2.5 text-sm text-white resize-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
            rows={1}
            disabled={loading}
            style={{
              minHeight: '42px',
              maxHeight: '120px',
              height: 'auto',
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
              !input.trim() || loading
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {loading ? (
              <>
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              </>
            ) : (
              <>
                Senden ↗
              </>
            )}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-1.5">
          Enter zum Senden · Shift+Enter für Zeilenumbruch
          {selectedServer && (
            <span className="text-emerald-500 ml-2">
              · 🖥️ Server-Kontext aktiv
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
