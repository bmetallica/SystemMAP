// ─── Diff-Service (Etappe 4) ─────────────────────────────────────────────
// Erkennt Änderungen zwischen aufeinanderfolgenden Scans eines Servers.
// Erstellt Snapshots und DiffEvents nach jedem erfolgreichen Scan.

import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { logger } from '../logger';

const prisma = new PrismaClient();

// ─── Typen ───────────────────────────────────────────────────────────────

interface DiffItem {
  category: string;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
  itemKey: string;
  oldValue: any;
  newValue: any;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

interface SnapshotData {
  services: any[];
  mounts: any[];
  dockerContainers: any[];
  systemdUnits: any[];
  cronJobs: any[];
  sslCertificates: any[];
  userAccounts: any[];
  networkInterfaces: any[];
  processes: { count: number; topCpu: any[] };
  serverMeta: {
    hostname: string | null;
    osInfo: string | null;
    kernelInfo: string | null;
    cpuInfo: string | null;
    memoryMb: number | null;
  };
}

// ─── Severity-Ermittlung ─────────────────────────────────────────────────

function determineSeverity(category: string, changeType: string, item?: any): 'INFO' | 'WARNING' | 'CRITICAL' {
  // Kritisch: Sicherheitsrelevante Änderungen
  if (category === 'userAccounts' && changeType === 'ADDED') return 'WARNING';
  if (category === 'userAccounts' && changeType === 'REMOVED') return 'WARNING';
  if (category === 'sslCertificates' && changeType === 'REMOVED') return 'CRITICAL';
  if (category === 'sslCertificates' && changeType === 'MODIFIED') {
    if (item?.isExpired) return 'CRITICAL';
    return 'WARNING';
  }

  // Warnung: Service-/Infrastruktur-Änderungen
  if (category === 'services' && changeType !== 'MODIFIED') return 'WARNING';
  if (category === 'systemdUnits') {
    if (item?.activeState === 'failed') return 'CRITICAL';
    return 'WARNING';
  }
  if (category === 'dockerContainers') return 'WARNING';
  if (category === 'mounts' && changeType !== 'MODIFIED') return 'WARNING';

  // Mount-Nutzung kritisch
  if (category === 'mounts' && changeType === 'MODIFIED') {
    if (item?.usePct && item.usePct >= 90) return 'CRITICAL';
    if (item?.usePct && item.usePct >= 80) return 'WARNING';
  }

  return 'INFO';
}

// ─── Snapshot erstellen ──────────────────────────────────────────────────

async function buildSnapshotData(serverId: string): Promise<SnapshotData> {
  const [
    services, mounts, dockerContainers, systemdUnits,
    cronJobs, sslCertificates, userAccounts, networkInterfaces,
    processes, server,
  ] = await Promise.all([
    prisma.service.findMany({ where: { serverId }, orderBy: { name: 'asc' } }),
    prisma.mount.findMany({ where: { serverId }, orderBy: { mountPoint: 'asc' } }),
    prisma.dockerContainer.findMany({ where: { serverId }, orderBy: { name: 'asc' } }),
    prisma.systemdUnit.findMany({ where: { serverId }, orderBy: { name: 'asc' } }),
    prisma.cronJob.findMany({ where: { serverId }, orderBy: { command: 'asc' } }),
    prisma.sslCertificate.findMany({ where: { serverId }, orderBy: { path: 'asc' } }),
    prisma.userAccount.findMany({ where: { serverId }, orderBy: { uid: 'asc' } }),
    prisma.networkInterface.findMany({ where: { serverId }, orderBy: { name: 'asc' } }),
    prisma.process.findMany({
      where: { serverId },
      orderBy: { cpuPct: 'desc' },
      take: 50,
      select: { pid: true, command: true, user: true, cpuPct: true, memPct: true },
    }),
    prisma.server.findUnique({
      where: { id: serverId },
      select: { hostname: true, osInfo: true, kernelInfo: true, cpuInfo: true, memoryMb: true },
    }),
  ]);

  return {
    services: services.map(s => ({
      name: s.name, port: s.port, protocol: s.protocol,
      state: s.state, version: s.version, bindAddress: s.bindAddress,
    })),
    mounts: mounts.map(m => ({
      device: m.device, mountPoint: m.mountPoint, fsType: m.fsType,
      sizeMb: m.sizeMb, usedMb: m.usedMb, usePct: m.usePct,
    })),
    dockerContainers: dockerContainers.map(c => ({
      name: c.name, image: c.image, state: c.state, containerId: c.containerId,
    })),
    systemdUnits: systemdUnits.map(u => ({
      name: u.name, unitType: u.unitType, activeState: u.activeState,
      subState: u.subState, enabled: u.enabled,
    })),
    cronJobs: cronJobs.map(j => ({
      user: j.user, schedule: j.schedule, command: j.command, source: j.source,
    })),
    sslCertificates: sslCertificates.map(c => ({
      path: c.path, subject: c.subject, issuer: c.issuer,
      validTo: c.validTo?.toISOString(), isExpired: c.isExpired, daysLeft: c.daysLeft,
    })),
    userAccounts: userAccounts.map(u => ({
      username: u.username, uid: u.uid, shell: u.shell,
      hasLogin: u.hasLogin, groups: u.groups,
    })),
    networkInterfaces: networkInterfaces.map(n => ({
      name: n.name, ipAddr: n.ipAddr, macAddr: n.macAddr,
      state: n.state, mtu: n.mtu,
    })),
    processes: {
      count: await prisma.process.count({ where: { serverId } }),
      topCpu: processes,
    },
    serverMeta: server || {
      hostname: null, osInfo: null, kernelInfo: null, cpuInfo: null, memoryMb: null,
    },
  };
}

function computeChecksum(data: SnapshotData): string {
  // Prozesse sind zu volatil – wir hashen ohne sie
  const { processes, ...stableData } = data;
  const json = JSON.stringify(stableData, Object.keys(stableData).sort());
  return crypto.createHash('sha256').update(json).digest('hex');
}

// ─── Diff-Berechnung ─────────────────────────────────────────────────────

function compareArrays(
  category: string,
  oldItems: any[],
  newItems: any[],
  keyFn: (item: any) => string,
): DiffItem[] {
  const diffs: DiffItem[] = [];
  const oldMap = new Map(oldItems.map(i => [keyFn(i), i]));
  const newMap = new Map(newItems.map(i => [keyFn(i), i]));

  // NEU hinzugekommen
  for (const [key, item] of newMap) {
    if (!oldMap.has(key)) {
      diffs.push({
        category,
        changeType: 'ADDED',
        itemKey: key,
        oldValue: null,
        newValue: item,
        severity: determineSeverity(category, 'ADDED', item),
      });
    }
  }

  // ENTFERNT
  for (const [key, item] of oldMap) {
    if (!newMap.has(key)) {
      diffs.push({
        category,
        changeType: 'REMOVED',
        itemKey: key,
        oldValue: item,
        newValue: null,
        severity: determineSeverity(category, 'REMOVED', item),
      });
    }
  }

  // MODIFIZIERT – Werte vergleichen
  for (const [key, newItem] of newMap) {
    const oldItem = oldMap.get(key);
    if (oldItem) {
      const oldJson = JSON.stringify(oldItem);
      const newJson = JSON.stringify(newItem);
      if (oldJson !== newJson) {
        diffs.push({
          category,
          changeType: 'MODIFIED',
          itemKey: key,
          oldValue: oldItem,
          newValue: newItem,
          severity: determineSeverity(category, 'MODIFIED', newItem),
        });
      }
    }
  }

  return diffs;
}

function computeDiffs(oldData: SnapshotData, newData: SnapshotData): DiffItem[] {
  const allDiffs: DiffItem[] = [];

  // Services
  allDiffs.push(...compareArrays('services', oldData.services, newData.services,
    s => `${s.name}:${s.port || 'N/A'}:${s.protocol || 'tcp'}`));

  // Mounts
  allDiffs.push(...compareArrays('mounts', oldData.mounts, newData.mounts,
    m => m.mountPoint));

  // Docker Container
  allDiffs.push(...compareArrays('dockerContainers', oldData.dockerContainers, newData.dockerContainers,
    c => c.name));

  // Systemd Units
  allDiffs.push(...compareArrays('systemdUnits', oldData.systemdUnits, newData.systemdUnits,
    u => u.name));

  // Cron Jobs
  allDiffs.push(...compareArrays('cronJobs', oldData.cronJobs, newData.cronJobs,
    j => `${j.user}:${j.schedule}:${j.command.substring(0, 80)}`));

  // SSL-Zertifikate
  allDiffs.push(...compareArrays('sslCertificates', oldData.sslCertificates, newData.sslCertificates,
    c => c.path));

  // Benutzer-Accounts
  allDiffs.push(...compareArrays('userAccounts', oldData.userAccounts, newData.userAccounts,
    u => `${u.username}:${u.uid}`));

  // Netzwerk-Interfaces
  allDiffs.push(...compareArrays('networkInterfaces', oldData.networkInterfaces, newData.networkInterfaces,
    n => `${n.name}:${n.ipAddr || ''}`));

  // Server-Meta Änderungen
  const oldMeta = oldData.serverMeta;
  const newMeta = newData.serverMeta;
  if (JSON.stringify(oldMeta) !== JSON.stringify(newMeta)) {
    const changes: string[] = [];
    if (oldMeta.osInfo !== newMeta.osInfo) changes.push('OS');
    if (oldMeta.kernelInfo !== newMeta.kernelInfo) changes.push('Kernel');
    if (oldMeta.memoryMb !== newMeta.memoryMb) changes.push('RAM');
    if (oldMeta.cpuInfo !== newMeta.cpuInfo) changes.push('CPU');
    if (oldMeta.hostname !== newMeta.hostname) changes.push('Hostname');

    if (changes.length > 0) {
      allDiffs.push({
        category: 'serverMeta',
        changeType: 'MODIFIED',
        itemKey: `meta:${changes.join(',')}`,
        oldValue: oldMeta,
        newValue: newMeta,
        severity: changes.includes('OS') || changes.includes('Kernel') ? 'WARNING' : 'INFO',
      });
    }
  }

  return allDiffs;
}

// ─── Öffentliche API ─────────────────────────────────────────────────────

/**
 * Erstellt einen Snapshot nach einem erfolgreichen Scan und berechnet Diffs
 * zum vorherigen Snapshot. Wird vom Scan-Worker aufgerufen.
 */
export async function createSnapshotAndDiff(serverId: string): Promise<{
  snapshotId: string;
  scanNumber: number;
  diffsCount: number;
  isFirstScan: boolean;
}> {
  // Aktuellen Zustand erfassen
  const currentData = await buildSnapshotData(serverId);
  const checksum = computeChecksum(currentData);

  // Letzte Snapshot-Nummer ermitteln
  const lastSnapshot = await prisma.scanSnapshot.findFirst({
    where: { serverId },
    orderBy: { scanNumber: 'desc' },
    select: { scanNumber: true, checksum: true, data: true, id: true },
  });

  const newScanNumber = (lastSnapshot?.scanNumber ?? 0) + 1;

  // Snapshot speichern
  const snapshot = await prisma.scanSnapshot.create({
    data: {
      serverId,
      scanNumber: newScanNumber,
      data: currentData as any,
      checksum,
    },
  });

  // Wenn kein vorheriger Snapshot → erster Scan
  if (!lastSnapshot) {
    logger.info(`📸 Erster Snapshot für Server ${serverId} (Scan #${newScanNumber})`);
    return {
      snapshotId: snapshot.id,
      scanNumber: newScanNumber,
      diffsCount: 0,
      isFirstScan: true,
    };
  }

  // Wenn Checksum identisch → keine Änderungen
  if (lastSnapshot.checksum === checksum) {
    logger.info(`📸 Snapshot #${newScanNumber} für Server ${serverId} – keine Änderungen`);
    return {
      snapshotId: snapshot.id,
      scanNumber: newScanNumber,
      diffsCount: 0,
      isFirstScan: false,
    };
  }

  // Diffs berechnen
  const oldData = lastSnapshot.data as unknown as SnapshotData;
  const diffs = computeDiffs(oldData, currentData);

  if (diffs.length > 0) {
    // Batch-Insert aller DiffEvents
    await prisma.diffEvent.createMany({
      data: diffs.map(d => ({
        serverId,
        snapshotId: snapshot.id,
        category: d.category,
        changeType: d.changeType,
        itemKey: d.itemKey,
        oldValue: d.oldValue,
        newValue: d.newValue,
        severity: d.severity,
      })),
    });

    logger.info(`📸 Snapshot #${newScanNumber} für Server ${serverId} – ${diffs.length} Änderungen erkannt`);

    // Zusammenfassung loggen
    const bySeverity = { INFO: 0, WARNING: 0, CRITICAL: 0 };
    diffs.forEach(d => { bySeverity[d.severity]++; });
    if (bySeverity.CRITICAL > 0) {
      logger.warn(`🚨 ${bySeverity.CRITICAL} KRITISCHE Änderungen auf Server ${serverId}`);
    }
    if (bySeverity.WARNING > 0) {
      logger.warn(`⚠️  ${bySeverity.WARNING} Warnungen auf Server ${serverId}`);
    }
  }

  return {
    snapshotId: snapshot.id,
    scanNumber: newScanNumber,
    diffsCount: diffs.length,
    isFirstScan: false,
  };
}

/**
 * Gibt die Diff-Timeline für einen Server zurück.
 */
export async function getServerDiffTimeline(serverId: string, options?: {
  limit?: number;
  category?: string;
  severity?: string;
  acknowledged?: boolean;
}) {
  const where: any = { serverId };
  if (options?.category) where.category = options.category;
  if (options?.severity) where.severity = options.severity;
  if (options?.acknowledged !== undefined) where.acknowledged = options.acknowledged;

  return prisma.diffEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: options?.limit || 100,
    include: {
      snapshot: {
        select: { scanNumber: true, createdAt: true },
      },
    },
  });
}

/**
 * Gibt eine kompakte Zusammenfassung der letzten Änderungen zurück.
 */
export async function getDiffSummary(serverId?: string) {
  const where: any = serverId ? { serverId } : {};

  const [total, unacknowledged, bySeverity, byCategory, recent] = await Promise.all([
    prisma.diffEvent.count({ where }),
    prisma.diffEvent.count({ where: { ...where, acknowledged: false } }),
    prisma.diffEvent.groupBy({
      by: ['severity'],
      where,
      _count: true,
    }),
    prisma.diffEvent.groupBy({
      by: ['category'],
      where: { ...where, acknowledged: false },
      _count: true,
      orderBy: { _count: { category: 'desc' } },
    }),
    prisma.diffEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        server: { select: { ip: true, hostname: true } },
        snapshot: { select: { scanNumber: true } },
      },
    }),
  ]);

  return {
    total,
    unacknowledged,
    bySeverity: Object.fromEntries(bySeverity.map(s => [s.severity, s._count])),
    byCategory: Object.fromEntries(byCategory.map(c => [c.category, c._count])),
    recent,
  };
}

/**
 * Gibt Snapshots für einen Server zurück.
 */
export async function getServerSnapshots(serverId: string, limit: number = 20) {
  return prisma.scanSnapshot.findMany({
    where: { serverId },
    orderBy: { scanNumber: 'desc' },
    take: limit,
    select: {
      id: true,
      scanNumber: true,
      checksum: true,
      createdAt: true,
      _count: { select: { diffs: true } },
    },
  });
}
