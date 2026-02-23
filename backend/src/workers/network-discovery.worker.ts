// ─── Network-Discovery Worker ────────────────────────────────────────────
// Führt Nmap-Scans durch und legt gefundene Server automatisch an

import { Worker, Job } from 'bullmq';
import { PrismaClient, NetworkScanStatus, ServerStatus } from '@prisma/client';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { redisConnection } from '../queues';
import { config } from '../config';
import { logger } from '../logger';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Prüfe ob nmap verfügbar ist
function checkNmapAvailable(): boolean {
  try {
    return existsSync(config.nmapPath);
  } catch {
    return false;
  }
}

interface NetworkScanJobData {
  scanId: string;
  subnet: string;
  triggeredBy: string;
}

interface NmapHost {
  ip: string;
  hostname?: string;
  ports: Array<{ port: number; state: string; service: string }>;
  osGuess?: string;
}

export function startNetworkScanWorker(): Worker {
  const worker = new Worker<NetworkScanJobData>(
    'network-scan',
    async (job: Job<NetworkScanJobData>) => {
      const { scanId, subnet, triggeredBy } = job.data;
      logger.info(`🌐 Netzwerkscan gestartet: ${subnet}`);

      try {
        // Prüfe ob nmap installiert ist
        if (!checkNmapAvailable()) {
          throw new Error(`nmap nicht gefunden unter ${config.nmapPath}. Bitte installieren: apt-get install -y nmap`);
        }

        // Status aktualisieren
        await prisma.networkScan.update({
          where: { id: scanId },
          data: { status: NetworkScanStatus.RUNNING, startedAt: new Date() },
        });

        await job.updateProgress(10);

        // Zwei-Phasen-Scan:
        // Phase 1: Schneller Host-Discovery mit SYN-Ping (-sS ohne -sV/-O)
        // Phase 2: Detail-Scan nur auf gefundene Hosts (mit -sV und -O)
        const execOpts = { timeout: 600000, maxBuffer: 10 * 1024 * 1024 }; // 10 Min, 10 MB

        // Phase 1: Host-Discovery + Top-Ports
        const discoveryCmd = `${config.nmapPath} -sS -T4 --top-ports 100 -oX - ${subnet}`;
        logger.info(`Phase 1 – Host-Discovery: ${discoveryCmd}`);

        let nmapOutput: string;
        try {
          const { stdout, stderr } = await execAsync(discoveryCmd, execOpts);
          if (stderr) logger.debug(`nmap stderr: ${stderr.substring(0, 500)}`);
          nmapOutput = stdout;
          logger.info(`Phase 1 abgeschlossen, XML-Größe: ${stdout.length} Bytes`);
        } catch (nmapErr: any) {
          // Fallback auf einfachen Ping-Scan
          logger.warn(`Host-Discovery fehlgeschlagen: ${nmapErr.message}`);
          logger.warn('Fallback auf Ping-Scan (-sn)...');
          const fallbackCmd = `${config.nmapPath} -sn ${subnet} -oX -`;
          try {
            const { stdout: fallbackOutput } = await execAsync(fallbackCmd, { timeout: 120000, maxBuffer: 5 * 1024 * 1024 });
            nmapOutput = fallbackOutput;
            logger.info(`Ping-Scan abgeschlossen, XML-Größe: ${fallbackOutput.length} Bytes`);
          } catch (fallbackErr: any) {
            throw new Error(`Beide Scan-Methoden fehlgeschlagen. Discovery: ${nmapErr.message}; Ping: ${fallbackErr.message}`);
          }
        }

        await job.updateProgress(40);

        // Nmap-XML parsen
        const hosts = parseNmapXml(nmapOutput);
        logger.info(`Phase 1 geparst: ${hosts.length} Hosts gefunden`);

        await job.updateProgress(50);

        // Phase 2: Detail-Scan (Service-Detection + OS) nur auf gefundene IPs
        if (hosts.length > 0 && hosts.length <= 50) {
          const ipList = hosts.map(h => h.ip).join(' ');
          const detailCmd = `${config.nmapPath} -sV -O --osscan-guess -T4 -oX - ${ipList}`;
          logger.info(`Phase 2 – Detail-Scan für ${hosts.length} Hosts...`);

          try {
            const { stdout: detailOutput } = await execAsync(detailCmd, execOpts);
            const detailHosts = parseNmapXml(detailOutput);

            // Merge Detail-Infos in Phase-1-Ergebnisse
            for (const detail of detailHosts) {
              const existing = hosts.find(h => h.ip === detail.ip);
              if (existing) {
                if (detail.ports.length > 0) existing.ports = detail.ports;
                if (detail.osGuess) existing.osGuess = detail.osGuess;
                if (detail.hostname && !existing.hostname) existing.hostname = detail.hostname;
              }
            }
            logger.info(`Phase 2 abgeschlossen: Detail-Infos für ${detailHosts.length} Hosts`);
          } catch (detailErr: any) {
            logger.warn(`Phase 2 fehlgeschlagen (Ergebnisse aus Phase 1 werden verwendet): ${detailErr.message}`);
          }
        }

        await job.updateProgress(80);

        // Gefundene Hosts in die Server-Tabelle aufnehmen
        let newServers = 0;
        let updatedServers = 0;

        for (const host of hosts) {
          const existing = await prisma.server.findUnique({ where: { ip: host.ip } });

          if (!existing) {
            await prisma.server.create({
              data: {
                ip: host.ip,
                hostname: host.hostname || null,
                osInfo: host.osGuess || null,
                status: ServerStatus.DISCOVERED,
              },
            });
            newServers++;
            logger.info(`🆕 Neuer Server entdeckt: ${host.ip} (${host.hostname || 'kein Hostname'})`);
          } else {
            // Hostname/OS aktualisieren wenn wir neue Infos haben
            const updates: any = {};
            if (host.hostname && !existing.hostname) updates.hostname = host.hostname;
            if (host.osGuess && !existing.osInfo) updates.osInfo = host.osGuess;
            if (Object.keys(updates).length > 0) {
              await prisma.server.update({ where: { id: existing.id }, data: updates });
              updatedServers++;
            }
          }

          // Services aus Nmap-Ports anlegen
          for (const port of host.ports) {
            const targetServer = await prisma.server.findUnique({ where: { ip: host.ip } });
            if (!targetServer) continue;
            await prisma.service.upsert({
              where: {
                serverId_name_port_protocol: {
                  serverId: targetServer.id,
                  name: port.service || 'unknown',
                  port: port.port,
                  protocol: 'tcp',
                },
              },
              update: { state: port.state === 'open' ? 'ACTIVE' : 'INACTIVE' },
              create: {
                serverId: targetServer.id,
                name: port.service || 'unknown',
                port: port.port,
                protocol: 'tcp',
                state: port.state === 'open' ? 'ACTIVE' : 'INACTIVE',
              },
            });
          }
        }

        // Scan abschließen
        await prisma.networkScan.update({
          where: { id: scanId },
          data: {
            status: NetworkScanStatus.COMPLETED,
            finishedAt: new Date(),
            results: { hosts: hosts.length, newServers, updatedServers, details: hosts } as any,
          },
        });

        await job.updateProgress(100);

        logger.info(`✅ Netzwerkscan ${subnet} abgeschlossen: ${hosts.length} Hosts, ${newServers} neu, ${updatedServers} aktualisiert`);

        return { hosts: hosts.length, newServers, updatedServers };
      } catch (err: any) {
        logger.error(`❌ Netzwerkscan fehlgeschlagen: ${err.message}`);

        await prisma.networkScan.update({
          where: { id: scanId },
          data: {
            status: NetworkScanStatus.FAILED,
            finishedAt: new Date(),
            error: err.message,
          },
        });

        throw err;
      }
    },
    {
      connection: redisConnection as any,
      concurrency: 1, // Nur ein Nmap-Scan gleichzeitig
    }
  );

  worker.on('completed', (job) => {
    logger.info(`✅ Netzwerkscan-Job ${job.id} abgeschlossen`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`❌ Netzwerkscan-Job ${job?.id} fehlgeschlagen: ${err.message}`);
  });

  return worker;
}

/**
 * Robuster Nmap-XML Parser.
 * Unterstützt sowohl <host starttime="..."> (Detail-Scans) als auch
 * <host> (Ping-Scans), filtert <hosthint>-Blöcke heraus.
 */
function parseNmapXml(xml: string): NmapHost[] {
  const hosts: NmapHost[] = [];

  if (!xml || xml.length === 0) {
    logger.warn('parseNmapXml: Leere XML-Eingabe');
    return hosts;
  }

  // Alle <host ...>...</host> Blöcke per Regex finden (nicht <hosthint>)
  const hostRegex = /<host[\s>](?:(?!<\/host>).)*<\/host>/gs;
  const matches = xml.match(hostRegex) || [];

  logger.debug(`parseNmapXml: ${matches.length} <host>-Blöcke gefunden (XML: ${xml.length} Bytes)`);

  for (const block of matches) {
    // <hosthint>-Blöcke überspringen
    if (block.startsWith('<hosthint')) continue;

    // Nur Hosts mit state="up" berücksichtigen
    if (!block.includes('state="up"')) continue;

    const ipMatch = block.match(/<address\s+addr="(\d+\.\d+\.\d+\.\d+)"\s+addrtype="ipv4"/);
    if (!ipMatch) continue;

    const host: NmapHost = {
      ip: ipMatch[1],
      ports: [],
    };

    // Hostname
    const hostnameMatch = block.match(/<hostname\s+name="([^"]+)"/);
    if (hostnameMatch) {
      host.hostname = hostnameMatch[1];
    }

    // Ports – jedes <port>-Element einzeln parsen
    const portBlockRegex = /<port\s+protocol="tcp"\s+portid="(\d+)">.*?<state\s+state="(\w+)".*?(?:<service\s+[^>]*name="([^"]*)")?.*?<\/port>/gs;
    let portMatch;
    while ((portMatch = portBlockRegex.exec(block)) !== null) {
      host.ports.push({
        port: parseInt(portMatch[1]),
        state: portMatch[2],
        service: portMatch[3] || 'unknown',
      });
    }

    // OS-Erkennung
    const osMatch = block.match(/<osmatch\s+name="([^"]+)"/);
    if (osMatch) {
      host.osGuess = osMatch[1];
    }

    hosts.push(host);
  }

  return hosts;
}
