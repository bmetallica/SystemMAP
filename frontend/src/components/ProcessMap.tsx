// ─── ProcessMap – Visuelle Prozess-Karte (ReactFlow) ─────────────────────
// Phase 5.5: Zeigt Prozesse als interaktive Karte (wie Topology)
// Zentral der Hostname, drum herum die Prozesse als Knoten mit Ports/Configs

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Position,
  Handle,
} from 'reactflow';
import 'reactflow/dist/style.css';

// ─── Typen ───────────────────────────────────────────────────────────────

export interface TreeNode {
  name: string;
  type?: string;
  value?: string;
  children?: TreeNode[];
}

export interface ProcessTreeData {
  process: string;
  executable?: string;
  service_type?: string;
  description?: string;
  children: TreeNode[];
  ports?: number[];
  cpu?: number;
  memory?: number;
  user?: string;
  pid?: number;
}

// ─── Service-Typ Farben ──────────────────────────────────────────────────

const SERVICE_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'webserver':         { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  'web server':        { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  'proxy':             { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  'reverse proxy':     { bg: '#1e3a5f', border: '#3b82f6', text: '#93c5fd' },
  'database':          { bg: '#3b1f1f', border: '#ef4444', text: '#fca5a5' },
  'datenbank':         { bg: '#3b1f1f', border: '#ef4444', text: '#fca5a5' },
  'container runtime': { bg: '#0e3a3a', border: '#06b6d4', text: '#67e8f9' },
  'container':         { bg: '#0e3a3a', border: '#06b6d4', text: '#67e8f9' },
  'docker daemon':     { bg: '#0e3a3a', border: '#06b6d4', text: '#67e8f9' },
  'monitoring':        { bg: '#2d1f3d', border: '#a855f7', text: '#d8b4fe' },
  'message broker':    { bg: '#3d2f1f', border: '#f59e0b', text: '#fcd34d' },
  'mqtt':              { bg: '#3d2f1f', border: '#f59e0b', text: '#fcd34d' },
  'iot':               { bg: '#3d2f1f', border: '#f59e0b', text: '#fcd34d' },
  'mail':              { bg: '#1f3d2d', border: '#10b981', text: '#6ee7b7' },
  'dns':               { bg: '#1f2d3d', border: '#6366f1', text: '#a5b4fc' },
  'ssh':               { bg: '#2d2d2d', border: '#9ca3af', text: '#d1d5db' },
  'cron':              { bg: '#2d2d2d', border: '#9ca3af', text: '#d1d5db' },
  'logging':           { bg: '#1f3d2d', border: '#10b981', text: '#6ee7b7' },
  'system':            { bg: '#2d2d2d', border: '#6b7280', text: '#d1d5db' },
  'service':           { bg: '#2d2d2d', border: '#6b7280', text: '#d1d5db' },
  'process':           { bg: '#2d2d2d', border: '#4b5563', text: '#9ca3af' },
};

const DEFAULT_SVC_COLOR = { bg: '#1f2937', border: '#4b5563', text: '#d1d5db' };

function getServiceColor(serviceType?: string) {
  if (!serviceType) return DEFAULT_SVC_COLOR;
  const key = serviceType.toLowerCase();
  for (const [k, v] of Object.entries(SERVICE_COLORS)) {
    if (key.includes(k)) return v;
  }
  return DEFAULT_SVC_COLOR;
}

// ─── Service-Typ Icons ──────────────────────────────────────────────────

const SERVICE_ICONS: Record<string, string> = {
  'webserver': '🌐', 'web server': '🌐', 'proxy': '🔀', 'reverse proxy': '🔀',
  'database': '🗄️', 'datenbank': '🗄️', 'container runtime': '🐳', 'container': '🐳',
  'docker daemon': '🐳', 'monitoring': '📊', 'message broker': '📨', 'mqtt': '📡',
  'iot': '📡', 'mail': '✉️', 'dns': '🔍', 'ssh': '🔐', 'cron': '⏰',
  'logging': '📝', 'system': '⚙️', 'service': '🔧', 'process': '⚙️',
};

function getServiceIcon(serviceType?: string) {
  if (!serviceType) return '⚙️';
  const key = serviceType.toLowerCase();
  for (const [k, v] of Object.entries(SERVICE_ICONS)) {
    if (key.includes(k)) return v;
  }
  return '⚙️';
}

// ─── Prozess-Kategorisierung für Filter ──────────────────────────────────

type ProcessCategory = 'application' | 'system' | 'container' | 'database' | 'network';

const SYSTEM_PROCESS_NAMES = new Set([
  'systemd', 'systemd-logind', 'systemd-journald', 'systemd-udevd',
  'systemd-timesyncd', 'systemd-resolved', 'systemd-timedated',
  'systemd-networkd', 'systemd-oomd', 'dbus-daemon', 'cron',
  'rsyslogd', 'syslogd', 'agetty', 'login', 'polkitd',
]);

const SYSTEM_TYPE_KEYWORDS = [
  'systemd', 'system message bus', 'system-message', 'udev', 'login',
  'scheduler', 'log-manager', 'log manager', 'logging',
];

function getProcessCategory(p: ProcessTreeData): ProcessCategory {
  const name = p.process.toLowerCase();
  const stype = (p.service_type || '').toLowerCase();

  // Datenbanken
  if (stype.includes('database') || stype.includes('datenbank') || stype.includes('postgresql') ||
      stype.includes('mysql') || stype.includes('mariadb') || stype.includes('redis') ||
      stype.includes('mongo') || stype.includes('zeitreihen') || stype.includes('influx') ||
      name === 'postgres' || name === 'mysql' || name === 'mysqld' || name === 'redis' ||
      name === 'mongod' || name === 'influxd') {
    return 'database';
  }

  // Container
  if (stype.includes('container') || stype.includes('docker') ||
      name === 'containerd' || name === 'dockerd' || name === 'docker-proxy' ||
      name === 'containerd-shim') {
    return 'container';
  }

  // Netzwerk-Dienste
  if (stype.includes('ssh') || stype.includes('dns') || stype.includes('proxy') ||
      stype.includes('web') || stype.includes('mqtt') || stype.includes('mail') ||
      stype.includes('load-balancer') || stype.includes('mdns') ||
      name === 'sshd' || name === 'nginx' || name === 'apache2' ||
      name === 'haproxy' || name === 'squid' || name === 'avahi-daemon' ||
      name === 'mosquitto' || name === 'pihole-FTL') {
    return 'network';
  }

  // System-Prozesse
  if (SYSTEM_PROCESS_NAMES.has(name) || SYSTEM_TYPE_KEYWORDS.some(k => stype.includes(k))) {
    return 'system';
  }

  return 'application';
}

const CATEGORY_LABELS: Record<ProcessCategory, { label: string; icon: string }> = {
  application: { label: 'Anwendungen', icon: '📦' },
  system:      { label: 'System', icon: '⚙️' },
  container:   { label: 'Container', icon: '🐳' },
  database:    { label: 'Datenbanken', icon: '🗄️' },
  network:     { label: 'Netzwerk', icon: '🌐' },
};

// ─── Custom Node Component ──────────────────────────────────────────────

function ProcessNode({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(false);
  const colors = getServiceColor(data.service_type);
  const icon = getServiceIcon(data.service_type);
  const hasDetail = (data.children?.length > 0) || data.description;

  return (
    <div
      style={{
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: '12px',
        padding: '10px 14px',
        minWidth: '170px',
        maxWidth: '280px',
        color: 'white',
        cursor: hasDetail ? 'pointer' : 'default',
        fontSize: '12px',
        boxShadow: `0 0 12px ${colors.border}33`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (hasDetail) setExpanded(!expanded);
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: colors.border, width: 8, height: 8 }} />

      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <strong className="text-sm truncate" style={{ color: colors.text }}>
          {data.process}
        </strong>
      </div>

      {/* Service-Type Badge */}
      {data.service_type && data.service_type !== 'process' && data.service_type !== 'unbekannt' && (
        <div
          className="text-xs px-1.5 py-0.5 rounded mb-1 inline-block"
          style={{ background: `${colors.border}22`, color: colors.text, border: `1px solid ${colors.border}55` }}
        >
          {data.service_type}
        </div>
      )}

      {/* Ports */}
      {data.ports && data.ports.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {data.ports.map((p: number) => (
            <span
              key={p}
              className="text-xs px-1.5 py-0.5 rounded font-mono"
              style={{ background: '#1e3a5f', color: '#93c5fd', border: '1px solid #3b82f655' }}
            >
              :{p}
            </span>
          ))}
        </div>
      )}

      {/* Resource badges */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
        {data.user && <span>👤 {data.user}</span>}
        {typeof data.cpu === 'number' && data.cpu > 0 && <span>⚡{data.cpu}%</span>}
        {typeof data.memory === 'number' && data.memory > 0 && <span>💾{data.memory}MB</span>}
      </div>

      {/* Expanded: Children/Config details */}
      {expanded && data.children?.length > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: `${colors.border}44` }}>
          {data.children.map((cat: TreeNode, i: number) => (
            <div key={i} className="mb-1.5">
              <div className="text-xs font-semibold" style={{ color: colors.text }}>
                {cat.name}
              </div>
              {cat.children?.slice(0, 5).map((item: TreeNode, j: number) => (
                <div key={j} className="text-xs text-gray-400 pl-2 truncate" title={item.value?.toString() || item.name}>
                  • {item.name}{item.value ? `: ${item.value}` : ''}
                </div>
              ))}
              {(cat.children?.length || 0) > 5 && (
                <div className="text-xs text-gray-500 pl-2">+{(cat.children?.length || 0) - 5} weitere</div>
              )}
            </div>
          ))}
          {data.description && (
            <div className="text-xs text-gray-500 italic mt-1">{data.description}</div>
          )}
        </div>
      )}

      {/* Expand indicator */}
      {hasDetail && !expanded && (
        <div className="text-xs text-gray-500 mt-1 text-center">▾ Details</div>
      )}
    </div>
  );
}

// ─── Center/Host Node ────────────────────────────────────────────────────

function HostNode({ data }: { data: any }) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        border: '3px solid #3b82f6',
        borderRadius: '50%',
        width: '120px',
        height: '120px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        boxShadow: '0 0 30px #3b82f633, 0 0 60px #3b82f611',
      }}
    >
      <Handle type="source" position={Position.Top} style={{ background: '#3b82f6', width: 8, height: 8, top: -4 }} />
      <Handle type="source" position={Position.Right} style={{ background: '#3b82f6', width: 8, height: 8, right: -4 }} id="right" />
      <Handle type="source" position={Position.Bottom} style={{ background: '#3b82f6', width: 8, height: 8, bottom: -4 }} id="bottom" />
      <Handle type="source" position={Position.Left} style={{ background: '#3b82f6', width: 8, height: 8, left: -4 }} id="left" />

      <span className="text-2xl mb-1">🖥️</span>
      <strong className="text-xs text-center leading-tight">{data.hostname}</strong>
      <span className="text-xs text-gray-400 mt-0.5">{data.processCount} Prozesse</span>
    </div>
  );
}

// ─── Node Types ──────────────────────────────────────────────────────────

const nodeTypes = {
  processNode: ProcessNode,
  hostNode: HostNode,
};

// ─── Layout-Berechnung: Kreis um Host ────────────────────────────────────

function calculateLayout(processes: ProcessTreeData[], hostname: string) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const centerX = 600;
  const centerY = 500;

  // Host-Knoten in der Mitte
  nodes.push({
    id: 'host',
    type: 'hostNode',
    position: { x: centerX - 60, y: centerY - 60 },
    data: { hostname, processCount: processes.length },
    draggable: true,
  });

  // Prozesse sortieren: mit Ports zuerst, dann nach Typ
  const sorted = [...processes].sort((a, b) => {
    const aScore = (a.ports?.length || 0) * 10 + (a.children?.length || 0);
    const bScore = (b.ports?.length || 0) * 10 + (b.children?.length || 0);
    return bScore - aScore;
  });

  const count = sorted.length;
  // Radius abhängig von Anzahl der Prozesse
  const radius = Math.max(280, count * 30);

  sorted.forEach((proc, i) => {
    // Position im Kreis berechnen
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    const x = centerX + Math.cos(angle) * radius - 90;
    const y = centerY + Math.sin(angle) * radius - 40;

    const nodeId = `proc-${i}`;
    const colors = getServiceColor(proc.service_type);

    nodes.push({
      id: nodeId,
      type: 'processNode',
      position: { x, y },
      data: {
        ...proc,
      },
      draggable: true,
    });

    // Edge vom Host zum Prozess
    // Handle-Position basierend auf Winkel wählen
    let sourceHandle: string | undefined;
    const angleDeg = ((angle * 180) / Math.PI + 360) % 360;
    if (angleDeg >= 315 || angleDeg < 45) sourceHandle = 'right';
    else if (angleDeg >= 45 && angleDeg < 135) sourceHandle = 'bottom';
    else if (angleDeg >= 135 && angleDeg < 225) sourceHandle = 'left';
    else sourceHandle = undefined; // top (default)

    edges.push({
      id: `edge-host-${nodeId}`,
      source: 'host',
      target: nodeId,
      sourceHandle,
      animated: (proc.ports?.length || 0) > 0,
      style: {
        stroke: colors.border,
        strokeWidth: proc.children?.length > 0 ? 2 : 1,
        opacity: proc.children?.length > 0 ? 0.8 : 0.4,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: colors.border,
        width: 12,
        height: 12,
      },
    });
  });

  return { nodes, edges };
}

// ─── Hauptkomponente ─────────────────────────────────────────────────────

interface ProcessMapProps {
  data: ProcessTreeData[];
  hostname: string;
}

export default function ProcessMap({ data, hostname }: ProcessMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState('');
  const [selectedNode, setSelectedNode] = useState<ProcessTreeData | null>(null);

  // Kategorie-Filter (alle standardmäßig an)
  const [categoryFilters, setCategoryFilters] = useState<Record<ProcessCategory, boolean>>({
    application: true,
    system: true,
    container: true,
    database: true,
    network: true,
  });

  // Zusätzliche Toggle-Filter
  const [showOnlyWithConfigs, setShowOnlyWithConfigs] = useState(false);
  const [showOnlyWithPorts, setShowOnlyWithPorts] = useState(false);

  const toggleCategory = (cat: ProcessCategory) => {
    setCategoryFilters(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const filtered = useMemo(() =>
    data.filter(p => {
      // Textsuche
      if (filter) {
        const q = filter.toLowerCase();
        const matchesText = p.process.toLowerCase().includes(q) ||
          p.service_type?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.executable?.toLowerCase().includes(q) ||
          p.ports?.some(port => String(port).includes(q));
        if (!matchesText) return false;
      }
      // Kategorie-Filter
      const cat = getProcessCategory(p);
      if (!categoryFilters[cat]) return false;
      // Nur mit Configs
      if (showOnlyWithConfigs && (!p.children || p.children.length === 0)) return false;
      // Nur mit Ports
      if (showOnlyWithPorts && (!p.ports || p.ports.length === 0)) return false;
      return true;
    }),
    [data, filter, categoryFilters, showOnlyWithConfigs, showOnlyWithPorts]
  );

  // Kategorie-Zähler berechnen
  const categoryCounts = useMemo(() => {
    const counts: Record<ProcessCategory, number> = { application: 0, system: 0, container: 0, database: 0, network: 0 };
    data.forEach(p => { counts[getProcessCategory(p)]++; });
    return counts;
  }, [data]);

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => calculateLayout(filtered, hostname),
    [filtered, hostname]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update nodes/edges when filter changes
  useEffect(() => {
    const layout = calculateLayout(filtered, hostname);
    setNodes(layout.nodes);
    setEdges(layout.edges);
  }, [filtered, hostname]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === 'host') {
      setSelectedNode(null);
      return;
    }
    setSelectedNode(node.data as ProcessTreeData);
  }, []);

  // Stats
  const totalPorts = data.reduce((s, p) => s + (p.ports?.length || 0), 0);
  const withConfigs = data.filter(p => p.children?.length > 0).length;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col gap-2 mb-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Prozesse filtern..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 max-w-xs bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>📦 {filtered.length}/{data.length} Prozesse</span>
            <span>🔌 {totalPorts} Ports</span>
            <span>⚙️ {withConfigs} mit Configs</span>
          </div>
        </div>

        {/* Kategorie-Filter-Chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Filter:</span>
          {(Object.entries(CATEGORY_LABELS) as [ProcessCategory, { label: string; icon: string }][]).map(([cat, info]) => (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
                categoryFilters[cat]
                  ? 'bg-gray-700 border-gray-500 text-white hover:bg-gray-600'
                  : 'bg-gray-900 border-gray-800 text-gray-600 hover:bg-gray-800 hover:text-gray-400'
              }`}
            >
              <span>{info.icon}</span>
              <span>{info.label}</span>
              <span className={`ml-0.5 px-1.5 py-0 rounded-full text-xs ${
                categoryFilters[cat] ? 'bg-gray-600 text-gray-300' : 'bg-gray-800 text-gray-600'
              }`}>{categoryCounts[cat]}</span>
            </button>
          ))}

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {/* Toggle: Nur mit Configs */}
          <button
            onClick={() => setShowOnlyWithConfigs(!showOnlyWithConfigs)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
              showOnlyWithConfigs
                ? 'bg-blue-900/50 border-blue-600 text-blue-300 hover:bg-blue-900/70'
                : 'bg-gray-900 border-gray-800 text-gray-600 hover:bg-gray-800 hover:text-gray-400'
            }`}
          >
            <span>📄</span>
            <span>Nur mit Configs</span>
          </button>

          {/* Toggle: Nur mit Ports */}
          <button
            onClick={() => setShowOnlyWithPorts(!showOnlyWithPorts)}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
              showOnlyWithPorts
                ? 'bg-blue-900/50 border-blue-600 text-blue-300 hover:bg-blue-900/70'
                : 'bg-gray-900 border-gray-800 text-gray-600 hover:bg-gray-800 hover:text-gray-400'
            }`}
          >
            <span>🔌</span>
            <span>Nur mit Ports</span>
          </button>
        </div>
      </div>

      {/* Map Container */}
      <div
        ref={containerRef}
        className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden relative"
        style={{ height: 'calc(100vh - 22rem)' }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.2}
          maxZoom={2}
          attributionPosition="bottom-left"
        >
          <Background color="#374151" gap={24} size={1} />
          <Controls
            showZoom={true}
            showFitView={true}
            showInteractive={false}
          />
          <MiniMap
            nodeColor={(node) => {
              if (node.type === 'hostNode') return '#3b82f6';
              const colors = getServiceColor(node.data?.service_type);
              return colors.border;
            }}
            style={{ background: '#1f2937' }}
            maskColor="#11182766"
          />
        </ReactFlow>

        {/* Detail-Panel (rechts) */}
        {selectedNode && (
          <div className="absolute top-4 right-4 bg-gray-800/95 backdrop-blur border border-gray-700 rounded-xl p-4 w-80 max-h-[80%] overflow-y-auto shadow-2xl z-10">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{getServiceIcon(selectedNode.service_type)}</span>
                <h3 className="text-sm font-bold text-white">{selectedNode.process}</h3>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-gray-400 hover:text-white text-sm px-1"
              >✕</button>
            </div>

            {/* Meta */}
            <div className="space-y-1.5 mb-3 text-xs">
              {selectedNode.service_type && selectedNode.service_type !== 'process' && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Typ:</span>
                  <span className="text-white">{selectedNode.service_type}</span>
                </div>
              )}
              {selectedNode.executable && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Binary:</span>
                  <span className="text-white font-mono text-xs truncate ml-2">{selectedNode.executable}</span>
                </div>
              )}
              {selectedNode.user && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Benutzer:</span>
                  <span className="text-white">{selectedNode.user}</span>
                </div>
              )}
              {selectedNode.pid && (
                <div className="flex justify-between">
                  <span className="text-gray-400">PID:</span>
                  <span className="text-white font-mono">{selectedNode.pid}</span>
                </div>
              )}
              {typeof selectedNode.cpu === 'number' && (
                <div className="flex justify-between">
                  <span className="text-gray-400">CPU:</span>
                  <span className="text-white">{selectedNode.cpu}%</span>
                </div>
              )}
              {typeof selectedNode.memory === 'number' && selectedNode.memory > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">RAM:</span>
                  <span className="text-white">{selectedNode.memory} MB</span>
                </div>
              )}
              {selectedNode.ports && selectedNode.ports.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Ports:</span>
                  <span className="text-white font-mono">{selectedNode.ports.join(', ')}</span>
                </div>
              )}
            </div>

            {/* Description */}
            {selectedNode.description && (
              <p className="text-xs text-gray-400 italic mb-3 border-t border-gray-700 pt-2">
                {selectedNode.description}
              </p>
            )}

            {/* Tree Categories */}
            {selectedNode.children?.length > 0 && (
              <div className="border-t border-gray-700 pt-2">
                <div className="text-xs font-semibold text-gray-300 mb-2">Konfiguration</div>
                {selectedNode.children.map((cat, i) => (
                  <div key={i} className="mb-2">
                    <div className="text-xs font-medium text-blue-400">{cat.name}</div>
                    {cat.children?.map((item, j) => (
                      <div key={j} className="text-xs text-gray-400 pl-3 py-0.5 truncate" title={String(item.value || item.name)}>
                        <span className="text-gray-500 mr-1">
                          {item.type === 'port' ? '🔌' : item.type === 'path' ? '📁' : item.type === 'module' ? '📦' : item.type === 'connection' ? '🔗' : '•'}
                        </span>
                        {item.name}
                        {item.value && (
                          <span className="text-gray-500 ml-1">
                            = {typeof item.value === 'object' ? JSON.stringify(item.value) : item.value}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Legend (bottom-left above controls) */}
        <div className="absolute bottom-14 left-3 flex flex-col gap-1 bg-gray-800/90 backdrop-blur rounded-lg p-2 border border-gray-700 z-10">
          {[
            ['🌐', 'Webserver/Proxy', '#3b82f6'],
            ['🗄️', 'Datenbank', '#ef4444'],
            ['🐳', 'Container', '#06b6d4'],
            ['📊', 'Monitoring', '#a855f7'],
            ['📡', 'IoT/MQTT', '#f59e0b'],
            ['⚙️', 'System/Service', '#6b7280'],
          ].map(([icon, label, color]) => (
            <div key={label} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color as string }} />
              <span className="text-gray-400">{icon} {label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
