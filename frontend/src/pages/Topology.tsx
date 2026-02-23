// ─── Topology Page (React Flow) ──────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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
} from 'reactflow';
import 'reactflow/dist/style.css';
import api from '../api/client';

interface TopologyData {
  nodes: Array<{
    id: string;
    label: string;
    ip: string;
    status: string;
    services: Array<{ name: string; port: number }>;
    containerCount: number;
  }>;
  links: Array<{
    id: string;
    source: string;
    target: string | null;
    targetIp: string;
    targetPort: number;
    sourceProcess: string;
    detectionMethod: string;
    details: string;
    isExternal: boolean;
  }>;
}

const statusColors: Record<string, string> = {
  ONLINE: '#22c55e',
  OFFLINE: '#ef4444',
  DISCOVERED: '#eab308',
  CONFIGURED: '#3b82f6',
  SCANNING: '#a855f7',
  ERROR: '#ef4444',
};

const methodColors: Record<string, string> = {
  SOCKET: '#3b82f6',
  CONFIG: '#a855f7',
  ARP: '#eab308',
  DOCKER: '#06b6d4',
  MANUAL: '#6b7280',
};

export default function Topology() {
  const navigate = useNavigate();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedEdge, setSelectedEdge] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTopology();
  }, []);

  const loadTopology = async () => {
    setError(null);
    try {
      const res = await api.get<TopologyData>('/topology');
      const { nodes: rawNodes, links: rawLinks } = res.data;

      // Knoten positionieren (einfacher Grid-Algorithmus)
      const cols = Math.max(3, Math.ceil(Math.sqrt(rawNodes.length)));
      const flowNodes: Node[] = rawNodes.map((n, i) => ({
        id: n.id,
        position: {
          x: (i % cols) * 300 + 50,
          y: Math.floor(i / cols) * 200 + 50,
        },
        data: {
          label: (
            <div className="text-left">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: statusColors[n.status] || '#6b7280' }}
                />
                <strong className="text-sm">{n.label}</strong>
              </div>
              <div className="text-xs text-gray-500 mt-1">{n.ip}</div>
              {n.services.length > 0 && (
                <div className="text-xs text-gray-400 mt-1">
                  {n.services.slice(0, 4).map((s) => `${s.name}:${s.port}`).join(', ')}
                  {n.services.length > 4 && ` +${n.services.length - 4}`}
                </div>
              )}
              {n.containerCount > 0 && (
                <div className="text-xs text-cyan-500 mt-0.5">🐳 {n.containerCount} Container</div>
              )}
            </div>
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: '#1f2937',
          border: `2px solid ${statusColors[n.status] || '#4b5563'}`,
          borderRadius: '12px',
          padding: '12px',
          minWidth: '180px',
          color: 'white',
          cursor: 'pointer',
        },
      }));

      // Kanten (nur interne Verbindungen die ein Ziel haben)
      const flowEdges: Edge[] = rawLinks
        .filter((l) => l.target)
        .map((l) => ({
          id: l.id,
          source: l.source,
          target: l.target!,
          animated: l.detectionMethod === 'SOCKET',
          style: { stroke: methodColors[l.detectionMethod] || '#6b7280', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color: methodColors[l.detectionMethod] || '#6b7280' },
          label: l.sourceProcess ? `${l.sourceProcess} →:${l.targetPort}` : `:${l.targetPort}`,
          labelStyle: { fill: '#9ca3af', fontSize: 10 },
          labelBgStyle: { fill: '#111827', fillOpacity: 0.8 },
          data: l,
        }));

      setNodes(flowNodes);
      setEdges(flowEdges);
    } catch (err) {
      console.error('Topologie laden fehlgeschlagen:', err);
      setError('Topologie konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(edge.data);
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    navigate(`/servers/${node.id}`);
  }, [navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <p className="text-gray-400">⏳ Topologie wird geladen...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-8rem)] gap-4">
        <p className="text-red-400">{error}</p>
        <button
          onClick={loadTopology}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg"
        >
          🔄 Erneut laden
        </button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-white">Netzwerk-Topologie</h1>
        <div className="flex items-center gap-4">
          <button
            onClick={loadTopology}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors"
            title="Topologie neu laden"
          >
            🔄 Aktualisieren
          </button>
          <div className="flex gap-3 text-xs">
          {Object.entries(methodColors).map(([method, color]) => (
            <div key={method} className="flex items-center gap-1">
              <div className="w-3 h-1 rounded" style={{ backgroundColor: color }} />
              <span className="text-gray-400">{method}</span>
            </div>
          ))}
          </div>
        </div>
      </div>

      <div className="h-full bg-gray-900 border border-gray-700 rounded-xl overflow-hidden relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
          fitView
          attributionPosition="bottom-left"
        >
          <Background color="#374151" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const status = node.style?.border?.toString().match(/#[0-9a-f]+/i)?.[0];
              return status || '#4b5563';
            }}
            style={{ background: '#1f2937' }}
          />
        </ReactFlow>

        {/* Edge-Detail Popup */}
        {selectedEdge && (
          <div className="absolute bottom-4 right-4 bg-gray-800 border border-gray-700 rounded-xl p-4 w-80 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-white">Verbindungsdetails</h3>
              <button
                onClick={() => setSelectedEdge(null)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Methode:</span>
                <span className="text-white">{selectedEdge.detectionMethod}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Ziel-IP:</span>
                <span className="text-white font-mono">{selectedEdge.targetIp}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Ziel-Port:</span>
                <span className="text-white">{selectedEdge.targetPort}</span>
              </div>
              {selectedEdge.sourceProcess && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Prozess:</span>
                  <span className="text-white font-mono">{selectedEdge.sourceProcess}</span>
                </div>
              )}
              {selectedEdge.details && (
                <div className="mt-2 p-2 bg-gray-900 rounded text-xs text-gray-300">
                  {selectedEdge.details}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
