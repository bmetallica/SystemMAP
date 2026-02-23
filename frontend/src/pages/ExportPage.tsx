// ─── Export-Seite (Etappe 4) ─────────────────────────────────────────────
// Übersicht aller Export-Möglichkeiten: Server, Inventar, Diffs, Alerts

import { useState, useEffect } from 'react';
import api from '../api/client';

interface ServerItem {
  id: string;
  ip: string;
  hostname?: string;
  status: string;
}

export default function ExportPage() {
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/servers').then(res => {
      setServers(res.data.filter((s: any) => s.status !== 'DISCOVERED'));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const getToken = () => {
    const state = JSON.parse(localStorage.getItem('auth-storage') || '{}');
    return state?.state?.token || '';
  };

  const downloadFile = async (url: string, filename: string) => {
    try {
      const response = await api.get(url, { responseType: 'blob' });
      const blob = new Blob([response.data]);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Download fehlgeschlagen:', err);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-400 text-lg">Lade...</div></div>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">📥 Daten-Export</h1>

      {/* Inventar-Export */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-3">📋 Gesamtinventar</h2>
        <p className="text-sm text-gray-400 mb-4">
          Exportiere eine Übersicht aller konfigurierten Server mit Ressourcen-Zählungen.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => downloadFile('/export/all/json', `systemmap-inventory-${new Date().toISOString().slice(0, 10)}.json`)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded flex items-center gap-2"
          >
            📄 JSON
          </button>
          <button
            onClick={() => downloadFile('/export/all/csv', `systemmap-inventory-${new Date().toISOString().slice(0, 10)}.csv`)}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded flex items-center gap-2"
          >
            📊 CSV
          </button>
        </div>
      </div>

      {/* Server-Export */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-3">🖥️ Einzelne Server exportieren</h2>
        <p className="text-sm text-gray-400 mb-4">
          Vollständige Dokumentation eines einzelnen Servers inkl. Services, Mounts, Docker, SSL, Benutzer und Verbindungen.
        </p>

        {servers.length === 0 ? (
          <p className="text-gray-500 text-sm">Keine konfigurierten Server vorhanden.</p>
        ) : (
          <div className="space-y-2">
            {servers.map(server => (
              <div key={server.id} className="flex items-center justify-between bg-gray-900 rounded-lg p-3 border border-gray-700">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${
                    server.status === 'ONLINE' ? 'bg-green-400' : server.status === 'ERROR' ? 'bg-red-400' : 'bg-gray-400'
                  }`} />
                  <span className="text-white font-mono text-sm">{server.ip}</span>
                  {server.hostname && <span className="text-gray-400 text-sm">({server.hostname})</span>}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => downloadFile(`/export/server/${server.id}/json`, `systemmap-${server.hostname || server.ip}.json`)}
                    className="px-3 py-1 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded"
                  >
                    JSON
                  </button>
                  <button
                    onClick={() => downloadFile(`/export/server/${server.id}/csv`, `systemmap-${server.hostname || server.ip}.csv`)}
                    className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded"
                  >
                    CSV
                  </button>
                  <button
                    onClick={() => downloadFile(`/export/server/${server.id}/markdown`, `systemmap-${server.hostname || server.ip}.md`)}
                    className="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded"
                  >
                    Markdown
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Diff & Alert Export */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">📊 Änderungen exportieren</h2>
          <p className="text-sm text-gray-400 mb-4">
            Alle unbestätigten Diff-Events als CSV-Datei.
          </p>
          <button
            onClick={() => downloadFile('/export/diffs/csv', `systemmap-diffs-${new Date().toISOString().slice(0, 10)}.csv`)}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded"
          >
            📥 Diffs als CSV
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg border border-gray-700 p-5">
          <h2 className="text-lg font-semibold text-white mb-3">🔔 Alerts exportieren</h2>
          <p className="text-sm text-gray-400 mb-4">
            Alle Alerts (offen und gelöst) als CSV-Datei.
          </p>
          <button
            onClick={() => downloadFile('/export/alerts/csv', `systemmap-alerts-${new Date().toISOString().slice(0, 10)}.csv`)}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded"
          >
            📥 Alerts als CSV
          </button>
        </div>
      </div>

      {/* API Hinweis */}
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h3 className="text-sm font-medium text-gray-300 mb-2">💡 API-Export</h3>
        <p className="text-xs text-gray-500">
          Alle Exporte sind auch direkt über die API verfügbar. Beispiel:
        </p>
        <code className="text-xs text-gray-400 block mt-2 bg-gray-900 p-2 rounded">
          curl -H "Authorization: Bearer TOKEN" http://localhost:3001/api/export/all/json
        </code>
      </div>
    </div>
  );
}
