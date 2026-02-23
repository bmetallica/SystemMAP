// ─── Änderungsverlauf / Diff-History (Etappe 4) ──────────────────────────
// Globale Ansicht aller erkannten Änderungen über alle Server hinweg
// Phase 5.6: KI-Anomalie-Bewertung inline anzeigen

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

interface DiffEvent {
  id: string;
  serverId: string;
  snapshotId: string;
  category: string;
  changeType: string;
  itemKey: string;
  oldValue: any;
  newValue: any;
  severity: string;
  acknowledged: boolean;
  createdAt: string;
  server?: { ip: string; hostname?: string };
  snapshot?: { scanNumber: number };
}

interface DiffSummary {
  total: number;
  unacknowledged: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  recent: DiffEvent[];
}

// ── Phase 5.6: Anomalie-Typen ────────────────────────────────────────────

interface AnomalyFinding {
  event: string;
  assessment: 'normal' | 'suspicious' | 'critical';
  reason: string;
  recommendation: string;
  category?: string;
  itemKey?: string;
}

interface AnomalyResult {
  overall_risk: 'low' | 'medium' | 'high' | 'critical';
  findings: AnomalyFinding[];
  summary?: string;
}

interface AnomalyAnalysis {
  id: string;
  serverId: string;
  result: AnomalyResult;
  modelUsed: string;
  durationMs: number;
  createdAt: string;
}

export default function DiffHistory() {
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [diffs, setDiffs] = useState<DiffEvent[]>([]);
  const [filterSeverity, setFilterSeverity] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Phase 5.6: Anomalie-State
  const [anomalyByServer, setAnomalyByServer] = useState<Record<string, AnomalyAnalysis>>({});
  const [anomalyLoading, setAnomalyLoading] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    try {
      const params: any = { limit: 100 };
      if (filterSeverity) params.severity = filterSeverity;

      const [summaryRes, diffsRes] = await Promise.all([
        api.get('/diffs/summary'),
        api.get('/diffs/recent', { params }),
      ]);
      setSummary(summaryRes.data);
      setDiffs(diffsRes.data);

      // Phase 5.6: Anomalie-Daten für alle Server laden
      const serverIds = [...new Set(diffsRes.data.map((d: DiffEvent) => d.serverId))];
      const anomalyMap: Record<string, AnomalyAnalysis> = {};
      await Promise.allSettled(
        serverIds.map(async (sid) => {
          try {
            const res = await api.get(`/ai/anomaly/${sid}`);
            anomalyMap[sid as string] = res.data;
          } catch {
            // Keine Anomalie-Daten vorhanden – OK
          }
        })
      );
      setAnomalyByServer(anomalyMap);
    } catch (err) {
      console.error('Diffs laden fehlgeschlagen:', err);
    } finally {
      setLoading(false);
    }
  }, [filterSeverity]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { const i = setInterval(loadData, 20000); return () => clearInterval(i); }, [loadData]);

  const acknowledge = async (id: string) => {
    try {
      await api.put(`/diffs/${id}/acknowledge`);
      loadData();
    } catch (err) { console.error(err); }
  };

  // Phase 5.6: Manuellen Anomalie-Check auslösen
  const triggerAnomalyCheck = async (serverId: string) => {
    setAnomalyLoading(prev => ({ ...prev, [serverId]: true }));
    try {
      const res = await api.post(`/ai/anomaly/${serverId}`);
      setAnomalyByServer(prev => ({
        ...prev,
        [serverId]: {
          id: '',
          serverId,
          result: res.data.result,
          modelUsed: '',
          durationMs: 0,
          createdAt: new Date().toISOString(),
        },
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message;
      alert(`Anomalie-Check fehlgeschlagen: ${msg}`);
    } finally {
      setAnomalyLoading(prev => ({ ...prev, [serverId]: false }));
    }
  };

  // Phase 5.6: Finding für ein Diff-Event finden
  const findAnomalyForDiff = (diff: DiffEvent): AnomalyFinding | undefined => {
    const analysis = anomalyByServer[diff.serverId];
    if (!analysis?.result?.findings) return undefined;
    // Matching: category + itemKey oder event-Text
    return analysis.result.findings.find(f =>
      (f.category === diff.category && f.itemKey === diff.itemKey) ||
      (f.itemKey && diff.itemKey.includes(f.itemKey)) ||
      (f.category === diff.category && f.event?.toLowerCase().includes(diff.itemKey.toLowerCase()))
    );
  };

  // Phase 5.6: Anomalie-Badge Farben
  const assessmentBadge = (assessment: string) => {
    switch (assessment) {
      case 'normal': return { icon: '🟢', label: 'Normal', cls: 'bg-green-900/50 text-green-300 border-green-700' };
      case 'suspicious': return { icon: '🟡', label: 'Auffällig', cls: 'bg-yellow-900/50 text-yellow-300 border-yellow-700' };
      case 'critical': return { icon: '🔴', label: 'Kritisch', cls: 'bg-red-900/50 text-red-300 border-red-700' };
      default: return { icon: '⚪', label: assessment, cls: 'bg-gray-800 text-gray-300 border-gray-600' };
    }
  };

  const riskBadge = (risk: string) => {
    switch (risk) {
      case 'low': return { icon: '🟢', label: 'Niedrig', cls: 'bg-green-900 text-green-300 border-green-700' };
      case 'medium': return { icon: '🟡', label: 'Mittel', cls: 'bg-yellow-900 text-yellow-300 border-yellow-700' };
      case 'high': return { icon: '🟠', label: 'Hoch', cls: 'bg-orange-900 text-orange-300 border-orange-700' };
      case 'critical': return { icon: '🔴', label: 'Kritisch', cls: 'bg-red-900 text-red-300 border-red-700' };
      default: return { icon: '⚪', label: risk, cls: 'bg-gray-800 text-gray-300 border-gray-600' };
    }
  };

  const severityBadge = (s: string) => {
    const colors: Record<string, string> = {
      CRITICAL: 'bg-red-900 text-red-300 border-red-700',
      WARNING: 'bg-yellow-900 text-yellow-300 border-yellow-700',
      INFO: 'bg-blue-900 text-blue-300 border-blue-700',
    };
    return colors[s] || 'bg-gray-800 text-gray-300';
  };

  const changeIcon = (type: string) => {
    switch (type) {
      case 'ADDED': return '➕';
      case 'REMOVED': return '➖';
      case 'MODIFIED': return '✏️';
      default: return '❓';
    }
  };

  const categoryLabel = (c: string) => {
    const labels: Record<string, string> = {
      services: '🔌 Services',
      mounts: '💾 Mounts',
      dockerContainers: '🐳 Docker',
      systemdUnits: '⚙️ Systemd',
      cronJobs: '⏰ Cron',
      sslCertificates: '🔒 SSL',
      userAccounts: '👤 Benutzer',
      networkInterfaces: '🌐 Netzwerk',
      serverMeta: '🖥️ Server-Info',
      processes: '📊 Prozesse',
    };
    return labels[c] || `📋 ${c}`;
  };

  const formatValue = (val: any): string => {
    if (val === null || val === undefined) return '–';
    if (typeof val === 'object') return JSON.stringify(val, null, 2);
    return String(val);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-400 text-lg">Lade Änderungsverlauf...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">📊 Änderungsverlauf</h1>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              try {
                const res = await api.get('/export/diffs/csv', { responseType: 'blob' });
                const url = window.URL.createObjectURL(new Blob([res.data]));
                const a = document.createElement('a');
                a.href = url;
                a.download = `diffs-export-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                window.URL.revokeObjectURL(url);
              } catch (err: any) {
                alert('CSV Export fehlgeschlagen');
              }
            }}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded"
          >
            📥 CSV Export
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-2xl font-bold text-white">{summary.unacknowledged}</div>
            <div className="text-sm text-gray-400">Unbestätigt</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-red-800">
            <div className="text-2xl font-bold text-red-400">{summary.bySeverity.CRITICAL || 0}</div>
            <div className="text-sm text-gray-400">Kritisch</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-yellow-800">
            <div className="text-2xl font-bold text-yellow-400">{summary.bySeverity.WARNING || 0}</div>
            <div className="text-sm text-gray-400">Warnungen</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-blue-800">
            <div className="text-2xl font-bold text-blue-400">{summary.bySeverity.INFO || 0}</div>
            <div className="text-sm text-gray-400">Info</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-2xl font-bold text-gray-300">{summary.total}</div>
            <div className="text-sm text-gray-400">Gesamt</div>
          </div>
        </div>
      )}

      {/* Kategorie-Übersicht */}
      {summary && Object.keys(summary.byCategory).length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
          <h3 className="text-sm font-medium text-gray-400 mb-3">Unbestätigte Änderungen nach Kategorie</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.byCategory).map(([cat, count]) => (
              <span key={cat} className="px-3 py-1 bg-gray-700 rounded-full text-sm text-gray-300">
                {categoryLabel(cat)}: <span className="font-bold text-white">{count as number}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Phase 5.6: KI-Anomalie-Übersicht */}
      {Object.keys(anomalyByServer).length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 border border-purple-800/50">
          <h3 className="text-sm font-medium text-purple-300 mb-3">🤖 KI-Anomalie-Bewertung</h3>
          <div className="space-y-2">
            {Object.entries(anomalyByServer).map(([sid, analysis]) => {
              const risk = riskBadge(analysis.result.overall_risk);
              const suspCount = analysis.result.findings.filter(f => f.assessment === 'suspicious').length;
              const critCount = analysis.result.findings.filter(f => f.assessment === 'critical').length;
              const serverDiffs = diffs.filter(d => d.serverId === sid);
              const serverName = serverDiffs[0]?.server?.hostname || serverDiffs[0]?.server?.ip || sid;
              return (
                <div key={sid} className="flex items-center gap-3 bg-gray-900/50 rounded px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded border ${risk.cls}`}>
                    {risk.icon} {risk.label}
                  </span>
                  <Link to={`/servers/${sid}`} className="text-sm text-blue-400 hover:underline">
                    {serverName}
                  </Link>
                  <span className="text-xs text-gray-500">
                    {analysis.result.findings.length} Findings
                    {critCount > 0 && <span className="text-red-400 ml-1">({critCount} kritisch)</span>}
                    {suspCount > 0 && critCount === 0 && <span className="text-yellow-400 ml-1">({suspCount} auffällig)</span>}
                  </span>
                  {analysis.result.summary && (
                    <span className="text-xs text-gray-400 ml-auto truncate max-w-[40%]">{analysis.result.summary}</span>
                  )}
                  <span className="text-xs text-gray-600 ml-auto">
                    {new Date(analysis.createdAt).toLocaleString('de-DE')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-3 items-center">
        <select
          value={filterSeverity}
          onChange={e => setFilterSeverity(e.target.value)}
          className="bg-gray-800 border border-gray-600 text-white text-sm rounded px-3 py-1.5"
        >
          <option value="">Alle Schweregrade</option>
          <option value="CRITICAL">🔴 Kritisch</option>
          <option value="WARNING">🟡 Warnung</option>
          <option value="INFO">🔵 Info</option>
        </select>
        <span className="text-gray-500 text-sm">{diffs.length} Einträge</span>
      </div>

      {/* Diff Timeline */}
      {diffs.length === 0 ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500">
          Noch keine Änderungen erkannt. Nach dem zweiten Scan eines Servers werden Diffs hier angezeigt.
        </div>
      ) : (
        <div className="space-y-2">
          {diffs.map(diff => {
            const finding = findAnomalyForDiff(diff);
            const badge = finding ? assessmentBadge(finding.assessment) : null;
            return (
            <div
              key={diff.id}
              className={`bg-gray-800 rounded-lg border transition-colors ${
                diff.acknowledged ? 'border-gray-700 opacity-60'
                  : diff.severity === 'CRITICAL' ? 'border-red-700'
                  : diff.severity === 'WARNING' ? 'border-yellow-700'
                  : 'border-blue-700'
              }`}
            >
              <div
                className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-700/30"
                onClick={() => setExpandedId(expandedId === diff.id ? null : diff.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-lg">{changeIcon(diff.changeType)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border ${severityBadge(diff.severity)}`}>
                    {diff.severity}
                  </span>
                  {/* Phase 5.6: KI-Assessment-Badge */}
                  {badge && (
                    <span className={`text-xs px-2 py-0.5 rounded border ${badge.cls}`} title={finding?.reason}>
                      {badge.icon} {badge.label}
                    </span>
                  )}
                  <span className="text-sm text-gray-300">{categoryLabel(diff.category)}</span>
                  <span className="text-sm text-white font-mono truncate">{diff.itemKey}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  {diff.server && (
                    <Link
                      to={`/servers/${diff.serverId}`}
                      className="text-blue-400 hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {diff.server.hostname || diff.server.ip}
                    </Link>
                  )}
                  <span>Scan #{diff.snapshot?.scanNumber}</span>
                  <span>{new Date(diff.createdAt).toLocaleString('de-DE')}</span>
                  {!diff.acknowledged && (
                    <button
                      onClick={(e) => { e.stopPropagation(); acknowledge(diff.id); }}
                      className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs"
                    >
                      ✓
                    </button>
                  )}
                </div>
              </div>

              {/* Detail-Ansicht */}
              {expandedId === diff.id && (
                <div className="px-4 pb-4 border-t border-gray-700">
                  {/* Phase 5.6: KI-Bewertung Detail */}
                  {finding && (
                    <div className="mt-3 mb-3 bg-gray-900/70 rounded-lg p-3 border border-purple-800/30">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-purple-400 text-xs font-medium">🤖 KI-Bewertung</span>
                        <span className={`text-xs px-2 py-0.5 rounded border ${badge!.cls}`}>
                          {badge!.icon} {badge!.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 mb-1">
                        <span className="text-gray-500">Begründung:</span> {finding.reason}
                      </p>
                      {finding.recommendation && (
                        <p className="text-xs text-gray-300">
                          <span className="text-gray-500">Empfehlung:</span> {finding.recommendation}
                        </p>
                      )}
                    </div>
                  )}
                  {/* Trigger-Button wenn keine Anomalie-Daten vorhanden */}
                  {!anomalyByServer[diff.serverId] && (
                    <div className="mt-3 mb-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerAnomalyCheck(diff.serverId); }}
                        disabled={anomalyLoading[diff.serverId]}
                        className="px-3 py-1 bg-purple-900/50 hover:bg-purple-800/50 text-purple-300 text-xs rounded border border-purple-700/50 disabled:opacity-50"
                      >
                        {anomalyLoading[diff.serverId] ? '⏳ Analyse läuft...' : '🤖 KI-Anomalie-Check starten'}
                      </button>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    {diff.oldValue && (
                      <div>
                        <div className="text-xs text-red-400 font-medium mb-1">Vorher</div>
                        <pre className="text-xs text-gray-400 bg-gray-900 rounded p-2 overflow-auto max-h-40">
                          {formatValue(diff.oldValue)}
                        </pre>
                      </div>
                    )}
                    {diff.newValue && (
                      <div>
                        <div className="text-xs text-green-400 font-medium mb-1">Nachher</div>
                        <pre className="text-xs text-gray-400 bg-gray-900 rounded p-2 overflow-auto max-h-40">
                          {formatValue(diff.newValue)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
