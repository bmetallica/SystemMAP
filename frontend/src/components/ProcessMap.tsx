// ─── ProcessMap – Visuelle Prozess-Karte (ReactFlow, Radial-Layout) ──────
// Phase 6: Kreisförmige Anordnung: Host → Prozesse → Config-Dateien → Details
// Jeder Konfig-Eintrag ist ein eigener visueller Knoten im Graph
// Kinder werden kreisförmig um den übergeordneten Knoten angeordnet

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

// ─── Detail-Knoten Farben nach Typ ───────────────────────────────────────

const DETAIL_TYPE_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  'config_file': { bg: '#1a2332', border: '#6366f1', text: '#a5b4fc', icon: '📄' },
  'port':        { bg: '#1a2332', border: '#3b82f6', text: '#93c5fd', icon: '🔌' },
  'path':        { bg: '#1a2d1a', border: '#22c55e', text: '#86efac', icon: '📂' },
  'directory':   { bg: '#1a2d1a', border: '#22c55e', text: '#86efac', icon: '📁' },
  'vhost':       { bg: '#2d1a2d', border: '#a855f7', text: '#d8b4fe', icon: '🌐' },
  'upstream':    { bg: '#2d2d1a', border: '#eab308', text: '#fde047', icon: '🔗' },
  'connection':  { bg: '#2d2d1a', border: '#eab308', text: '#fde047', icon: '🔗' },
  'volume':      { bg: '#1a2d1a', border: '#22c55e', text: '#86efac', icon: '💾' },
  'parameter':   { bg: '#1f2937', border: '#6b7280', text: '#d1d5db', icon: '⚙️' },
  'user':        { bg: '#2d1a1a', border: '#ef4444', text: '#fca5a5', icon: '👤' },
  'module':      { bg: '#1a2332', border: '#06b6d4', text: '#67e8f9', icon: '📦' },
  'database':    { bg: '#3b1f1f', border: '#ef4444', text: '#fca5a5', icon: '🗄️' },
  'log':         { bg: '#1f3d2d', border: '#10b981', text: '#6ee7b7', icon: '📝' },
};

const DEFAULT_DETAIL_STYLE = { bg: '#1f2937', border: '#4b5563', text: '#d1d5db', icon: '•' };

function getDetailStyle(type?: string) {
  if (!type) return DEFAULT_DETAIL_STYLE;
  return DETAIL_TYPE_STYLES[type] || DEFAULT_DETAIL_STYLE;
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

  if (stype.includes('database') || stype.includes('datenbank') || stype.includes('postgresql') ||
      stype.includes('mysql') || stype.includes('mariadb') || stype.includes('redis') ||
      stype.includes('mongo') || stype.includes('zeitreihen') || stype.includes('influx') ||
      name === 'postgres' || name === 'mysql' || name === 'mysqld' || name === 'redis' ||
      name === 'mongod' || name === 'influxd') {
    return 'database';
  }

  if (stype.includes('container') || stype.includes('docker') ||
      name === 'containerd' || name === 'dockerd' || name === 'docker-proxy' ||
      name === 'containerd-shim') {
    return 'container';
  }

  if (stype.includes('ssh') || stype.includes('dns') || stype.includes('proxy') ||
      stype.includes('web') || stype.includes('mqtt') || stype.includes('mail') ||
      stype.includes('load-balancer') || stype.includes('mdns') ||
      name === 'sshd' || name === 'nginx' || name === 'apache2' ||
      name === 'haproxy' || name === 'squid' || name === 'avahi-daemon' ||
      name === 'mosquitto' || name === 'pihole-FTL') {
    return 'network';
  }

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

// ─── Custom Node: Prozess (kompakt) ──────────────────────────────────────

function ProcessNode({ data }: { data: any }) {
  const colors = getServiceColor(data.service_type);
  const icon = getServiceIcon(data.service_type);

  return (
    <div
      style={{
        background: colors.bg,
        border: `2px solid ${colors.border}`,
        borderRadius: '12px',
        padding: '10px 14px',
        minWidth: '160px',
        maxWidth: '240px',
        color: 'white',
        cursor: 'pointer',
        fontSize: '12px',
        boxShadow: `0 0 16px ${colors.border}44`,
      }}
    >
      <Handle type="target" position={Position.Top} id="t-top" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Top} id="s-top" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ background: colors.border, width: 5, height: 5, opacity: 0.5 }} />

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

      {/* Ports inline */}
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

      {/* Expand/Collapse Hinweis */}
      {data.hasChildren && (
        <div className="text-xs text-gray-500 mt-1 text-center">
          {data.expanded ? '▴ Zuklappen' : `▾ ${data.childCount} Details`}
        </div>
      )}
    </div>
  );
}

// ─── Custom Node: Detail-Knoten (Config, Port, Pfad, etc.) ──────────────

function DetailNode({ data }: { data: any }) {
  const style = getDetailStyle(data.nodeType);
  const hasChildren = data.hasChildren;

  return (
    <div
      style={{
        background: style.bg,
        border: `1.5px solid ${style.border}`,
        borderRadius: '8px',
        padding: '6px 10px',
        minWidth: '120px',
        maxWidth: '260px',
        color: 'white',
        cursor: hasChildren ? 'pointer' : 'default',
        fontSize: '11px',
        boxShadow: `0 0 8px ${style.border}22`,
      }}
    >
      <Handle type="target" position={Position.Top} id="t-top" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="target" position={Position.Right} id="t-right" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="target" position={Position.Bottom} id="t-bottom" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="target" position={Position.Left} id="t-left" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="source" position={Position.Top} id="s-top" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ background: style.border, width: 4, height: 4, opacity: 0.4 }} />

      <div className="flex items-center gap-1.5">
        <span className="text-sm flex-shrink-0">{style.icon}</span>
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: style.text }}>
            {data.label}
          </div>
          {data.value && (
            <div className="text-xs text-gray-400 truncate font-mono" title={data.value}>
              {data.value}
            </div>
          )}
        </div>
      </div>

      {/* Expand indicator für Knoten mit Kindern */}
      {hasChildren && (
        <div className="text-xs text-gray-500 mt-0.5 text-center">
          {data.expanded ? '▴' : `▾ ${data.childCount}`}
        </div>
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
      <Handle type="source" position={Position.Top} id="s-top" style={{ background: '#3b82f6', width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Right} id="s-right" style={{ background: '#3b82f6', width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Bottom} id="s-bottom" style={{ background: '#3b82f6', width: 5, height: 5, opacity: 0.5 }} />
      <Handle type="source" position={Position.Left} id="s-left" style={{ background: '#3b82f6', width: 5, height: 5, opacity: 0.5 }} />

      <span className="text-2xl mb-1">🖥️</span>
      <strong className="text-xs text-center leading-tight">{data.hostname}</strong>
      <span className="text-xs text-gray-400 mt-0.5">{data.processCount} Prozesse</span>
    </div>
  );
}

// ─── Node Types ──────────────────────────────────────────────────────────

const nodeTypes = {
  processNode: ProcessNode,
  detailNode: DetailNode,
  hostNode: HostNode,
};

// ─── Zähle Kinder rekursiv ──────────────────────────────────────────────

function countChildren(node: TreeNode): number {
  let count = 0;
  if (node.children) {
    count += node.children.length;
    for (const child of node.children) {
      count += countChildren(child);
    }
  }
  return count;
}

// ─── Handle-Richtung berechnen (für Radial-Edges) ───────────────────────

function getBestHandles(
  parentCenter: { x: number; y: number },
  childCenter: { x: number; y: number },
): { sourceHandle: string; targetHandle: string } {
  const dx = childCenter.x - parentCenter.x;
  const dy = childCenter.y - parentCenter.y;
  const angle = Math.atan2(dy, dx);

  let sourceHandle: string;
  let targetHandle: string;

  if (angle >= -Math.PI / 4 && angle < Math.PI / 4) {
    sourceHandle = 's-right';
    targetHandle = 't-left';
  } else if (angle >= Math.PI / 4 && angle < (3 * Math.PI) / 4) {
    sourceHandle = 's-bottom';
    targetHandle = 't-top';
  } else if (angle >= (-3 * Math.PI) / 4 && angle < -Math.PI / 4) {
    sourceHandle = 's-top';
    targetHandle = 't-bottom';
  } else {
    sourceHandle = 's-left';
    targetHandle = 't-right';
  }

  return { sourceHandle, targetHandle };
}

// ─── Radius für kreisförmige Anordnung berechnen ─────────────────────────

function calcRadius(count: number, nodeSize: number, minRadius: number): number {
  if (count <= 1) return minRadius;
  // Genug Platz lassen, damit sich Knoten nicht überlappen
  return Math.max(minRadius, (nodeSize + 20) / (2 * Math.sin(Math.PI / count)) + 30);
}

// ─── Layout-Berechnung: Kreisförmig / Radial ─────────────────────────────

function calculateRadialLayout(
  processes: ProcessTreeData[],
  hostname: string,
  expandedProcs: Set<string>,
  expandedDetails: Set<string>,
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const centers = new Map<string, { x: number; y: number }>();

  // Host-Knoten in der Mitte
  const hostId = 'host';
  const hostW = 120, hostH = 120;
  const hostCx = 0, hostCy = 0;
  centers.set(hostId, { x: hostCx, y: hostCy });

  nodes.push({
    id: hostId,
    type: 'hostNode',
    position: { x: hostCx - hostW / 2, y: hostCy - hostH / 2 },
    data: { hostname, processCount: processes.length },
    draggable: true,
  });

  // Prozesse sortieren (wichtige zuerst)
  const sorted = [...processes].sort((a, b) => {
    const aScore = (a.ports?.length || 0) * 10 + (a.children?.length || 0);
    const bScore = (b.ports?.length || 0) * 10 + (b.children?.length || 0);
    return bScore - aScore;
  });

  const procCount = sorted.length;
  const procNodeW = 200, procNodeH = 80;
  const procRadius = calcRadius(procCount, Math.max(procNodeW, procNodeH), 280);

  sorted.forEach((proc, i) => {
    const procId = `proc-${i}`;
    const colors = getServiceColor(proc.service_type);
    const isExpanded = expandedProcs.has(procId);
    const totalChildren = proc.children?.reduce((s, c) => s + 1 + countChildren(c), 0) || 0;

    // Kreisförmig um den Host anordnen (Start oben, im Uhrzeigersinn)
    const angle = procCount === 1
      ? -Math.PI / 2
      : (2 * Math.PI * i) / procCount - Math.PI / 2;
    const cx = hostCx + procRadius * Math.cos(angle);
    const cy = hostCy + procRadius * Math.sin(angle);
    centers.set(procId, { x: cx, y: cy });

    nodes.push({
      id: procId,
      type: 'processNode',
      position: { x: cx - procNodeW / 2, y: cy - procNodeH / 2 },
      data: {
        ...proc,
        hasChildren: totalChildren > 0,
        childCount: totalChildren,
        expanded: isExpanded,
      },
      draggable: true,
    });

    // Edge: Host → Prozess
    const handles = getBestHandles({ x: hostCx, y: hostCy }, { x: cx, y: cy });
    edges.push({
      id: `e-host-${procId}`,
      source: hostId,
      target: procId,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: 'straight',
      animated: (proc.ports?.length || 0) > 0,
      style: {
        stroke: colors.border,
        strokeWidth: 2,
        opacity: 0.7,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: colors.border,
        width: 12,
        height: 12,
      },
    });

    // Wenn expanded: Kinder kreisförmig um den Prozess
    if (isExpanded && proc.children?.length > 0) {
      addRadialChildren(proc.children, procId, { x: cx, y: cy }, colors.border, nodes, edges, centers, expandedDetails);
    }
  });

  return { nodes, edges };
}

// ─── Rekursiv Kinder-Knoten kreisförmig anordnen ─────────────────────────

function addRadialChildren(
  children: TreeNode[],
  parentId: string,
  parentCenter: { x: number; y: number },
  parentColor: string,
  nodes: Node[],
  edges: Edge[],
  centers: Map<string, { x: number; y: number }>,
  expandedDetails: Set<string>,
) {
  const count = children.length;
  const detailNodeW = 170, detailNodeH = 45;
  const radius = calcRadius(count, Math.max(detailNodeW, detailNodeH), 170);

  children.forEach((child, j) => {
    const childId = `${parentId}-c${j}`;
    const style = getDetailStyle(child.type);
    const hasChildren = (child.children?.length || 0) > 0;
    const isExpanded = expandedDetails.has(childId);
    const childCount = child.children?.reduce((s, c) => s + 1 + countChildren(c), 0) || 0;

    // Node-Breite basierend auf Text
    const labelLen = Math.max(child.name.length, (child.value || '').length);
    const nodeWidth = Math.min(240, Math.max(130, labelLen * 7 + 40));

    // Kreisförmig um den Parent anordnen
    const angle = count === 1
      ? -Math.PI / 2
      : (2 * Math.PI * j) / count - Math.PI / 2;
    const cx = parentCenter.x + radius * Math.cos(angle);
    const cy = parentCenter.y + radius * Math.sin(angle);
    centers.set(childId, { x: cx, y: cy });

    nodes.push({
      id: childId,
      type: 'detailNode',
      position: { x: cx - nodeWidth / 2, y: cy - detailNodeH / 2 },
      data: {
        label: child.name,
        value: child.value || '',
        nodeType: child.type || 'parameter',
        hasChildren,
        childCount,
        expanded: isExpanded,
      },
      draggable: true,
    });

    // Edge: Parent → Kind
    const handles = getBestHandles(parentCenter, { x: cx, y: cy });
    edges.push({
      id: `e-${parentId}-${childId}`,
      source: parentId,
      target: childId,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: 'straight',
      style: {
        stroke: style.border,
        strokeWidth: 1.5,
        opacity: 0.6,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: style.border,
        width: 10,
        height: 10,
      },
    });

    // Rekursiv Kinder, wenn expanded
    if (isExpanded && child.children?.length) {
      addRadialChildren(child.children, childId, { x: cx, y: cy }, style.border, nodes, edges, centers, expandedDetails);
    }
  });
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

  // Expand-State: Welche Prozesse & Detail-Knoten sind aufgeklappt
  const [expandedProcs, setExpandedProcs] = useState<Set<string>>(new Set());
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(new Set());

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
      if (filter) {
        const q = filter.toLowerCase();
        const matchesText = p.process.toLowerCase().includes(q) ||
          p.service_type?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q) ||
          p.executable?.toLowerCase().includes(q) ||
          p.ports?.some(port => String(port).includes(q));
        if (!matchesText) return false;
      }
      const cat = getProcessCategory(p);
      if (!categoryFilters[cat]) return false;
      if (showOnlyWithConfigs && (!p.children || p.children.length === 0)) return false;
      if (showOnlyWithPorts && (!p.ports || p.ports.length === 0)) return false;
      return true;
    }),
    [data, filter, categoryFilters, showOnlyWithConfigs, showOnlyWithPorts]
  );

  // Kategorie-Zähler
  const categoryCounts = useMemo(() => {
    const counts: Record<ProcessCategory, number> = { application: 0, system: 0, container: 0, database: 0, network: 0 };
    data.forEach(p => { counts[getProcessCategory(p)]++; });
    return counts;
  }, [data]);

  // Layout berechnen (re-calculated wenn expand-state oder filter sich ändert)
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(
    () => calculateRadialLayout(filtered, hostname, expandedProcs, expandedDetails),
    [filtered, hostname, expandedProcs, expandedDetails]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);

  // Update nodes/edges wenn sich Layout ändert
  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [layoutNodes, layoutEdges]);

  // Klick auf Knoten: Toggle expand/collapse
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.id === 'host') {
      setSelectedNode(null);
      return;
    }

    // Prozess-Knoten: Details anzeigen + expand toggle
    if (node.id.startsWith('proc-')) {
      // Prozess-Daten für Detail-Panel
      const procData = node.data as ProcessTreeData & { hasChildren: boolean };
      setSelectedNode(procData);

      // Expand/Collapse
      if (procData.hasChildren) {
        setExpandedProcs(prev => {
          const next = new Set(prev);
          if (next.has(node.id)) {
            next.delete(node.id);
            // Auch alle Kinder-Detail-Knoten zuklappen
            setExpandedDetails(prevD => {
              const nextD = new Set(prevD);
              for (const key of nextD) {
                if (key.startsWith(node.id + '-')) nextD.delete(key);
              }
              return nextD;
            });
          } else {
            next.add(node.id);
          }
          return next;
        });
      }
      return;
    }

    // Detail-Knoten: expand/collapse Kinder
    if (node.data.hasChildren) {
      setExpandedDetails(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
          // Auch alle tiefer verschachtelten zuklappen
          for (const key of next) {
            if (key.startsWith(node.id + '-')) next.delete(key);
          }
        } else {
          next.add(node.id);
        }
        return next;
      });
    }
  }, []);

  // Alle Prozesse auf-/zuklappen
  const toggleExpandAll = useCallback(() => {
    if (expandedProcs.size > 0) {
      setExpandedProcs(new Set());
      setExpandedDetails(new Set());
    } else {
      const allProcs = new Set<string>();
      filtered.forEach((_, i) => allProcs.add(`proc-${i}`));
      setExpandedProcs(allProcs);
    }
  }, [expandedProcs, filtered]);

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
          <button
            onClick={toggleExpandAll}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white transition-all"
          >
            {expandedProcs.size > 0 ? '🔽 Alle zuklappen' : '🔼 Alle aufklappen'}
          </button>
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
          minZoom={0.1}
          maxZoom={2.5}
          attributionPosition="bottom-left"
        >
          <Background color="#374151" gap={24} size={1} />
          <Controls showZoom={true} showFitView={true} showInteractive={false} />
          <MiniMap
            nodeColor={(node) => {
              if (node.type === 'hostNode') return '#3b82f6';
              if (node.type === 'detailNode') {
                const style = getDetailStyle(node.data?.nodeType);
                return style.border;
              }
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

            {selectedNode.description && (
              <p className="text-xs text-gray-400 italic mb-3 border-t border-gray-700 pt-2">
                {selectedNode.description}
              </p>
            )}

            {/* Hinweis: Klicken zum Aufklappen */}
            {selectedNode.children?.length > 0 && (
              <div className="border-t border-gray-700 pt-2">
                <div className="text-xs text-gray-500 italic">
                  💡 Klicke auf den Prozess-Knoten im Graph, um die Konfiguration als Baum aufzuklappen
                </div>
              </div>
            )}
          </div>
        )}

        {/* Legende */}
        <div className="absolute bottom-14 left-3 flex flex-col gap-1 bg-gray-800/90 backdrop-blur rounded-lg p-2 border border-gray-700 z-10">
          <div className="text-xs text-gray-500 font-semibold mb-0.5">Prozesse</div>
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
          <div className="text-xs text-gray-500 font-semibold mt-1 mb-0.5">Details</div>
          {[
            ['📄', 'Config-Datei', '#6366f1'],
            ['🔌', 'Port', '#3b82f6'],
            ['📁', 'Verzeichnis', '#22c55e'],
            ['🌐', 'VHost', '#a855f7'],
            ['📦', 'Modul', '#06b6d4'],
            ['📝', 'Log', '#10b981'],
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
