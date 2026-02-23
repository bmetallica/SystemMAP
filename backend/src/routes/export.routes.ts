// ─── Export Routes (Etappe 4) ────────────────────────────────────────────
// Export von Server-Daten als JSON, CSV und Markdown

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { prisma } from '../lib/prisma';

const router = Router();
router.use(authenticate);

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────

function jsonToCsv(data: any[], columns?: string[]): string {
  if (data.length === 0) return '';
  const cols = columns || Object.keys(data[0]);
  const header = cols.join(';');
  const rows = data.map(row =>
    cols.map(col => {
      let val = row[col];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') val = JSON.stringify(val);
      val = String(val).replace(/"/g, '""');
      if (String(val).includes(';') || String(val).includes('"') || String(val).includes('\n')) {
        val = `"${val}"`;
      }
      return val;
    }).join(';')
  );
  return [header, ...rows].join('\n');
}

// ─── Vollständige Server-Daten laden ─────────────────────────────────────

async function getFullServerData(serverId: string) {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      services: { orderBy: { name: 'asc' } },
      mounts: { orderBy: { mountPoint: 'asc' } },
      networkInterfaces: { orderBy: { name: 'asc' } },
      dockerContainers: { orderBy: { name: 'asc' } },
      cronJobs: { orderBy: { schedule: 'asc' } },
      systemdUnits: { orderBy: { name: 'asc' } },
      sslCertificates: { orderBy: { validTo: 'asc' } },
      lvmVolumes: { orderBy: { vgName: 'asc' } },
      userAccounts: { orderBy: { uid: 'asc' } },
      processes: { orderBy: { cpuPct: 'desc' }, take: 100 },
      outgoingEdges: {
        include: { targetServer: { select: { ip: true, hostname: true } } },
      },
      incomingEdges: {
        include: { sourceServer: { select: { ip: true, hostname: true } } },
      },
    },
  });

  if (!server) return null;

  // SSH-Credentials entfernen
  const { sshPasswordEncrypted, sshKeyEncrypted, rawScanData, ...safe } = server;
  return safe;
}

// ═══════════════════════════════════════════════════════════════════════════
// Server-Export
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /api/export/server/:id/json ─────────────────────────────────────
router.get('/server/:id/json', async (req: Request, res: Response) => {
  try {
    const data = await getFullServerData(req.params.id as string);
    if (!data) { res.status(404).json({ error: 'Server nicht gefunden' }); return; }

    const filename = `systemmap-${data.hostname || data.ip}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/export/server/:id/csv ──────────────────────────────────────
router.get('/server/:id/csv', async (req: Request, res: Response) => {
  try {
    const data = await getFullServerData(req.params.id as string);
    if (!data) { res.status(404).json({ error: 'Server nicht gefunden' }); return; }

    const sections: string[] = [];

    // Server-Info
    sections.push('# Server-Info');
    sections.push(jsonToCsv([{
      IP: data.ip,
      Hostname: data.hostname,
      OS: data.osInfo,
      Kernel: data.kernelInfo,
      CPU: data.cpuInfo,
      'RAM (MB)': data.memoryMb,
      Status: data.status,
      'Letzter Scan': data.lastScanAt,
    }]));

    // Services
    if (data.services.length > 0) {
      sections.push('\n# Services');
      sections.push(jsonToCsv(data.services.map(s => ({
        Name: s.name, Port: s.port, Protokoll: s.protocol,
        Bind: s.bindAddress, Status: s.state, Version: s.version, PID: s.pid,
      }))));
    }

    // Mounts
    if (data.mounts.length > 0) {
      sections.push('\n# Mounts');
      sections.push(jsonToCsv(data.mounts.map(m => ({
        Device: m.device, Mountpoint: m.mountPoint, Dateisystem: m.fsType,
        'Größe (MB)': m.sizeMb, 'Belegt (MB)': m.usedMb, 'Nutzung (%)': m.usePct,
      }))));
    }

    // Docker
    if (data.dockerContainers.length > 0) {
      sections.push('\n# Docker-Container');
      sections.push(jsonToCsv(data.dockerContainers.map(c => ({
        Name: c.name, Image: c.image, Status: c.state, ContainerID: c.containerId,
      }))));
    }

    // Systemd Units
    if (data.systemdUnits.length > 0) {
      sections.push('\n# Systemd-Units');
      sections.push(jsonToCsv(data.systemdUnits.map(u => ({
        Name: u.name, Typ: u.unitType, Status: u.activeState,
        SubStatus: u.subState, Enabled: u.enabled, PID: u.mainPid,
        'RAM (MB)': u.memoryMb,
      }))));
    }

    // SSL-Zertifikate
    if (data.sslCertificates.length > 0) {
      sections.push('\n# SSL-Zertifikate');
      sections.push(jsonToCsv(data.sslCertificates.map(c => ({
        Pfad: c.path, Subject: c.subject, Issuer: c.issuer,
        'Gültig bis': c.validTo, Abgelaufen: c.isExpired, 'Tage übrig': c.daysLeft,
      }))));
    }

    // Cron-Jobs
    if (data.cronJobs.length > 0) {
      sections.push('\n# Cron-Jobs');
      sections.push(jsonToCsv(data.cronJobs.map(j => ({
        User: j.user, Schedule: j.schedule, Kommando: j.command, Quelle: j.source,
      }))));
    }

    // Benutzer
    if (data.userAccounts.length > 0) {
      sections.push('\n# Benutzer-Accounts');
      sections.push(jsonToCsv(data.userAccounts.map(u => ({
        Username: u.username, UID: u.uid, GID: u.gid, Shell: u.shell,
        HomeDir: u.homeDir, 'Login aktiv': u.hasLogin,
      }))));
    }

    // Netzwerk-Interfaces
    if (data.networkInterfaces.length > 0) {
      sections.push('\n# Netzwerk-Interfaces');
      sections.push(jsonToCsv(data.networkInterfaces.map(n => ({
        Name: n.name, IP: n.ipAddr, MAC: n.macAddr,
        Status: n.state, MTU: n.mtu, Speed: n.speed,
      }))));
    }

    const filename = `systemmap-${data.hostname || data.ip}-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + sections.join('\n')); // BOM für Excel
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/export/server/:id/markdown ─────────────────────────────────
router.get('/server/:id/markdown', async (req: Request, res: Response) => {
  try {
    const data = await getFullServerData(req.params.id as string);
    if (!data) { res.status(404).json({ error: 'Server nicht gefunden' }); return; }

    const lines: string[] = [];
    const label = data.hostname || data.ip;

    lines.push(`# 🖥️ Server-Dokumentation: ${label}`);
    lines.push(`> Generiert am ${new Date().toLocaleString('de-DE')} von SystemMAP\n`);

    // Server-Info
    lines.push('## 📋 Allgemeine Informationen\n');
    lines.push(`| Eigenschaft | Wert |`);
    lines.push(`|-------------|------|`);
    lines.push(`| **IP** | ${data.ip} |`);
    lines.push(`| **Hostname** | ${data.hostname || '–'} |`);
    lines.push(`| **OS** | ${data.osInfo || '–'} |`);
    lines.push(`| **Kernel** | ${data.kernelInfo || '–'} |`);
    lines.push(`| **CPU** | ${data.cpuInfo || '–'} |`);
    lines.push(`| **RAM** | ${data.memoryMb ? data.memoryMb + ' MB' : '–'} |`);
    lines.push(`| **Status** | ${data.status} |`);
    lines.push(`| **Letzter Scan** | ${data.lastScanAt || '–'} |`);
    lines.push('');

    // Services
    if (data.services.length > 0) {
      lines.push(`## 🔌 Services (${data.services.length})\n`);
      lines.push('| Name | Port | Protokoll | Status | Version |');
      lines.push('|------|------|-----------|--------|---------|');
      data.services.forEach(s => {
        lines.push(`| ${s.name} | ${s.port || '–'} | ${s.protocol || '–'} | ${s.state} | ${s.version || '–'} |`);
      });
      lines.push('');
    }

    // Mounts
    if (data.mounts.length > 0) {
      lines.push(`## 💾 Mounts (${data.mounts.length})\n`);
      lines.push('| Mountpoint | Device | FS | Größe | Belegt | % |');
      lines.push('|------------|--------|----|----|-----|---|');
      data.mounts.forEach(m => {
        const pct = m.usePct != null ? `${m.usePct}%` : '–';
        const warn = (m.usePct || 0) >= 90 ? ' ⚠️' : '';
        lines.push(`| ${m.mountPoint} | ${m.device} | ${m.fsType} | ${m.sizeMb || '–'} MB | ${m.usedMb || '–'} MB | ${pct}${warn} |`);
      });
      lines.push('');
    }

    // Docker
    if (data.dockerContainers.length > 0) {
      lines.push(`## 🐳 Docker-Container (${data.dockerContainers.length})\n`);
      lines.push('| Name | Image | Status |');
      lines.push('|------|-------|--------|');
      data.dockerContainers.forEach(c => {
        const icon = c.state === 'running' ? '🟢' : '🔴';
        lines.push(`| ${c.name} | ${c.image} | ${icon} ${c.state} |`);
      });
      lines.push('');
    }

    // Systemd Units
    const activeUnits = data.systemdUnits.filter(u => u.unitType === 'service');
    if (activeUnits.length > 0) {
      lines.push(`## ⚙️ Systemd-Services (${activeUnits.length})\n`);
      lines.push('| Unit | Status | Enabled |');
      lines.push('|------|--------|---------|');
      activeUnits.forEach(u => {
        const icon = u.activeState === 'active' ? '🟢' : u.activeState === 'failed' ? '🔴' : '⚪';
        lines.push(`| ${u.name} | ${icon} ${u.activeState} | ${u.enabled ? '✅' : '❌'} |`);
      });
      lines.push('');
    }

    // SSL
    if (data.sslCertificates.length > 0) {
      lines.push(`## 🔒 SSL-Zertifikate (${data.sslCertificates.length})\n`);
      lines.push('| Subject | Gültig bis | Tage übrig | Status |');
      lines.push('|---------|-----------|------------|--------|');
      data.sslCertificates.forEach(c => {
        const icon = c.isExpired ? '🔴 Abgelaufen' : (c.daysLeft || 999) <= 30 ? '🟡 Bald' : '🟢 OK';
        lines.push(`| ${c.subject || c.path} | ${c.validTo || '–'} | ${c.daysLeft ?? '–'} | ${icon} |`);
      });
      lines.push('');
    }

    // Cron-Jobs
    if (data.cronJobs.length > 0) {
      lines.push(`## ⏰ Cron-Jobs (${data.cronJobs.length})\n`);
      lines.push('| User | Schedule | Kommando |');
      lines.push('|------|----------|----------|');
      data.cronJobs.forEach(j => {
        const cmd = j.command.length > 60 ? j.command.substring(0, 60) + '...' : j.command;
        lines.push(`| ${j.user} | \`${j.schedule}\` | \`${cmd}\` |`);
      });
      lines.push('');
    }

    // Benutzer mit Login
    const loginUsers = data.userAccounts.filter(u => u.hasLogin);
    if (loginUsers.length > 0) {
      lines.push(`## 👤 Benutzer mit Login (${loginUsers.length})\n`);
      lines.push('| Username | UID | Shell | Home |');
      lines.push('|----------|-----|-------|------|');
      loginUsers.forEach(u => {
        lines.push(`| ${u.username} | ${u.uid} | ${u.shell || '–'} | ${u.homeDir || '–'} |`);
      });
      lines.push('');
    }

    // Netzwerk
    if (data.networkInterfaces.length > 0) {
      lines.push(`## 🌐 Netzwerk-Interfaces (${data.networkInterfaces.length})\n`);
      lines.push('| Name | IP | MAC | Status |');
      lines.push('|------|----|----|--------|');
      data.networkInterfaces.forEach(n => {
        lines.push(`| ${n.name} | ${n.ipAddr || '–'} | ${n.macAddr || '–'} | ${n.state || '–'} |`);
      });
      lines.push('');
    }

    // Verbindungen
    if (data.outgoingEdges.length > 0) {
      lines.push(`## 🔗 Ausgehende Verbindungen (${data.outgoingEdges.length})\n`);
      lines.push('| Ziel-IP | Port | Prozess | Methode |');
      lines.push('|---------|------|---------|---------|');
      data.outgoingEdges.forEach(e => {
        const target = e.targetServer ? `${e.targetServer.hostname || e.targetServer.ip}` : e.targetIp;
        lines.push(`| ${target} | ${e.targetPort} | ${e.sourceProcess || '–'} | ${e.detectionMethod} |`);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('*Exportiert von [SystemMAP](https://github.com/bmetallica/SystemMAP)*');

    const filename = `systemmap-${label}-${new Date().toISOString().slice(0, 10)}.md`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(lines.join('\n'));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Bulk-Export
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /api/export/all/json ────────────────────────────────────────────
// Alle Server als JSON-Array
router.get('/all/json', async (_req: Request, res: Response) => {
  try {
    const servers = await prisma.server.findMany({
      where: { status: { not: 'DISCOVERED' } },
      select: {
        id: true, ip: true, hostname: true, osInfo: true, kernelInfo: true,
        cpuInfo: true, memoryMb: true, status: true, lastScanAt: true,
        _count: {
          select: {
            services: true, dockerContainers: true, mounts: true,
            systemdUnits: true, sslCertificates: true, userAccounts: true,
          },
        },
      },
      orderBy: { ip: 'asc' },
    });

    const filename = `systemmap-inventory-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json({ exportDate: new Date().toISOString(), serverCount: servers.length, servers });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/export/all/csv ─────────────────────────────────────────────
// Alle Server als CSV-Übersicht
router.get('/all/csv', async (_req: Request, res: Response) => {
  try {
    const servers = await prisma.server.findMany({
      where: { status: { not: 'DISCOVERED' } },
      include: {
        _count: {
          select: {
            services: true, dockerContainers: true, mounts: true,
            systemdUnits: true, sslCertificates: true, userAccounts: true,
          },
        },
      },
      orderBy: { ip: 'asc' },
    });

    const csv = jsonToCsv(servers.map(s => ({
      IP: s.ip,
      Hostname: s.hostname || '',
      OS: s.osInfo || '',
      Kernel: s.kernelInfo || '',
      'RAM (MB)': s.memoryMb || '',
      Status: s.status,
      Services: s._count.services,
      Container: s._count.dockerContainers,
      Mounts: s._count.mounts,
      'Systemd-Units': s._count.systemdUnits,
      'SSL-Zertifikate': s._count.sslCertificates,
      Benutzer: s._count.userAccounts,
      'Letzter Scan': s.lastScanAt?.toISOString() || '',
    })));

    const filename = `systemmap-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/export/diffs/csv ───────────────────────────────────────────
// Alle unbestätigten Diffs als CSV
router.get('/diffs/csv', async (_req: Request, res: Response) => {
  try {
    const diffs = await prisma.diffEvent.findMany({
      where: { acknowledged: false },
      orderBy: { createdAt: 'desc' },
      include: {
        server: { select: { ip: true, hostname: true } },
        snapshot: { select: { scanNumber: true } },
      },
    });

    const csv = jsonToCsv(diffs.map(d => ({
      Datum: d.createdAt.toISOString(),
      Server: d.server.hostname || d.server.ip,
      'Scan #': d.snapshot.scanNumber,
      Kategorie: d.category,
      Änderung: d.changeType,
      Element: d.itemKey,
      Schwere: d.severity,
      'Alter Wert': d.oldValue ? JSON.stringify(d.oldValue) : '',
      'Neuer Wert': d.newValue ? JSON.stringify(d.newValue) : '',
    })));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="systemmap-diffs-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/export/alerts/csv ──────────────────────────────────────────
// Alle offenen Alerts als CSV
router.get('/alerts/csv', async (_req: Request, res: Response) => {
  try {
    const alerts = await prisma.alert.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        server: { select: { ip: true, hostname: true } },
        rule: { select: { name: true } },
      },
    });

    const csv = jsonToCsv(alerts.map(a => ({
      Datum: a.createdAt.toISOString(),
      Server: a.server?.hostname || a.server?.ip || '–',
      Regel: a.rule?.name || '–',
      Titel: a.title,
      Nachricht: a.message,
      Schwere: a.severity,
      Kategorie: a.category,
      Gelöst: a.resolved ? 'Ja' : 'Nein',
      'Gelöst am': a.resolvedAt?.toISOString() || '',
      'Gelöst von': a.resolvedBy || '',
    })));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="systemmap-alerts-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('\uFEFF' + csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
