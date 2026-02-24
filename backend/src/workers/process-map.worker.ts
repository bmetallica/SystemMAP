// ─── Process-Map Worker ──────────────────────────────────────────────────
// Phase 5.5: KI-Prozessmap (Baumstruktur)
//
// Mehrstufige Pipeline:
//   1. Config-Discovery via SSH (gather-configs.ts)
//   2. Config-Inhalte dekodieren + Markdown aufbereiten
//   3. Discovery-Befehle via SSH ausführen (pro Prozess)
//   4. Config-Auswahl durch LLM (relevante Configs)
//   5. Baumstruktur-Generierung durch LLM (pro Prozess)
//   6. Ergebnis in AiAnalysis speichern
//
// Concurrency: 1 – nur ein Map-Scan gleichzeitig

import { Worker, Job } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { redisConnection } from '../queues';
import { generateConfigGatherScript } from '../services/gather-configs';
import { executeRemoteScript, executeRemoteCommand, SSHCredentials } from '../services/ssh.service';
import { decrypt } from '../services/crypto.service';
import { aiService, ProcessTreeResult, ProcessConfigData, KNOWN_COMMANDS } from '../services/ai';
import { ProcessMapStep } from '../services/ai/types';
import { logger } from '../logger';

const prisma = new PrismaClient();

export interface ProcessMapJobData {
  serverId: string;
  triggeredBy: string;
}

export interface ProcessMapProgress {
  step: ProcessMapStep;
  percent: number;
  message: string;
  processCount?: number;
  currentProcess?: string;
  completedProcesses?: number;
}

export function startProcessMapWorker(): Worker {
  const worker = new Worker<ProcessMapJobData>(
    'process-map',
    async (job: Job<ProcessMapJobData>) => {
      const { serverId, triggeredBy } = job.data;
      logger.info(`🗺️ Process-Map Worker: Starte für Server ${serverId} (von ${triggeredBy})`);

      const server = await prisma.server.findUnique({
        where: { id: serverId },
        include: {
          processes: { orderBy: { cpuPct: 'desc' } },
          services: true,
          dockerContainers: true,
        },
      });
      if (!server) throw new Error(`Server ${serverId} nicht gefunden`);
      if (!server.sshUser || !server.sshPasswordEncrypted) {
        throw new Error(`Server ${serverId}: SSH-Zugangsdaten fehlen`);
      }

      const creds: SSHCredentials = {
        host: server.ip,
        port: server.sshPort,
        username: server.sshUser,
        passwordEncrypted: server.sshPasswordEncrypted,
        keyEncrypted: server.sshKeyEncrypted || undefined,
      };

      const overallStart = Date.now();

      // ── Kernel/System-Prozess-Filter (wird in mehreren Schritten verwendet) ──
      const KERNEL_PREFIXES = /^(kworker|ksoftirqd|migration|rcu_|kthreadd|cpuhp|khugepaged|kswapd|kblockd|kcompactd|kdevtmpfs|ata_sff|edac-|edac_|blkcg|devfreq|jbd2|kauditd|khungtaskd|kintegrityd|ksmd|kstrp|kthrotld|ext4-|cryptd|ipv6_|acpi_|oom_|inet_frag|mm_percpu|netns|mld|psimon|writeback|flush-|scsi_|ttm_swap|zswap|tpm_dev|irq_|card\d|slub_|watchdog|agetty|login|rcu_tasks|charger_manager|hwrng|nfit|dm_bufio|cfg80211|kaluad|bioset|deferwq|raid|md_|loop\d)/;
      const KERNEL_EXACT = new Set([
        'bash', '(sd-pam)', 'sd-pam', 'init', 'sulogin', 'getty',
      ]);
      function isKernelProcess(name: string, rawCommand?: string): boolean {
        if (KERNEL_EXACT.has(name)) return true;
        if (KERNEL_PREFIXES.test(name)) return true;
        if (/^\d+:\d+/.test(name)) return true;
        if (/^u\d+:\d+/.test(name)) return true;
        if (rawCommand && KERNEL_PREFIXES.test(rawCommand)) return true;
        if (/^\[.*\]$/.test(name)) return true;
        if (/^[a-z]{2,3}\d+-\d+$/.test(name)) return true;
        return false;
      }

      // Lock erwerben (innerhalb try, damit finally korrekt aufräumt)
      let lockAcquired = false;
      try {
        lockAcquired = await aiService.acquireLock(serverId);
        if (!lockAcquired) {
          throw new Error('KI-Lock konnte nicht erworben werden – ein anderer Map-Scan läuft bereits.');
        }
        // ═══════════════════════════════════════════════════════════════════
        // Schritt 1: Config-Discovery via SSH (0-20%)
        // ═══════════════════════════════════════════════════════════════════
        await reportProgress(job, ProcessMapStep.GATHERING_CONFIGS, 5, 'Config-Discovery-Skript wird auf dem Server ausgeführt...');

        const configScript = generateConfigGatherScript();
        const configOutput = await executeRemoteScript(creds, configScript, { timeout: 120_000 });

        // JSON parsen
        let configData: { configs: Record<string, ProcessConfigData>; _meta?: any };
        try {
          const jsonStart = configOutput.indexOf('{');
          const jsonEnd = configOutput.lastIndexOf('}');
          configData = JSON.parse(configOutput.substring(jsonStart, jsonEnd + 1));
        } catch (e) {
          throw new Error(`Config-Discovery JSON konnte nicht geparst werden: ${(e as Error).message}`);
        }

        const processNames = Object.keys(configData.configs || {}).filter(
          name => !isKernelProcess(name)
        );
        const totalProcesses = processNames.length;

        await reportProgress(job, ProcessMapStep.GATHERING_CONFIGS, 20,
          `${totalProcesses} Prozesse mit Configs gefunden (${configData._meta?.total_files || '?'} Dateien)`,
          totalProcesses);

        if (totalProcesses === 0) {
          await aiService.releaseLock();
          return {
            serverId,
            processCount: 0,
            trees: [],
            message: 'Keine Prozesse mit Config-Dateien gefunden.',
          };
        }

        // ═══════════════════════════════════════════════════════════════════
        // Schritt 2: Config-Inhalte dekodieren (20-30%)
        // ═══════════════════════════════════════════════════════════════════
        await reportProgress(job, ProcessMapStep.PREPARING_MARKDOWN, 22, 'Config-Dateien werden dekodiert...');

        // Base64-Inhalte dekodieren für jeden Prozess
        const processConfigs: Record<string, Array<{ path: string; content: string }>> = {};
        for (const [procName, procData] of Object.entries(configData.configs)) {
          processConfigs[procName] = [];
          for (const file of (procData.files || [])) {
            try {
              const content = Buffer.from(file.content_b64, 'base64').toString('utf-8');
              if (content.trim().length > 0) {
                processConfigs[procName].push({ path: file.path, content });
              }
            } catch {
              logger.debug(`Base64-Decode fehlgeschlagen für ${file.path}`);
            }
          }
        }

        await reportProgress(job, ProcessMapStep.PREPARING_MARKDOWN, 30, 'Config-Dateien dekodiert.');

        // ═══════════════════════════════════════════════════════════════════
        // Schritt 3: Discovery-Befehle via SSH (30-50%)
        // ═══════════════════════════════════════════════════════════════════
        await reportProgress(job, ProcessMapStep.DISCOVERY_COMMANDS, 32, 'Discovery-Befehle werden generiert und ausgeführt...');

        const discoveryResults: Record<string, string> = {};
        let discIdx = 0;
        for (const procName of processNames) {
          discIdx++;
          const pct = 32 + Math.floor((discIdx / totalProcesses) * 18);
          await reportProgress(job, ProcessMapStep.DISCOVERY_COMMANDS, pct,
            `Discovery: ${procName} (${discIdx}/${totalProcesses})`,
            totalProcesses, procName, discIdx);

          try {
            // Nur bekannte Commands verwenden – KEIN LLM für unbekannte
            let cmd: string | null = null;
            const known = KNOWN_COMMANDS[procName];
            if (known) {
              cmd = known.command;
            }

            if (cmd) {
              const output = await executeRemoteCommand(creds, cmd, { timeout: 15_000 });
              if (output.trim().length > 0) {
                discoveryResults[procName] = output.substring(0, 8000);
              }
            }
          } catch (err: any) {
            logger.debug(`Discovery für ${procName} fehlgeschlagen: ${err.message}`);
          }
        }

        await reportProgress(job, ProcessMapStep.DISCOVERY_COMMANDS, 50,
          `Discovery abgeschlossen: ${Object.keys(discoveryResults).length}/${totalProcesses} erfolgreich`);

        // ═══════════════════════════════════════════════════════════════════
        // Schritt 4: Config-Auswahl durch LLM (50-60%)
        // ═══════════════════════════════════════════════════════════════════
        await reportProgress(job, ProcessMapStep.CONFIG_SELECTION, 52, 'LLM wählt relevante Configs aus...');

        const selectedConfigs: Record<string, Array<{ path: string; content: string }>> = {};
        let selIdx = 0;
        for (const procName of processNames) {
          selIdx++;
          const configs = processConfigs[procName] || [];

          if (configs.length <= 3) {
            selectedConfigs[procName] = configs;
          } else {
            const allPaths = configs.map((c) => c.path);
            const selected = await aiService.selectRelevantConfigs(procName, allPaths);
            selectedConfigs[procName] = configs.filter((c) => selected.includes(c.path));
            // Sicherheitsnetz: mindestens 1
            if (selectedConfigs[procName].length === 0 && configs.length > 0) {
              selectedConfigs[procName] = configs.slice(0, 3);
            }
          }

          const pct = 52 + Math.floor((selIdx / totalProcesses) * 8);
          await reportProgress(job, ProcessMapStep.CONFIG_SELECTION, pct,
            `Config-Auswahl: ${procName} (${selIdx}/${totalProcesses})`,
            totalProcesses, procName, selIdx);
        }

        await reportProgress(job, ProcessMapStep.CONFIG_SELECTION, 60, 'Config-Auswahl abgeschlossen.');

        // ═══════════════════════════════════════════════════════════════════
        // Schritt 5: Baumstruktur-Generierung pro Prozess (60-95%)
        // ═══════════════════════════════════════════════════════════════════
        await reportProgress(job, ProcessMapStep.TREE_GENERATION, 62, 'Baumstrukturen werden generiert...');

        const trees: ProcessTreeResult[] = [];
        let treeIdx = 0;
        for (const procName of processNames) {
          treeIdx++;
          const pct = 62 + Math.floor((treeIdx / totalProcesses) * 33);
          await reportProgress(job, ProcessMapStep.TREE_GENERATION, pct,
            `Baumstruktur: ${procName} (${treeIdx}/${totalProcesses})`,
            totalProcesses, procName, treeIdx);

          const configs = selectedConfigs[procName] || [];
          const executable = configData.configs[procName]?.executable || '';
          const discovery = discoveryResults[procName];

          try {
            const tree = await aiService.generateProcessTree(
              procName,
              executable,
              configs,
              discovery,
            );
            trees.push(tree);
            logger.info(`  ✅ Baumstruktur für ${procName}: ${tree.children?.length || 0} Kategorien`);
          } catch (err: any) {
            logger.warn(`  ⚠️ Baumstruktur für ${procName} fehlgeschlagen: ${err.message}`);
            // Fehler-Eintrag hinzufügen
            trees.push({
              process: procName,
              executable,
              service_type: 'unbekannt',
              description: `Analyse fehlgeschlagen: ${err.message}`,
              children: [],
            });
          }
        }

        // ═══════════════════════════════════════════════════════════════════
        // Schritt 6: Ergebnisse speichern (95-100%)
        // Zusätzlich: Prozess-Metadaten aus DB anreichern (Ports, Services, Docker)
        // ═══════════════════════════════════════════════════════════════════
        await reportProgress(job, ProcessMapStep.SAVING_RESULTS, 96, 'Ergebnisse werden gespeichert...');

        const durationMs = Date.now() - overallStart;

        // Services-Map aufbauen (port → service)
        const serviceMap: Record<string, { port: number; name: string }[]> = {};
        for (const svc of (server.services || [])) {
          const key = (svc.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!serviceMap[key]) serviceMap[key] = [];
          serviceMap[key].push({ port: svc.port, name: svc.name });
        }

        // Prozess-Metadaten aus DB
        const dbProcesses: Record<string, any[]> = {};
        for (const p of (server.processes || [] as any[])) {
          const rawCmd = (p as any).command || '';
          // Schlüssel = vollständiger Prozessname (ohne Pfad), trailing colon entfernen
          let name = rawCmd.split('/').pop()?.split(' ')[0] || rawCmd;
          name = name.replace(/:$/, ''); // "sshd:" → "sshd", "postgres:" → "postgres"
          if (!name || name.length < 2) continue;
          if (!dbProcesses[name]) dbProcesses[name] = [];
          dbProcesses[name].push(p);
        }

        // Kernel/System-Filter für DB-Prozesse (verwendet die oben definierte Funktion)
        
        // Anreicherung: Ports, CPU, RAM, User aus DB an jeden Baum hängen
        for (const tree of trees) {
          const procName = tree.process.toLowerCase().replace(/[^a-z0-9]/g, '');
          const dbProcs = dbProcesses[tree.process] || dbProcesses[procName] || [];
          const svcs = serviceMap[procName] || [];

          // Ports aus Services
          if (svcs.length > 0) {
            tree.ports = svcs.map(s => s.port);
          }

          // CPU/RAM-Durchschnitt aus DB
          if (dbProcs.length > 0) {
            tree.cpu = Math.round(dbProcs.reduce((s: number, p: any) => s + (p.cpuPct || 0), 0) * 10) / 10;
            tree.memory = Math.round(dbProcs.reduce((s: number, p: any) => s + (p.memMb || 0), 0));
            tree.user = dbProcs[0]?.user || undefined;
            tree.pid = dbProcs[0]?.pid || undefined;
          }
        }

        // Auch Prozesse OHNE Config-Dateien als leere Einträge hinzufügen (aus DB)
        const existingNames = new Set(trees.map(t => t.process.toLowerCase()));
        
        for (const [procName, procs] of Object.entries(dbProcesses)) {
          if (existingNames.has(procName.toLowerCase())) continue;
          const rawCmd = (procs[0] as any)?.command || '';
          if (isKernelProcess(procName, rawCmd)) continue;

          const svcs = serviceMap[procName.toLowerCase().replace(/[^a-z0-9]/g, '')] || [];
          const firstProc = (procs as any[])[0];

          trees.push({
            process: procName,
            executable: firstProc?.args?.split(' ')[0] || '',
            service_type: svcs.length > 0 ? 'service' : 'process',
            description: '',
            children: [],
            ports: svcs.length > 0 ? svcs.map((s: any) => s.port) : undefined,
            cpu: Math.round((procs as any[]).reduce((s: number, p: any) => s + (p.cpuPct || 0), 0) * 10) / 10,
            memory: Math.round((procs as any[]).reduce((s: number, p: any) => s + (p.memMb || 0), 0)),
            user: firstProc?.user || undefined,
            pid: firstProc?.pid || undefined,
          } as any);
        }

        // In AiAnalysis speichern (überschreibt vorherige)
        await aiService.saveAnalysis({
          serverId,
          purpose: 'process_map',
          treeJson: trees,
          rawPrompt: `Config-Discovery + ${totalProcesses} Prozesse analysiert`,
          rawResponse: JSON.stringify(trees).substring(0, 50000),
          modelUsed: (await aiService.getSettings()).model,
          durationMs,
        });

        await reportProgress(job, ProcessMapStep.SAVING_RESULTS, 100,
          `✅ Prozessmap fertig: ${trees.length} Prozesse in ${Math.round(durationMs / 1000)}s`);

        logger.info(`✅ Process-Map abgeschlossen für ${server.ip}: ${trees.length} Bäume, ${Math.round(durationMs / 1000)}s`);

        return {
          serverId,
          ip: server.ip,
          processCount: trees.length,
          trees: trees.map((t) => ({ process: t.process, service_type: t.service_type })),
          durationMs,
        };

      } finally {
        // Lock NUR freigeben wenn wir ihn auch erworben haben
        if (lockAcquired) {
          await aiService.releaseLock();
        }
      }
    },
    {
      connection: redisConnection as any,
      concurrency: 1, // NUR ein Map-Scan gleichzeitig
    },
  );

  worker.on('completed', (job) => {
    logger.info(`✅ Process-Map Job ${job.id} abgeschlossen`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`❌ Process-Map Job ${job?.id} fehlgeschlagen: ${err.message}`);
  });

  return worker;
}

// ─── Hilfsfunktion: Fortschritt melden ──────────────────────────────────

async function reportProgress(
  job: Job<ProcessMapJobData>,
  step: ProcessMapStep,
  percent: number,
  message: string,
  processCount?: number,
  currentProcess?: string,
  completedProcesses?: number,
): Promise<void> {
  const progress: ProcessMapProgress = {
    step,
    percent,
    message,
    processCount,
    currentProcess,
    completedProcesses,
  };
  await job.updateProgress(progress as any);
  logger.debug(`🗺️ [${percent}%] ${step}: ${message}`);
}
