// ─── Alerts-Seite (Etappe 4) ─────────────────────────────────────────────
// Alert-Regeln verwalten und ausgelöste Alerts anzeigen / auflösen
// Zeigt sowohl Live-Systemwarnungen als auch Alert-Historie

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';

interface Alert {
  id: string;
  title: string;
  message: string;
  severity: string;
  category: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  metadata?: any;
  createdAt: string;
  server?: { ip: string; hostname?: string };
  rule?: { name: string; category: string };
}

interface AlertRule {
  id: string;
  name: string;
  description?: string;
  category: string;
  condition: any;
  severity: string;
  enabled: boolean;
  serverId?: string;
  cooldownMin: number;
  lastTriggeredAt?: string;
  server?: { ip: string; hostname?: string };
  _count?: { alerts: number };
}

interface AlertSummary {
  total: number;
  open: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  recentCritical: Alert[];
}

interface LiveWarning {
  type: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  message: string;
  target?: string;
  targetId?: string;
  detail?: any;
}

export default function Alerts() {
  const [tab, setTab] = useState<'live' | 'alerts' | 'rules'>('live');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [liveWarnings, setLiveWarnings] = useState<LiveWarning[]>([]);
  const [liveTotal, setLiveTotal] = useState(0);
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterResolved, setFilterResolved] = useState<string>('false');
  const [loading, setLoading] = useState(true);

  // Neue Regel
  const [showNewRule, setShowNewRule] = useState(false);
  const [newRule, setNewRule] = useState({
    name: '', description: '', category: 'diff', severity: 'WARNING',
    conditionType: 'diff_count', threshold: 1, cooldownMin: 60,
  });

  const loadData = useCallback(async () => {
    try {
      const params: any = {};
      if (filterSeverity) params.severity = filterSeverity;
      if (filterResolved !== '') params.resolved = filterResolved;

      const [alertsRes, rulesRes, summaryRes, liveRes] = await Promise.all([
        api.get('/alerts', { params }),
        api.get('/alerts/rules'),
        api.get('/alerts/summary'),
        api.get('/alerts/live'),
      ]);
      setAlerts(alertsRes.data.alerts);
      setAlertsTotal(alertsRes.data.total);
      setRules(rulesRes.data);
      setSummary(summaryRes.data);
      setLiveWarnings(liveRes.data.warnings || []);
      setLiveTotal(liveRes.data.total || 0);
    } catch (err) {
      console.error('Alerts laden fehlgeschlagen:', err);
    } finally {
      setLoading(false);
    }
  }, [filterSeverity, filterResolved]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { const i = setInterval(loadData, 15000); return () => clearInterval(i); }, [loadData]);

  const resolveAlert = async (id: string) => {
    try {
      await api.put(`/alerts/${id}/resolve`);
      loadData();
    } catch (err) { console.error(err); }
  };

  const resolveAll = async () => {
    if (!confirm('Alle offenen Alerts auflösen?')) return;
    try {
      await api.put('/alerts/resolve-all');
      loadData();
    } catch (err) { console.error(err); }
  };

  const toggleRule = async (id: string) => {
    try {
      await api.put(`/alerts/rules/${id}/toggle`);
      loadData();
    } catch (err) { console.error(err); }
  };

  const deleteRule = async (id: string) => {
    if (!confirm('Regel wirklich löschen?')) return;
    try {
      await api.delete(`/alerts/rules/${id}`);
      loadData();
    } catch (err) { console.error(err); }
  };

  const createRule = async () => {
    try {
      const condition: any = { type: newRule.conditionType };
      if (newRule.threshold) condition.threshold = newRule.threshold;
      if (newRule.conditionType === 'ssl_expiry') condition.daysLeft = newRule.threshold;

      await api.post('/alerts/rules', {
        name: newRule.name,
        description: newRule.description || undefined,
        category: newRule.category,
        condition,
        severity: newRule.severity,
        cooldownMin: newRule.cooldownMin,
      });
      setShowNewRule(false);
      setNewRule({ name: '', description: '', category: 'diff', severity: 'WARNING', conditionType: 'diff_count', threshold: 1, cooldownMin: 60 });
      loadData();
    } catch (err) { console.error(err); }
  };

  const severityIcon = (s: string) => {
    switch (s) {
      case 'CRITICAL': return '🔴';
      case 'WARNING': return '🟡';
      case 'INFO': return '🔵';
      default: return '⚪';
    }
  };

  const categoryIcon = (c: string) => {
    switch (c) {
      case 'ssl': return '🔒';
      case 'disk': return '💾';
      case 'systemd': return '⚙️';
      case 'diff': return '📊';
      case 'scan': return '🔍';
      default: return '📋';
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="text-gray-400 text-lg">Lade Alerts...</div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">🔔 Alarme & Regeln</h1>
        <div className="flex gap-2">
          {tab === 'alerts' && summary && summary.open > 0 && (
            <button onClick={resolveAll} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded">
              ✅ Alle auflösen ({summary.open})
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-gray-800 rounded-lg p-4 border border-orange-800">
            <div className="text-2xl font-bold text-orange-400">{liveTotal}</div>
            <div className="text-sm text-gray-400">Aktive Warnungen</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-2xl font-bold text-white">{summary.open}</div>
            <div className="text-sm text-gray-400">Offene Alerts</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-red-800">
            <div className="text-2xl font-bold text-red-400">
              {liveWarnings.filter(w => w.type === 'critical').length + (summary.bySeverity.CRITICAL || 0)}
            </div>
            <div className="text-sm text-gray-400">Kritisch</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-yellow-800">
            <div className="text-2xl font-bold text-yellow-400">
              {liveWarnings.filter(w => w.type === 'warning').length + (summary.bySeverity.WARNING || 0)}
            </div>
            <div className="text-sm text-gray-400">Warnungen</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
            <div className="text-2xl font-bold text-gray-300">{summary.total}</div>
            <div className="text-sm text-gray-400">Alert-Historie</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 w-fit">
        {[
          { key: 'live', label: '⚡ Aktuelle Warnungen', count: liveTotal },
          { key: 'alerts', label: '🔔 Alert-Historie', count: alertsTotal },
          { key: 'rules', label: '📋 Regeln', count: rules.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* LIVE WARNINGS TAB */}
      {tab === 'live' && (
        <div className="space-y-4">
          {liveWarnings.length === 0 ? (
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-12 text-center">
              <span className="text-4xl mb-4 block">✅</span>
              <p className="text-lg font-medium text-white">Keine aktiven Warnungen</p>
              <p className="text-sm text-gray-400 mt-2">Alle Systeme laufen einwandfrei.</p>
            </div>
          ) : (
            <>
              {/* Group by category */}
              {(() => {
                const groups: Record<string, LiveWarning[]> = {};
                for (const w of liveWarnings) {
                  const cat = w.category;
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(w);
                }
                const categoryLabels: Record<string, string> = {
                  ssl: '🔒 SSL-Zertifikate',
                  disk: '💾 Festplatten',
                  systemd: '⚙️ Systemd-Dienste',
                  scan: '🔍 Scan-Fehler',
                };
                return Object.entries(groups).map(([cat, items]) => (
                  <div key={cat} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                    <div className={`px-4 py-3 border-b flex items-center justify-between ${
                      items.some(i => i.type === 'critical')
                        ? 'border-red-800 bg-red-900/20'
                        : 'border-yellow-800 bg-yellow-900/20'
                    }`}>
                      <h3 className="text-sm font-semibold text-white">
                        {categoryLabels[cat] || `📋 ${cat}`}
                      </h3>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        items.some(i => i.type === 'critical')
                          ? 'bg-red-900/50 text-red-400 border border-red-800'
                          : 'bg-yellow-900/50 text-yellow-400 border border-yellow-800'
                      }`}>
                        {items.length} {items.length === 1 ? 'Warnung' : 'Warnungen'}
                      </span>
                    </div>
                    <div className="divide-y divide-gray-700/50">
                      {items.map((w, idx) => (
                        <div key={idx} className="px-4 py-3 hover:bg-gray-750 flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span>{w.type === 'critical' ? '🔴' : w.type === 'warning' ? '🟡' : '🔵'}</span>
                              <span className="font-medium text-white text-sm">{w.title}</span>
                            </div>
                            <p className="text-sm text-gray-400 truncate">{w.message}</p>
                          </div>
                          {w.target && (
                            <Link
                              to={`/servers/${w.targetId}`}
                              className="text-xs text-blue-400 hover:text-blue-300 whitespace-nowrap flex items-center gap-1"
                            >
                              📍 {w.target} →
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </>
          )}
        </div>
      )}

      {/* ALERTS TAB */}
      {tab === 'alerts' && (
        <div className="space-y-4">
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
            <select
              value={filterResolved}
              onChange={e => setFilterResolved(e.target.value)}
              className="bg-gray-800 border border-gray-600 text-white text-sm rounded px-3 py-1.5"
            >
              <option value="false">Offen</option>
              <option value="true">Aufgelöst</option>
              <option value="">Alle</option>
            </select>
          </div>

          {/* Alert List */}
          {alerts.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center text-gray-500">
              Keine Alerts gefunden
            </div>
          ) : (
            <div className="space-y-2">
              {alerts.map(alert => (
                <div
                  key={alert.id}
                  className={`bg-gray-800 rounded-lg p-4 border ${
                    alert.resolved ? 'border-gray-700 opacity-60'
                      : alert.severity === 'CRITICAL' ? 'border-red-700'
                      : alert.severity === 'WARNING' ? 'border-yellow-700'
                      : 'border-blue-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span>{severityIcon(alert.severity)}</span>
                        <span>{categoryIcon(alert.category)}</span>
                        <span className="font-medium text-white text-sm">{alert.title}</span>
                        {alert.resolved && <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">Gelöst</span>}
                      </div>
                      <p className="text-sm text-gray-400">{alert.message}</p>
                      <div className="flex gap-3 mt-2 text-xs text-gray-500">
                        <span>{new Date(alert.createdAt).toLocaleString('de-DE')}</span>
                        {alert.server && <span>📍 {alert.server.hostname || alert.server.ip}</span>}
                        {alert.rule && <span>📋 {alert.rule.name}</span>}
                        {alert.resolvedBy && <span>✅ {alert.resolvedBy} ({new Date(alert.resolvedAt!).toLocaleString('de-DE')})</span>}
                      </div>
                    </div>
                    {!alert.resolved && (
                      <button
                        onClick={() => resolveAlert(alert.id)}
                        className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded whitespace-nowrap"
                      >
                        ✅ Auflösen
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* RULES TAB */}
      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={() => setShowNewRule(!showNewRule)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded"
            >
              + Neue Regel
            </button>
          </div>

          {/* New Rule Form */}
          {showNewRule && (
            <div className="bg-gray-800 rounded-lg p-4 border border-blue-700 space-y-3">
              <h3 className="text-white font-medium">Neue Alert-Regel</h3>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={newRule.name}
                  onChange={e => setNewRule({ ...newRule, name: e.target.value })}
                  placeholder="Name der Regel"
                  className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
                />
                <select
                  value={newRule.category}
                  onChange={e => setNewRule({ ...newRule, category: e.target.value })}
                  className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
                >
                  <option value="diff">Diff-Erkennung</option>
                  <option value="ssl">SSL-Zertifikate</option>
                  <option value="disk">Disk-Auslastung</option>
                  <option value="systemd">Systemd-Units</option>
                </select>
                <select
                  value={newRule.conditionType}
                  onChange={e => setNewRule({ ...newRule, conditionType: e.target.value })}
                  className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
                >
                  <option value="diff_count">Diff: Änderungsanzahl</option>
                  <option value="ssl_expiry">SSL: Ablauf in X Tagen</option>
                  <option value="disk_usage">Disk: Auslastung ≥ X%</option>
                  <option value="systemd_failed">Systemd: Failed Units</option>
                  <option value="service_missing">Service fehlt</option>
                </select>
                <input
                  type="number"
                  value={newRule.threshold}
                  onChange={e => setNewRule({ ...newRule, threshold: parseInt(e.target.value) || 0 })}
                  placeholder="Schwellwert"
                  className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
                />
                <select
                  value={newRule.severity}
                  onChange={e => setNewRule({ ...newRule, severity: e.target.value })}
                  className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
                >
                  <option value="INFO">🔵 Info</option>
                  <option value="WARNING">🟡 Warnung</option>
                  <option value="CRITICAL">🔴 Kritisch</option>
                </select>
                <input
                  type="number"
                  value={newRule.cooldownMin}
                  onChange={e => setNewRule({ ...newRule, cooldownMin: parseInt(e.target.value) || 60 })}
                  placeholder="Cooldown (Min)"
                  className="bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
                />
              </div>
              <input
                value={newRule.description}
                onChange={e => setNewRule({ ...newRule, description: e.target.value })}
                placeholder="Beschreibung (optional)"
                className="w-full bg-gray-900 border border-gray-600 text-white text-sm rounded px-3 py-2"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowNewRule(false)} className="px-3 py-1.5 bg-gray-700 text-gray-300 text-sm rounded">
                  Abbrechen
                </button>
                <button
                  onClick={createRule}
                  disabled={!newRule.name}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded disabled:opacity-50"
                >
                  Erstellen
                </button>
              </div>
            </div>
          )}

          {/* Rules Table */}
          <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-gray-700">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Kategorie</th>
                  <th className="px-4 py-3">Schwere</th>
                  <th className="px-4 py-3">Cooldown</th>
                  <th className="px-4 py-3">Ausgelöst</th>
                  <th className="px-4 py-3">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(rule => (
                  <tr key={rule.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRule(rule.id)}
                        className={`w-10 h-5 rounded-full relative transition-colors ${
                          rule.enabled ? 'bg-green-600' : 'bg-gray-600'
                        }`}
                      >
                        <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                          rule.enabled ? 'left-5' : 'left-0.5'
                        }`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-white font-medium">{rule.name}</div>
                      {rule.description && <div className="text-xs text-gray-500">{rule.description}</div>}
                      {rule.server && <div className="text-xs text-blue-400">📍 {rule.server.hostname || rule.server.ip}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{categoryIcon(rule.category)} {rule.category}</td>
                    <td className="px-4 py-3">{severityIcon(rule.severity)} {rule.severity}</td>
                    <td className="px-4 py-3 text-gray-400">{rule.cooldownMin} Min</td>
                    <td className="px-4 py-3 text-gray-400">
                      <span className="text-gray-300">{rule._count?.alerts || 0}×</span>
                      {rule.lastTriggeredAt && (
                        <div className="text-xs text-gray-500">
                          {new Date(rule.lastTriggeredAt).toLocaleString('de-DE')}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => deleteRule(rule.id)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        🗑️ Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
