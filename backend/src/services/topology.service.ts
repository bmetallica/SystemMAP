// ─── Topology Engine v2 (Etappe 2) ───────────────────────────────────────
// Connection Matching Engine – stellt Beziehungen zwischen Servern her
//
// Korrelations-Quellen (in Prioritätsreihenfolge):
//   1. Aktive TCP/UDP-Verbindungen (ss -ntup) → SOCKET
//   2. Webserver-Configs (Nginx proxy_pass, Apache ProxyPass, HAProxy) → CONFIG
//   3. Docker-Env-Variablen (DATABASE_URL, REDIS_URL etc.) → CONFIG
//   4. Docker-Netzwerke & Container-Links → DOCKER
//   5. /etc/hosts Einträge (strukturiert) → ARP
//   6. ARP-Tabelle → ARP

import { PrismaClient, DetectionMethod } from '@prisma/client';
import { logger } from '../logger';

const prisma = new PrismaClient();

// ─── Bekannte Connection-String-Pattern ──────────────────────────────────

const CONNECTION_URL_PATTERNS = [
  // PostgreSQL
  /postgres(?:ql)?:\/\/[^@]*@([^:/\s]+):?(\d+)?/gi,
  // MySQL
  /mysql:\/\/[^@]*@([^:/\s]+):?(\d+)?/gi,
  // Redis
  /redis:\/\/(?:[^@]*@)?([^:/\s]+):?(\d+)?/gi,
  // MongoDB
  /mongodb(?:\+srv)?:\/\/[^@]*@([^:/\s,]+):?(\d+)?/gi,
  // AMQP (RabbitMQ)
  /amqps?:\/\/[^@]*@([^:/\s]+):?(\d+)?/gi,
  // HTTP/HTTPS (API-Endpoints)
  /https?:\/\/([^:/\s]+):(\d{2,5})/gi,
  // Generisch: HOST:PORT Pattern in Env-Vars
  /(?:_HOST|_ADDR|_SERVER)=([^:\s]+)(?::(\d+))?/gi,
];

const DEFAULT_PORTS: Record<string, number> = {
  postgres: 5432,
  postgresql: 5432,
  mysql: 3306,
  redis: 6379,
  mongodb: 27017,
  amqp: 5672,
  amqps: 5671,
  http: 80,
  https: 443,
};

// ─── Hauptfunktion ───────────────────────────────────────────────────────

/**
 * Hauptfunktion: Wird nach jedem erfolgreichen Server-Scan getriggert.
 * Analysiert die Scan-Daten und erstellt ConnectionEdge-Einträge.
 */
export async function correlateConnections(serverId: string): Promise<number> {
  logger.info(`🔗 Topology-Korrelation für Server ${serverId} gestartet...`);

  const server = await prisma.server.findUnique({
    where: { id: serverId },
    select: { id: true, ip: true, rawScanData: true },
  });

  if (!server || !server.rawScanData) {
    logger.warn(`Keine Scan-Daten für Server ${serverId}`);
    return 0;
  }

  const rawData = server.rawScanData as any;

  // Alle bekannten Server-IPs laden (inkl. Docker-Container-IPs)
  const allServers = await prisma.server.findMany({
    select: { id: true, ip: true, hostname: true },
  });
  const ipToServerId = new Map<string, string>();
  const hostnameToServerId = new Map<string, string>();
  for (const s of allServers) {
    ipToServerId.set(s.ip, s.id);
    if (s.hostname) {
      hostnameToServerId.set(s.hostname.toLowerCase(), s.id);
    }
  }

  // Alte Edges dieses Servers löschen (werden neu berechnet)
  await prisma.connectionEdge.deleteMany({ where: { sourceServerId: serverId } });

  let edgeCount = 0;
  const seenEdges = new Set<string>();

  // Edge erstellen mit Deduplizierung
  async function addEdge(params: {
    targetIp: string;
    targetPort: number;
    sourceProcess: string | null;
    method: DetectionMethod;
    details: string;
  }): Promise<void> {
    const { targetIp, targetPort, sourceProcess, method, details } = params;
    if (!targetIp || isLoopback(targetIp)) return;

    const edgeKey = `${targetIp}:${targetPort}:${sourceProcess || ''}`;
    if (seenEdges.has(edgeKey)) return;
    seenEdges.add(edgeKey);

    const targetServerId = resolveServerId(targetIp, ipToServerId, hostnameToServerId);
    const isExternal = !targetServerId;

    try {
      await prisma.connectionEdge.create({
        data: {
          sourceServerId: serverId,
          targetServerId,
          targetIp,
          targetPort,
          sourceProcess,
          detectionMethod: method,
          details: details.substring(0, 500),
          isExternal,
        },
      });
      edgeCount++;
    } catch (err: any) {
      // Unique-Constraint-Verletzung ignorieren
      if (err.code !== 'P2002') {
        logger.warn(`Edge-Fehler: ${err.message}`);
      }
    }
  }

  // ─── 1. Socket-basierte Verbindungen ─────────────────────────────
  const sockets = rawData.sockets || [];
  for (const socket of sockets) {
    const peerAddr = socket.peer || '';
    if (!peerAddr || peerAddr === '*:*' || peerAddr === '0.0.0.0:*') continue;

    const { ip: targetIp, port: targetPort } = parseAddress(peerAddr);
    if (!targetIp || !targetPort) continue;

    await addEdge({
      targetIp,
      targetPort,
      sourceProcess: socket.process || null,
      method: DetectionMethod.SOCKET,
      details: `Aktive ${socket.proto || 'TCP'}-Verbindung: ${socket.local} → ${peerAddr}${socket.pid ? ` (PID ${socket.pid})` : ''}`,
    });
  }

  // ─── 2. Webserver-Config-basierte Verbindungen ──────────────────
  const webConfigs = rawData.webserver_configs || {};

  // Nginx
  if (webConfigs.nginx) {
    // Server-Blocks mit proxy_pass
    const serverBlocks = webConfigs.nginx.server_blocks || [];
    for (const block of serverBlocks) {
      for (const pp of (block.proxy_passes || [])) {
        const matches = extractIpPortFromConfig(pp);
        for (const { ip: targetIp, port: targetPort } of matches) {
          await addEdge({
            targetIp,
            targetPort,
            sourceProcess: 'nginx',
            method: DetectionMethod.CONFIG,
            details: `Nginx proxy_pass: ${pp}${block.server_names?.length ? ` (${block.server_names.join(', ')})` : ''}`,
          });
        }
      }
    }

    // Upstreams (Legacy-Format)
    for (const line of (webConfigs.nginx.upstreams || [])) {
      const matches = extractIpPortFromConfig(line);
      for (const { ip: targetIp, port: targetPort } of matches) {
        await addEdge({
          targetIp,
          targetPort,
          sourceProcess: 'nginx',
          method: DetectionMethod.CONFIG,
          details: `Nginx upstream: ${line}`,
        });
      }
    }
  }

  // Apache
  if (webConfigs.apache) {
    for (const vhost of (webConfigs.apache.vhosts || [])) {
      for (const proxyLine of (vhost.proxy || [])) {
        const matches = extractIpPortFromConfig(proxyLine);
        for (const { ip: targetIp, port: targetPort } of matches) {
          await addEdge({
            targetIp,
            targetPort,
            sourceProcess: 'apache',
            method: DetectionMethod.CONFIG,
            details: `Apache ProxyPass: ${proxyLine}${vhost.server_name ? ` (${vhost.server_name})` : ''}`,
          });
        }
      }
    }
  }

  // HAProxy
  if (webConfigs.haproxy?.backends) {
    for (const backend of webConfigs.haproxy.backends) {
      for (const srv of (backend.servers || [])) {
        const matches = extractIpPortFromConfig(srv.address || '');
        for (const { ip: targetIp, port: targetPort } of matches) {
          await addEdge({
            targetIp,
            targetPort,
            sourceProcess: 'haproxy',
            method: DetectionMethod.CONFIG,
            details: `HAProxy backend "${backend.name}" → ${srv.name} (${srv.address})`,
          });
        }
      }
    }
  }

  // ─── 3. Docker-Env-Variablen (Connection Strings) ───────────────
  const containers = rawData.docker_containers || [];
  for (const container of containers) {
    const envVars = container.env_vars || [];
    for (const env of envVars) {
      if (typeof env !== 'string') continue;
      if (env.includes('***MASKED***')) continue; // Maskierte überspringen

      for (const pattern of CONNECTION_URL_PATTERNS) {
        // Pattern-RegExp klonen (wegen lastIndex bei /g)
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(env)) !== null) {
          const host = match[1];
          const portStr = match[2];

          // IP oder Hostname?
          const targetIp = resolveHost(host, rawData, ipToServerId);
          if (!targetIp || isLoopback(targetIp)) continue;

          // Default-Port ermitteln
          let port = portStr ? parseInt(portStr) : 0;
          if (!port) {
            const proto = env.match(/^(\w+):\/\//)?.[1]?.toLowerCase();
            port = proto ? (DEFAULT_PORTS[proto] || 0) : 0;
          }

          if (port > 0) {
            await addEdge({
              targetIp,
              targetPort: port,
              sourceProcess: `docker:${container.name}`,
              method: DetectionMethod.CONFIG,
              details: `Docker-Env (${container.name}): ${env.split('=')[0]}=...${host}:${port}`,
            });
          }
        }
      }
    }
  }

  // ─── 4. Docker-Netzwerke ────────────────────────────────────────
  for (const container of containers) {
    const networks = container.networks || {};
    for (const [netName, netData] of Object.entries(networks)) {
      const gateway = (netData as any)?.gateway;
      if (gateway && !isLoopback(gateway)) {
        await addEdge({
          targetIp: gateway,
          targetPort: 0,
          sourceProcess: `docker:${container.name}`,
          method: DetectionMethod.DOCKER,
          details: `Docker-Netzwerk "${netName}" (Container: ${container.name}, Gateway: ${gateway})`,
        });
      }

      // Container-IP zu bekannten Servern matchen
      const containerIp = (netData as any)?.ip;
      if (containerIp && !isLoopback(containerIp)) {
        // Andere Container im selben Netzwerk über Docker-Networks-Daten verknüpfen
        const dockerNetworks = rawData.docker_networks || [];
        for (const dnet of dockerNetworks) {
          if (dnet.name === netName && dnet.containers) {
            for (const [cName, cIp] of Object.entries(dnet.containers)) {
              const cleanIp = String(cIp).split('/')[0]; // CIDR entfernen
              if (cleanIp && cleanIp !== containerIp && !isLoopback(cleanIp)) {
                await addEdge({
                  targetIp: cleanIp,
                  targetPort: 0,
                  sourceProcess: `docker:${container.name}`,
                  method: DetectionMethod.DOCKER,
                  details: `Docker-Netzwerk "${netName}": ${container.name} ↔ ${cName}`,
                });
              }
            }
          }
        }
      }
    }

    // Port-Mappings: Exposed Ports deuten auf Verbindungen hin
    const ports = container.ports || {};
    for (const [portKey, mappings] of Object.entries(ports)) {
      if (!mappings || !Array.isArray(mappings)) continue;
      for (const mapping of mappings) {
        const hostIp = (mapping as any).host_ip;
        const hostPort = parseInt((mapping as any).host_port);
        if (hostIp && hostIp !== '0.0.0.0' && hostIp !== '::' && !isLoopback(hostIp) && hostPort) {
          await addEdge({
            targetIp: hostIp,
            targetPort: hostPort,
            sourceProcess: `docker:${container.name}`,
            method: DetectionMethod.DOCKER,
            details: `Docker Port-Mapping: ${container.name} ${portKey} → ${hostIp}:${hostPort}`,
          });
        }
      }
    }
  }

  // ─── 5. /etc/hosts Einträge ─────────────────────────────────────
  const etcHosts = rawData.etc_hosts || [];
  for (const entry of etcHosts) {
    if (!entry.ip || isLoopback(entry.ip)) continue;

    const targetServerId = ipToServerId.get(entry.ip) || null;
    if (!targetServerId) continue; // Nur bekannte Server

    await addEdge({
      targetIp: entry.ip,
      targetPort: 0,
      sourceProcess: null,
      method: DetectionMethod.ARP,
      details: `/etc/hosts: ${entry.ip} → ${(entry.hostnames || []).join(', ')}`,
    });
  }

  // ─── 6. ARP-Tabelle ─────────────────────────────────────────────
  const arpTable = rawData.arp_table || [];
  for (const entry of arpTable) {
    if (!entry.ip || entry.state === 'FAILED') continue;

    const targetServerId = ipToServerId.get(entry.ip) || null;
    if (!targetServerId) continue; // Nur bekannte Server

    await addEdge({
      targetIp: entry.ip,
      targetPort: 0,
      sourceProcess: null,
      method: DetectionMethod.ARP,
      details: `ARP-Tabelle: ${entry.ip} (MAC: ${entry.mac}, Dev: ${entry.device || '?'})`,
    });
  }

  logger.info(`✅ Topology-Korrelation abgeschlossen: ${edgeCount} Verbindungen für Server ${serverId}`);
  return edgeCount;
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper-Funktionen
// ═══════════════════════════════════════════════════════════════════════════

function parseAddress(addr: string): { ip: string; port: number } {
  // IPv6: [::1]:8080
  const ipv6Match = addr.match(/\[(.+)\]:(\d+)/);
  if (ipv6Match) {
    return { ip: ipv6Match[1], port: parseInt(ipv6Match[2]) };
  }
  // IPv4: 192.168.1.1:8080
  const lastColon = addr.lastIndexOf(':');
  if (lastColon > 0) {
    return {
      ip: addr.substring(0, lastColon),
      port: parseInt(addr.substring(lastColon + 1)) || 0,
    };
  }
  return { ip: addr, port: 0 };
}

function isLoopback(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('127.');
}

function extractIpPortFromConfig(line: string): Array<{ ip: string; port: number }> {
  const results: Array<{ ip: string; port: number }> = [];

  // Pattern 1: IP:Port direkt
  const ipPortRegex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d{1,5})/g;
  let match;
  while ((match = ipPortRegex.exec(line)) !== null) {
    const port = parseInt(match[2]);
    if (port > 0 && port <= 65535) {
      results.push({ ip: match[1], port });
    }
  }

  // Pattern 2: http://IP:Port oder https://IP:Port
  const urlRegex = /https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?/g;
  while ((match = urlRegex.exec(line)) !== null) {
    const port = match[2] ? parseInt(match[2]) : (line.includes('https') ? 443 : 80);
    if (port > 0 && port <= 65535 && !results.some(r => r.ip === match![1] && r.port === port)) {
      results.push({ ip: match[1], port });
    }
  }

  return results;
}

/**
 * Versucht einen Hostnamen in eine IP aufzulösen.
 * Schaut zuerst in /etc/hosts, dann in bekannte Server.
 */
function resolveHost(
  host: string,
  rawData: any,
  ipToServerId: Map<string, string>,
): string {
  // Schon eine IP?
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return host;
  }

  // In /etc/hosts nachschauen
  const etcHosts = rawData.etc_hosts || [];
  for (const entry of etcHosts) {
    if (entry.hostnames && entry.hostnames.includes(host)) {
      return entry.ip;
    }
  }

  // In bekannten Servern nachschauen (Hostname-Match)
  // Hostname könnte auch als Docker-Service-Name auftauchen
  for (const [ip, _] of ipToServerId) {
    // Einfacher Vergleich – in Zukunft DNS-Lookup
    if (host === ip) return ip;
  }

  // Nicht auflösbar – gib den Hostnamen zurück (wird als "external" markiert)
  return host;
}

/**
 * Versucht eine IP/Hostname einem bekannten Server zuzuordnen.
 */
function resolveServerId(
  target: string,
  ipToServerId: Map<string, string>,
  hostnameToServerId: Map<string, string>,
): string | null {
  // Direkte IP-Match
  const byIp = ipToServerId.get(target);
  if (byIp) return byIp;

  // Hostname-Match
  const byHostname = hostnameToServerId.get(target.toLowerCase());
  if (byHostname) return byHostname;

  return null;
}
