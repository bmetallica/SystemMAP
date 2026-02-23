// ─── Gather Script Generator v2 (Etappe 2) ──────────────────────────────
// Generiert ein umfassendes Bash-Skript, das auf dem Zielsystem ausgeführt
// wird und tiefgreifende Systeminformationen als strukturiertes JSON liefert.
//
// Module:
//   1.  OS & Hardware (CPU, RAM, Virtualisierung, Boot)
//   2.  Disk-Layout (lsblk)
//   3.  LVM-Volumes
//   4.  RAID-Status (mdadm)
//   5.  Mounts & df
//   6.  Netzwerk-Interfaces (ip addr + stats)
//   7.  Routing & DNS-Resolver
//   8.  /etc/hosts (strukturiert)
//   9.  ARP-Tabelle
//  10.  Prozesse (detailliert mit cgroup, fd-count, ppid)
//  11.  Listening-Sockets (TCP + UDP inkl. PID)
//  12.  Aktive TCP/UDP-Verbindungen (ss -ntup)
//  13.  Docker Deep-Scan (inspect mit Passwort-Maskierung)
//  14.  Webserver-Configs (Nginx / Apache / HAProxy / Caddy)
//  15.  Systemd-Units (detailliert)
//  16.  Cron-Jobs (user + system + systemd-timer)
//  17.  SSL-Zertifikate
//  18.  Benutzer-Accounts
//  19.  Firewall-Regeln (iptables / nftables / ufw)
//  20.  Installierte Pakete
//  21.  Kernel-Module & Sysctl-Highlights
//  22.  Sicherheits-Status (SELinux / AppArmor / SSHD / fail2ban)

export interface GatherScriptOptions {
  /** Ob Docker Deep-Inspect ausgeführt werden soll (default: true) */
  dockerDeepScan?: boolean;
  /** Ob SSL-Zertifikate gescannt werden sollen (default: true) */
  sslScan?: boolean;
  /** Maximale Prozessanzahl (default: 1000) */
  maxProcesses?: number;
  /** Timeout in Sekunden für einzelne Sammler (default: 15) */
  collectorTimeout?: number;
  /** Ob Paketliste gesammelt werden soll (default: false – kann groß sein) */
  collectPackages?: boolean;
}

const DEFAULT_OPTIONS: Required<GatherScriptOptions> = {
  dockerDeepScan: true,
  sslScan: true,
  maxProcesses: 1000,
  collectorTimeout: 15,
  collectPackages: false,
};

/**
 * Erzeugt das komplette Gather-Script als String.
 * Das Script gibt ein JSON-Objekt auf stdout aus.
 */
export function generateGatherScript(opts?: GatherScriptOptions): string {
  const o = { ...DEFAULT_OPTIONS, ...opts };

  // Einzelteile zusammenbauen
  const parts = [
    scriptHeader(o),
    helperFunctions(),
    moduleOS(),
    moduleDisks(),
    moduleLVM(),
    moduleRAID(),
    moduleMounts(),
    moduleInterfaces(),
    moduleRouting(),
    moduleHosts(),
    moduleARP(),
    moduleProcesses(o),
    moduleListeners(),
    moduleSockets(),
    moduleDocker(o),
    moduleWebserverConfigs(),
    moduleSystemd(),
    moduleCron(),
    moduleSSLCerts(o),
    moduleUsers(),
    moduleFirewall(),
    modulePackages(o),
    moduleKernel(),
    moduleSecurity(),
    moduleLogs(),
    mainProgram(),
  ];

  return parts.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Script-Teile als Funktionen (für Übersichtlichkeit)
// ═══════════════════════════════════════════════════════════════════════════

function scriptHeader(o: Required<GatherScriptOptions>): string {
  return `#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# SystemMAP Gather Script v2.0 – Deep-Dive Datensammlung
# Automatisch generiert – wird temporär auf dem Zielsystem ausgeführt
# Gibt strukturiertes JSON auf stdout aus
# ═══════════════════════════════════════════════════════════════════════════
set -o pipefail
export LC_ALL=C

COLLECTOR_TIMEOUT=${o.collectorTimeout}
`;
}

function helperFunctions(): string {
  return `
# ─── Hilfsfunktionen ──────────────────────────────────────────────────────

json_escape() {
  if command -v python3 &>/dev/null; then
    python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null
  elif command -v python &>/dev/null; then
    python -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null
  else
    local s
    s=$(cat)
    s=\${s//\\\\/\\\\\\\\}
    s=\${s//\\"/\\\\\\"}
    s=\${s//$'\\n'/\\\\n}
    s=\${s//$'\\t'/\\\\t}
    s=\${s//$'\\r'/\\\\r}
    printf '"%s"' "$s"
  fi
}

run_collector() {
  local name="$1"
  shift
  # Run function directly (timeout handled via overall script timeout)
  "$@" 2>/dev/null || true
}
`;
}

function moduleOS(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 1: OS & Hardware
# ═══════════════════════════════════════════════════════════════════════════
gather_os() {
  local hostname_val kernel_val os_pretty arch_val uptime_val uptime_secs
  hostname_val=$(hostname -f 2>/dev/null || hostname)
  kernel_val=$(uname -r)
  arch_val=$(uname -m)
  uptime_val=$(uptime -s 2>/dev/null || echo "unknown")
  uptime_secs=$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null || echo 0)

  local os_pretty="unknown" os_id="" os_version=""
  if [ -f /etc/os-release ]; then
    os_pretty=$(. /etc/os-release && echo "$PRETTY_NAME")
    os_id=$(. /etc/os-release && echo "$ID")
    os_version=$(. /etc/os-release && echo "$VERSION_ID")
  fi

  local cpu_model cpu_cores cpu_threads cpu_sockets mem_total_mb mem_avail_mb swap_total_mb
  cpu_model=$(grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed 's/^ //')
  cpu_cores=$(nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo 1)
  cpu_threads=$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "$cpu_cores")
  cpu_sockets=$(grep 'physical id' /proc/cpuinfo 2>/dev/null | sort -u | wc -l)
  [ "$cpu_sockets" -eq 0 ] 2>/dev/null && cpu_sockets=1
  mem_total_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)
  mem_avail_mb=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)
  swap_total_mb=$(awk '/SwapTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)

  local virt_type="bare-metal"
  if [ -f /sys/class/dmi/id/product_name ]; then
    local pname=$(cat /sys/class/dmi/id/product_name 2>/dev/null)
    case "$pname" in
      *QEMU*|*KVM*)     virt_type="kvm" ;;
      *VMware*)         virt_type="vmware" ;;
      *VirtualBox*)     virt_type="virtualbox" ;;
      *Hyper-V*|*Virtual\\ Machine*) virt_type="hyper-v" ;;
      *Xen*)            virt_type="xen" ;;
    esac
  fi
  if grep -q 'docker\\|lxc\\|containerd' /proc/1/cgroup 2>/dev/null; then
    virt_type="container"
  fi
  if command -v systemd-detect-virt &>/dev/null && systemd-detect-virt -q 2>/dev/null; then
    virt_type=$(systemd-detect-virt 2>/dev/null || echo "$virt_type")
  fi

  local boot_mode="bios"
  [ -d /sys/firmware/efi ] && boot_mode="uefi"

  local timezone=$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo "unknown")

  cat <<EOJSON
  "os": {
    "hostname": $(echo "$hostname_val" | json_escape),
    "os_pretty": $(echo "$os_pretty" | json_escape),
    "os_id": "$os_id",
    "os_version": "$os_version",
    "kernel": $(echo "$kernel_val" | json_escape),
    "arch": "$arch_val",
    "uptime_since": "$uptime_val",
    "uptime_seconds": $uptime_secs,
    "cpu_model": $(echo "$cpu_model" | json_escape),
    "cpu_cores": $cpu_cores,
    "cpu_threads": $cpu_threads,
    "cpu_sockets": $cpu_sockets,
    "memory_total_mb": \${mem_total_mb:-0},
    "memory_available_mb": \${mem_avail_mb:-0},
    "swap_total_mb": \${swap_total_mb:-0},
    "virtualization": "$virt_type",
    "boot_mode": "$boot_mode",
    "timezone": $(echo "$timezone" | json_escape)
  }
EOJSON
}
`;
}

function moduleDisks(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 2: Disk-Layout (lsblk)
# ═══════════════════════════════════════════════════════════════════════════
gather_disks() {
  echo '  "disks": ['
  if command -v lsblk &>/dev/null; then
    lsblk -Jbno NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL,SERIAL,ROTA,RO,TRAN 2>/dev/null | \\
    python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    devs = data.get('blockdevices', [])
    first = True
    for d in devs:
        if d.get('type') in ('disk', 'part', 'lvm'):
            if not first: print(',')
            first = False
            size_mb = int(d.get('size', 0) or 0) // (1024*1024)
            obj = {
                'name': d.get('name', ''),
                'size_mb': size_mb,
                'type': d.get('type', ''),
                'fstype': d.get('fstype', ''),
                'mountpoint': d.get('mountpoint', ''),
                'model': (d.get('model') or '').strip(),
                'serial': (d.get('serial') or '').strip(),
                'rotational': bool(d.get('rota')),
                'readonly': bool(d.get('ro')),
                'transport': d.get('tran', '')
            }
            print('    ' + json.dumps(obj), end='')
    if not first: print()
except: pass
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleLVM(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 3: LVM
# ═══════════════════════════════════════════════════════════════════════════
gather_lvm() {
  echo '  "lvm": {'
  echo -n '    "available": '
  if command -v lvs &>/dev/null; then
    echo 'true,'
    echo '    "volume_groups": ['
    local first_vg=true
    vgs --noheadings --nosuffix --units m -o vg_name,vg_size,vg_free,pv_count,lv_count 2>/dev/null | while IFS= read -r line; do
      local vg_name vg_size vg_free pv_count lv_count
      vg_name=$(echo "$line" | awk '{print $1}')
      vg_size=$(echo "$line" | awk '{printf "%d", $2}')
      vg_free=$(echo "$line" | awk '{printf "%d", $3}')
      pv_count=$(echo "$line" | awk '{print $4}')
      lv_count=$(echo "$line" | awk '{print $5}')
      if [ "$first_vg" = true ]; then first_vg=false; else echo ','; fi
      printf '      {"vg_name":"%s","size_mb":%s,"free_mb":%s,"pv_count":%s,"lv_count":%s}' \\
        "$vg_name" "$vg_size" "$vg_free" "$pv_count" "$lv_count"
    done
    echo ''
    echo '    ],'
    echo '    "logical_volumes": ['
    local first_lv=true
    lvs --noheadings --nosuffix --units m -o lv_name,vg_name,lv_size,lv_path,lv_attr 2>/dev/null | while IFS= read -r line; do
      local lv_name vg_name lv_size lv_path lv_attr active
      lv_name=$(echo "$line" | awk '{print $1}')
      vg_name=$(echo "$line" | awk '{print $2}')
      lv_size=$(echo "$line" | awk '{printf "%d", $3}')
      lv_path=$(echo "$line" | awk '{print $4}')
      lv_attr=$(echo "$line" | awk '{print $5}')
      active="true"
      echo "$lv_attr" | grep -q '^....a' || active="false"
      if [ "$first_lv" = true ]; then first_lv=false; else echo ','; fi
      printf '      {"lv_name":"%s","vg_name":"%s","size_mb":%s,"lv_path":"%s","active":%s}' \\
        "$lv_name" "$vg_name" "$lv_size" "$lv_path" "$active"
    done
    echo ''
    echo '    ]'
  else
    echo 'false,'
    echo '    "volume_groups": [],'
    echo '    "logical_volumes": []'
  fi
  echo '  }'
}
`;
}

function moduleRAID(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 4: RAID (mdadm)
# ═══════════════════════════════════════════════════════════════════════════
gather_raid() {
  echo '  "raid": ['
  if [ -f /proc/mdstat ] && grep -q '^md' /proc/mdstat 2>/dev/null; then
    python3 -c "
import re, json
with open('/proc/mdstat') as f:
    content = f.read()
first = True
for match in re.finditer(r'^(md\\d+)\\s*:\\s*(\\w+)\\s+(\\w+)\\s+(.+)', content, re.M):
    name, status, level, devices = match.groups()
    devs = re.findall(r'(\\w+)\\[\\d+\\](?:\\(\\w+\\))?', devices)
    if not first: print(',')
    first = False
    print('    ' + json.dumps({'device': '/dev/' + name, 'status': status, 'level': level, 'members': devs}), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleMounts(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 5: Mounts & Storage
# ═══════════════════════════════════════════════════════════════════════════
gather_mounts() {
  echo '  "mounts": ['
  local first=true
  df -BM --output=source,target,fstype,size,used,avail,pcent 2>/dev/null | tail -n +2 | \\
  grep -vE '^(tmpfs|devtmpfs|none|overlay|shm)\\b' | while IFS= read -r line; do
    local dev mp fs size used avail pct
    dev=$(echo "$line" | awk '{print $1}')
    mp=$(echo "$line" | awk '{print $2}')
    fs=$(echo "$line" | awk '{print $3}')
    size=$(echo "$line" | awk '{print $4}' | tr -d 'M')
    used=$(echo "$line" | awk '{print $5}' | tr -d 'M')
    avail=$(echo "$line" | awk '{print $6}' | tr -d 'M')
    pct=$(echo "$line" | awk '{print $7}' | tr -d '%')

    local inode_use=""
    inode_use=$(df --output=ipcent "$mp" 2>/dev/null | tail -1 | tr -d '% ')

    if [ "$first" = true ]; then first=false; else echo ','; fi
    printf '    {"device":"%s","mount_point":"%s","fs_type":"%s","size_mb":%s,"used_mb":%s,"avail_mb":%s,"use_pct":%s,"inode_use_pct":%s}' \\
      "$dev" "$mp" "$fs" "\${size:-0}" "\${used:-0}" "\${avail:-0}" "\${pct:-0}" "\${inode_use:-0}"
  done
  echo ''
  echo '  ]'
}
`;
}

function moduleInterfaces(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 6: Netzwerk-Interfaces (mit Statistiken)
# ═══════════════════════════════════════════════════════════════════════════
gather_interfaces() {
  echo '  "interfaces": ['
  if command -v python3 &>/dev/null; then
    ip -j addr show 2>/dev/null | python3 -c "
import json, sys, os
try:
    data = json.load(sys.stdin)
    first = True
    for iface in data:
        name = iface.get('ifname', '')
        if name == 'lo': continue
        state = iface.get('operstate', 'UNKNOWN')
        mac = iface.get('address', '')
        mtu = iface.get('mtu', 0)
        rx_bytes = tx_bytes = 0
        speed = ''
        try:
            with open(f'/sys/class/net/{name}/statistics/rx_bytes') as f:
                rx_bytes = int(f.read().strip())
            with open(f'/sys/class/net/{name}/statistics/tx_bytes') as f:
                tx_bytes = int(f.read().strip())
        except: pass
        try:
            with open(f'/sys/class/net/{name}/speed') as f:
                s = f.read().strip()
                if s != '-1':
                    speed = s + 'Mb/s'
        except: pass
        for addr_info in iface.get('addr_info', []):
            ip_addr = addr_info.get('local', '')
            prefix = addr_info.get('prefixlen', '')
            family = addr_info.get('family', '')
            if family == 'inet':
                if not first: print(',')
                first = False
                obj = {
                    'name': name,
                    'ip': f'{ip_addr}/{prefix}',
                    'mac': mac,
                    'state': state,
                    'mtu': mtu,
                    'speed': speed,
                    'rx_bytes': rx_bytes,
                    'tx_bytes': tx_bytes
                }
                print('    ' + json.dumps(obj), end='')
    if not first: print()
except: pass
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleRouting(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 7: Routing & DNS
# ═══════════════════════════════════════════════════════════════════════════
gather_routing() {
  echo '  "routing": {'
  local gw=$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}')
  local gw_dev=$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')
  echo "    \\"default_gateway\\": \\"\${gw:-none}\\","
  echo "    \\"gateway_device\\": \\"\${gw_dev:-none}\\","
  echo '    "dns_servers": ['
  local first_dns=true
  grep -E '^nameserver' /etc/resolv.conf 2>/dev/null | awk '{print $2}' | while read -r ns; do
    if [ "$first_dns" = true ]; then first_dns=false; else echo ','; fi
    printf '      "%s"' "$ns"
  done
  echo ''
  echo '    ],'
  echo -n '    "search_domains": '
  local search_raw
  search_raw=$(grep -E '^search|^domain' /etc/resolv.conf 2>/dev/null | awk '{$1=""; print}' | sed 's/^ //' || true)
  if [ -n "$search_raw" ]; then
    echo "$search_raw" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip().split()))" 2>/dev/null || echo '[]'
  else
    echo '[]'
  fi
  echo '  }'
}
`;
}

function moduleHosts(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 8: /etc/hosts (strukturiert)
# ═══════════════════════════════════════════════════════════════════════════
gather_hosts() {
  echo '  "etc_hosts": ['
  if [ -f /etc/hosts ] && command -v python3 &>/dev/null; then
    python3 -c "
import json
entries = []
with open('/etc/hosts') as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split()
        if len(parts) >= 2:
            entries.append({'ip': parts[0], 'hostnames': parts[1:]})
first = True
for e in entries:
    if not first: print(',')
    first = False
    print('    ' + json.dumps(e), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleARP(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 9: ARP-Tabelle
# ═══════════════════════════════════════════════════════════════════════════
gather_arp() {
  echo '  "arp_table": ['
  local first=true
  ip neigh 2>/dev/null | while IFS= read -r line; do
    local ip dev mac state
    ip=$(echo "$line" | awk '{print $1}')
    dev=$(echo "$line" | awk '{print $3}')
    mac=$(echo "$line" | grep -oP '([0-9a-f]{2}:){5}[0-9a-f]{2}' || echo "incomplete")
    state=$(echo "$line" | awk '{print $NF}')
    [ "$state" = "FAILED" ] && continue

    if [ "$first" = true ]; then first=false; else echo ','; fi
    printf '    {"ip":"%s","mac":"%s","device":"%s","state":"%s"}' "$ip" "$mac" "$dev" "$state"
  done
  echo ''
  echo '  ]'
}
`;
}

function moduleProcesses(o: Required<GatherScriptOptions>): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 10: Prozesse (detailliert)
# ═══════════════════════════════════════════════════════════════════════════
gather_processes() {
  echo '  "processes": ['
  if command -v python3 &>/dev/null; then
    python3 -c "
import os, json, glob

procs = []
max_procs = ${o.maxProcesses}
count = 0

for pid_dir in sorted(glob.glob('/proc/[0-9]*'), key=lambda x: int(os.path.basename(x))):
    pid = int(os.path.basename(pid_dir))
    if pid <= 2:
        continue
    try:
        with open(f'{pid_dir}/status') as f:
            status = {}
            for line in f:
                parts = line.strip().split(':\\t', 1)
                if len(parts) == 2:
                    status[parts[0]] = parts[1].strip()
        with open(f'{pid_dir}/cmdline') as f:
            cmdline_raw = f.read()
        cmdline_parts = cmdline_raw.replace('\\x00', ' ').strip().split(' ', 1)
        command = os.path.basename(cmdline_parts[0]) if cmdline_parts[0] else status.get('Name', '')
        args = cmdline_parts[1] if len(cmdline_parts) > 1 else ''
        try:
            full_path = os.readlink(f'{pid_dir}/exe')
        except:
            full_path = ''
        with open(f'{pid_dir}/stat') as f:
            stat_parts = f.read().split()
        ppid = int(stat_parts[3]) if len(stat_parts) > 3 else 0
        threads = int(stat_parts[19]) if len(stat_parts) > 19 else 1
        vsize = int(stat_parts[22]) // (1024*1024) if len(stat_parts) > 22 else 0
        rss_pages = int(stat_parts[23]) if len(stat_parts) > 23 else 0
        rss_mb = (rss_pages * 4096) / (1024*1024)
        start_time = stat_parts[21] if len(stat_parts) > 21 else ''
        uid = status.get('Uid', '0\\t0').split('\\t')[0]
        try:
            import pwd
            user = pwd.getpwuid(int(uid)).pw_name
        except:
            user = uid
        cgroup = ''
        try:
            with open(f'{pid_dir}/cgroup') as f:
                cgroup = f.readline().strip()
        except: pass
        try:
            fd_count = len(os.listdir(f'{pid_dir}/fd'))
        except:
            fd_count = 0
        proc = {
            'pid': pid,
            'ppid': ppid,
            'user': user,
            'command': command,
            'full_path': full_path,
            'args': args[:500],
            'threads': threads,
            'vsize_mb': vsize,
            'rss_mb': round(rss_mb, 1),
            'fd_count': fd_count,
            'cgroup': cgroup[:200],
            'start_time': start_time
        }
        procs.append(proc)
        count += 1
        if count >= max_procs:
            break
    except (PermissionError, FileNotFoundError, ProcessLookupError):
        continue
    except:
        continue

first = True
for p in procs:
    if not first: print(',')
    first = False
    print('    ' + json.dumps(p), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleListeners(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 11: Listening-Sockets (TCP + UDP)
# ═══════════════════════════════════════════════════════════════════════════
gather_listeners() {
  echo '  "listeners": ['
  local first=true

  # TCP Listeners (process substitution to avoid subshell variable scope)
  while IFS= read -r line; do
    local addr port process pid_str
    addr=$(echo "$line" | awk '{print $4}')
    port=$(echo "$addr" | rev | cut -d: -f1 | rev)
    local bind_addr=$(echo "$addr" | rev | cut -d: -f2- | rev)
    process=$(echo "$line" | grep -oP 'users:\\(\\("\\K[^"]+' 2>/dev/null | head -1 || echo "unknown")
    pid_str=$(echo "$line" | grep -oP 'pid=\\K[0-9]+' 2>/dev/null | head -1 || echo "0")

    if [ "$first" = true ]; then first=false; else echo ','; fi
    printf '    {"address":"%s","bind":"%s","port":%s,"protocol":"tcp","process":"%s","pid":%s}' \\
      "$addr" "$bind_addr" "$port" "$process" "$pid_str"
  done < <(ss -nltp 2>/dev/null | tail -n +2)

  # UDP Listeners (first carries over correctly from TCP loop)
  while IFS= read -r line; do
    local addr port process pid_str
    addr=$(echo "$line" | awk '{print $4}')
    port=$(echo "$addr" | rev | cut -d: -f1 | rev)
    local bind_addr=$(echo "$addr" | rev | cut -d: -f2- | rev)
    process=$(echo "$line" | grep -oP 'users:\\(\\("\\K[^"]+' 2>/dev/null | head -1 || echo "unknown")
    pid_str=$(echo "$line" | grep -oP 'pid=\\K[0-9]+' 2>/dev/null | head -1 || echo "0")

    if [ "$first" = true ]; then first=false; else echo ','; fi
    printf '    {"address":"%s","bind":"%s","port":%s,"protocol":"udp","process":"%s","pid":%s}' \\
      "$addr" "$bind_addr" "$port" "$process" "$pid_str"
  done < <(ss -nlup 2>/dev/null | tail -n +2)

  echo ''
  echo '  ]'
}
`;
}

function moduleSockets(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 12: Aktive TCP/UDP-Verbindungen
# ═══════════════════════════════════════════════════════════════════════════
gather_sockets() {
  echo '  "sockets": ['
  local first=true
  ss -ntup 2>/dev/null | tail -n +2 | while IFS= read -r line; do
    local proto state local_addr peer_addr process pid_str
    proto=$(echo "$line" | awk '{print $1}')
    state=$(echo "$line" | awk '{print $2}')
    local_addr=$(echo "$line" | awk '{print $5}')
    peer_addr=$(echo "$line" | awk '{print $6}')
    process=$(echo "$line" | grep -oP 'users:\\(\\("\\K[^"]+' 2>/dev/null | head -1 || echo "")
    pid_str=$(echo "$line" | grep -oP 'pid=\\K[0-9]+' 2>/dev/null | head -1 || echo "0")

    [ "$peer_addr" = "*:*" ] && continue
    [ "$peer_addr" = "0.0.0.0:*" ] && continue

    if [ "$first" = true ]; then first=false; else echo ','; fi
    printf '    {"proto":"%s","state":"%s","local":"%s","peer":"%s","process":"%s","pid":%s}' \\
      "$proto" "$state" "$local_addr" "$peer_addr" "$process" "$pid_str"
  done
  echo ''
  echo '  ]'
}
`;
}

function moduleDocker(o: Required<GatherScriptOptions>): string {
  const inspectBlock = o.dockerDeepScan ? `
      docker inspect "$cid" 2>/dev/null | python3 -c "
import json, sys, re
try:
    data = json.load(sys.stdin)[0]
    env_vars = data.get('Config', {}).get('Env', [])
    masked_env = []
    for e in env_vars:
        if re.search(r'(PASSWORD|SECRET|KEY|TOKEN|PASS|CREDENTIAL|AUTH)=', e, re.IGNORECASE):
            key = e.split('=')[0]
            masked_env.append(f'{key}=***MASKED***')
        else:
            masked_env.append(e)
    networks = {}
    for net_name, net_data in data.get('NetworkSettings', {}).get('Networks', {}).items():
        networks[net_name] = {
            'ip': net_data.get('IPAddress', ''),
            'gateway': net_data.get('Gateway', ''),
            'mac': net_data.get('MacAddress', ''),
            'aliases': net_data.get('Aliases', [])
        }
    ports = {}
    for port_key, mappings in (data.get('NetworkSettings', {}).get('Ports', {}) or {}).items():
        if mappings:
            ports[port_key] = [{'host_ip': m.get('HostIp',''), 'host_port': m.get('HostPort','')} for m in mappings]
        else:
            ports[port_key] = None
    mounts = [{'source': m.get('Source',''), 'destination': m.get('Destination',''), 'mode': m.get('Mode',''), 'rw': m.get('RW', True), 'type': m.get('Type','')} for m in data.get('Mounts', [])]
    health = data.get('State', {}).get('Health', {})
    health_status = health.get('Status', '') if health else ''
    labels = data.get('Config', {}).get('Labels', {})
    restart = data.get('HostConfig', {}).get('RestartPolicy', {}).get('Name', '')
    mem_limit = data.get('HostConfig', {}).get('Memory', 0)
    cpu_shares = data.get('HostConfig', {}).get('CpuShares', 0)
    result = {
        'id': data.get('Id', '')[:12],
        'name': data.get('Name', '').lstrip('/'),
        'image': data.get('Config', {}).get('Image', ''),
        'image_id': data.get('Image', '')[:19],
        'state': data.get('State', {}).get('Status', ''),
        'started_at': data.get('State', {}).get('StartedAt', ''),
        'restart_count': data.get('RestartCount', 0),
        'restart_policy': restart,
        'ports': ports,
        'networks': networks,
        'env_vars': masked_env,
        'mounts': mounts,
        'labels': labels,
        'health': health_status,
        'memory_limit_mb': mem_limit // (1024*1024) if mem_limit else 0,
        'cpu_shares': cpu_shares,
        'cmd': data.get('Config', {}).get('Cmd', []),
        'entrypoint': data.get('Config', {}).get('Entrypoint', [])
    }
    print('    ' + json.dumps(result), end='')
except Exception as e:
    print('    {}', end='')
" 2>/dev/null` : `
      docker ps -a --format '{"id":"{{.ID}}","name":"{{.Names}}","image":"{{.Image}}","state":"{{.Status}}"}' 2>/dev/null | head -1 | \\
        python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('    '+json.dumps(d), end='')" 2>/dev/null`;

  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 13: Docker Deep-Scan
# ═══════════════════════════════════════════════════════════════════════════
gather_docker() {
  echo -n '  "docker_available": '
  if command -v docker &>/dev/null && docker info &>/dev/null; then
    echo 'true,'
    echo -n '  "docker_version": '
    docker version --format '{"client":"{{.Client.Version}}","server":"{{.Server.Version}}"}' 2>/dev/null || echo '{"client":"unknown","server":"unknown"}'
    echo ','

    # Docker-Netzwerke
    echo '  "docker_networks": ['
    local first_net=true
    docker network ls --format '{{.ID}}' 2>/dev/null | while read -r nid; do
      if [ "$first_net" = true ]; then first_net=false; else echo ','; fi
      docker network inspect "$nid" 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)[0]
    obj = {
        'name': data.get('Name', ''),
        'driver': data.get('Driver', ''),
        'scope': data.get('Scope', ''),
        'subnet': '',
        'gateway': ''
    }
    ipam_configs = data.get('IPAM', {}).get('Config', [])
    if ipam_configs:
        obj['subnet'] = ipam_configs[0].get('Subnet', '')
        obj['gateway'] = ipam_configs[0].get('Gateway', '')
    containers = {}
    for cid, cinfo in data.get('Containers', {}).items():
        containers[cinfo.get('Name', cid[:12])] = cinfo.get('IPv4Address', '')
    obj['containers'] = containers
    print('    ' + json.dumps(obj), end='')
except: pass
" 2>/dev/null
    done
    echo ''
    echo '  ],'

    # Docker-Container
    echo '  "docker_containers": ['
    local first_c=true
    docker ps -a --format '{{.ID}}' 2>/dev/null | while read -r cid; do
      if [ "$first_c" = true ]; then first_c=false; else echo ','; fi
${inspectBlock}
    done
    echo ''
    echo '  ]'
  else
    echo 'false,'
    echo '  "docker_version": null,'
    echo '  "docker_networks": [],'
    echo '  "docker_containers": []'
  fi
}
`;
}

function moduleWebserverConfigs(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 14: Webserver-Configs (erweitert)
# ═══════════════════════════════════════════════════════════════════════════
gather_webserver_configs() {
  echo '  "webserver_configs": {'

  # Nginx
  echo -n '    "nginx": '
  if command -v nginx &>/dev/null || [ -d /etc/nginx ]; then
    local nginx_version=$(nginx -v 2>&1 | grep -oP '[\\d.]+' | head -1)
    echo '{'
    echo "      \\"version\\": \\"\${nginx_version:-unknown}\\","
    echo '      "server_blocks": ['
    if command -v python3 &>/dev/null; then
      find /etc/nginx -name '*.conf' -type f 2>/dev/null | head -30 | while read -r f; do
        cat "$f" 2>/dev/null
      done | python3 -c "
import sys, re, json
content = sys.stdin.read()
blocks = []
server_pattern = re.compile(r'server\\s*\\{([^{}]*(?:\\{[^{}]*\\}[^{}]*)*)\\}', re.S)
for match in server_pattern.finditer(content):
    block_content = match.group(1)
    server_names = re.findall(r'server_name\\s+([^;]+);', block_content)
    listens = re.findall(r'listen\\s+([^;]+);', block_content)
    proxy_passes = re.findall(r'proxy_pass\\s+([^;]+);', block_content)
    locations = re.findall(r'location\\s+([^{]+)\\{', block_content)
    ssl = any('ssl' in l for l in listens)
    b = {
        'server_names': [n.strip() for sn in server_names for n in sn.split()],
        'listen': [l.strip() for l in listens],
        'proxy_passes': [p.strip() for p in proxy_passes],
        'locations': [l.strip() for l in locations[:20]],
        'ssl': ssl
    }
    blocks.append(b)
first = True
for b in blocks[:20]:
    if not first: print(',')
    first = False
    print('        ' + json.dumps(b), end='')
if not first: print()
" 2>/dev/null
    fi
    echo '      ],'
    echo '      "upstreams": ['
    grep -rh 'upstream' /etc/nginx/ 2>/dev/null | grep -v '^\\s*#' | head -20 | python3 -c "
import json, sys
lines = [l.strip() for l in sys.stdin if l.strip()]
first = True
for l in lines:
    if not first: print(',')
    first = False
    print('        ' + json.dumps(l), end='')
if not first: print()
" 2>/dev/null
    echo '      ]'
    echo '    },'
  else
    echo 'null,'
  fi

  # Apache
  echo -n '    "apache": '
  if command -v apache2 &>/dev/null || command -v httpd &>/dev/null || [ -d /etc/apache2 ] || [ -d /etc/httpd ]; then
    local apache_dir="/etc/apache2"
    [ -d /etc/httpd ] && apache_dir="/etc/httpd"
    local apache_version=$(apache2 -v 2>/dev/null | head -1 || httpd -v 2>/dev/null | head -1 || echo "unknown")
    echo '{'
    echo "      \\"version\\": $(echo \\"$apache_version\\" | json_escape),"
    echo '      "vhosts": ['
    find "$apache_dir" -name '*.conf' -type f 2>/dev/null | head -20 | while read -r f; do
      cat "$f" 2>/dev/null
    done | python3 -c "
import sys, re, json
content = sys.stdin.read()
vhosts = []
vhost_pattern = re.compile(r'<VirtualHost\\s+([^>]+)>(.+?)</VirtualHost>', re.S | re.I)
for match in vhost_pattern.finditer(content):
    addr = match.group(1).strip()
    block = match.group(2)
    server_names = re.findall(r'ServerName\\s+(.+)', block)
    aliases = re.findall(r'ServerAlias\\s+(.+)', block)
    proxy = re.findall(r'ProxyPass[Reverse]*\\s+(.+)', block)
    doc_root = re.findall(r'DocumentRoot\\s+(.+)', block)
    vhosts.append({
        'address': addr,
        'server_name': server_names[0].strip() if server_names else '',
        'aliases': [a.strip() for a in aliases],
        'proxy': [p.strip() for p in proxy],
        'document_root': doc_root[0].strip().strip('\\\"') if doc_root else ''
    })
first = True
for v in vhosts[:20]:
    if not first: print(',')
    first = False
    print('        ' + json.dumps(v), end='')
if not first: print()
" 2>/dev/null
    echo '      ]'
    echo '    },'
  else
    echo 'null,'
  fi

  # HAProxy
  echo -n '    "haproxy": '
  if command -v haproxy &>/dev/null || [ -f /etc/haproxy/haproxy.cfg ]; then
    echo '{'
    echo -n '      "backends": '
    python3 -c "
import re, json
try:
    with open('/etc/haproxy/haproxy.cfg') as f:
        content = f.read()
    backends = []
    current = None
    for line in content.splitlines():
        line = line.strip()
        m = re.match(r'(backend|frontend|listen)\\s+(\\S+)', line)
        if m:
            if current: backends.append(current)
            current = {'type': m.group(1), 'name': m.group(2), 'servers': [], 'bind': ''}
        elif current:
            sm = re.match(r'server\\s+(\\S+)\\s+(\\S+)', line)
            if sm:
                current['servers'].append({'name': sm.group(1), 'address': sm.group(2)})
            bm = re.match(r'bind\\s+(\\S+)', line)
            if bm:
                current['bind'] = bm.group(1)
    if current: backends.append(current)
    print(json.dumps(backends[:20]))
except: print('[]')
" 2>/dev/null
    echo '    },'
  else
    echo 'null,'
  fi

  # Caddy
  echo -n '    "caddy": '
  if command -v caddy &>/dev/null || [ -f /etc/caddy/Caddyfile ]; then
    echo -n '{"config": '
    cat /etc/caddy/Caddyfile 2>/dev/null | head -100 | json_escape
    echo '}'
  else
    echo 'null'
  fi

  echo '  }'
}
`;
}

function moduleSystemd(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 15: Systemd-Units (detailliert)
# ═══════════════════════════════════════════════════════════════════════════
gather_systemd() {
  echo '  "systemd_units": ['
  if command -v systemctl &>/dev/null && command -v python3 &>/dev/null; then
    python3 -c "
import subprocess, json

result = subprocess.run(
    ['systemctl', 'list-units', '--type=service', '--all', '--no-legend', '--no-pager'],
    capture_output=True, text=True, timeout=10
)
units = []
for line in result.stdout.strip().splitlines():
    parts = line.split()
    if len(parts) >= 4:
        name = parts[0]
        active = parts[2]
        sub = parts[3]
        desc = ' '.join(parts[4:]) if len(parts) > 4 else ''
        units.append({
            'name': name,
            'active_state': active,
            'sub_state': sub,
            'description': desc
        })

for u in units:
    if u['active_state'] != 'active':
        continue
    try:
        show = subprocess.run(
            ['systemctl', 'show', u['name'],
             '--property=MainPID,ExecStart,MemoryCurrent,CPUUsageNSec,UnitFileState'],
            capture_output=True, text=True, timeout=5
        )
        props = {}
        for line in show.stdout.strip().splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                props[k] = v
        u['main_pid'] = int(props.get('MainPID', 0))
        u['exec_start'] = props.get('ExecStart', '')[:200]
        mem = props.get('MemoryCurrent', '')
        if mem and mem != '[not set]':
            try: u['memory_mb'] = round(int(mem) / (1024*1024), 1)
            except: pass
        cpu = props.get('CPUUsageNSec', '')
        if cpu and cpu != '[not set]':
            try: u['cpu_usage_sec'] = round(int(cpu) / 1e9, 2)
            except: pass
        u['enabled'] = props.get('UnitFileState', '') == 'enabled'
    except: pass

first = True
for u in units:
    if not first: print(',')
    first = False
    print('    ' + json.dumps(u), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleCron(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 16: Cron-Jobs
# ═══════════════════════════════════════════════════════════════════════════
gather_cron() {
  echo '  "cron_jobs": ['
  if command -v python3 &>/dev/null; then
    python3 -c "
import os, json, subprocess, glob

cron_jobs = []

# User-Crontabs
crontab_dirs = ['/var/spool/cron/crontabs', '/var/spool/cron']
for d in crontab_dirs:
    if not os.path.isdir(d):
        continue
    for fname in os.listdir(d):
        fpath = os.path.join(d, fname)
        if not os.path.isfile(fpath):
            continue
        try:
            with open(fpath) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' in line.split()[0] if line.split() else True:
                        continue
                    parts = line.split(None, 5)
                    if len(parts) >= 6:
                        cron_jobs.append({
                            'user': fname,
                            'schedule': ' '.join(parts[:5]),
                            'command': parts[5],
                            'source': 'crontab'
                        })
        except: pass

# /etc/cron.d/
cron_d = '/etc/cron.d'
if os.path.isdir(cron_d):
    for fname in os.listdir(cron_d):
        fpath = os.path.join(cron_d, fname)
        if not os.path.isfile(fpath):
            continue
        try:
            with open(fpath) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    parts = line.split(None, 6)
                    if len(parts) >= 7:
                        cron_jobs.append({
                            'user': parts[5],
                            'schedule': ' '.join(parts[:5]),
                            'command': parts[6],
                            'source': fname
                        })
        except: pass

# Systemd Timers
try:
    result = subprocess.run(
        ['systemctl', 'list-timers', '--all', '--no-pager', '--no-legend'],
        capture_output=True, text=True, timeout=5
    )
    for line in result.stdout.strip().splitlines():
        parts = line.split()
        if parts:
            timer_name = parts[-1] if parts else ''
            if timer_name:
                cron_jobs.append({
                    'user': 'root',
                    'schedule': 'systemd-timer',
                    'command': timer_name,
                    'source': 'systemd-timer'
                })
except: pass

first = True
for j in cron_jobs:
    if not first: print(',')
    first = False
    print('    ' + json.dumps(j), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleSSLCerts(o: Required<GatherScriptOptions>): string {
  if (!o.sslScan) {
    return `
gather_ssl_certs() {
  echo '  "ssl_certificates": []'
}
`;
  }

  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 17: SSL-Zertifikate
# ═══════════════════════════════════════════════════════════════════════════
gather_ssl_certs() {
  echo '  "ssl_certificates": ['
  if command -v openssl &>/dev/null && command -v python3 &>/dev/null; then
    find /etc/ssl/certs /etc/pki/tls/certs /etc/letsencrypt/live /etc/nginx/ssl /etc/apache2/ssl /etc/httpd/ssl \\
      -name '*.pem' -o -name '*.crt' -o -name '*.cert' 2>/dev/null | head -50 | \\
    python3 -c "
import subprocess, json, sys, re
from datetime import datetime as dt

cert_files = [l.strip() for l in sys.stdin if l.strip()]
first = True
for cf in cert_files:
    try:
        result = subprocess.run(
            ['openssl', 'x509', '-in', cf, '-noout',
             '-subject', '-issuer', '-dates', '-serial', '-ext', 'subjectAltName'],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode != 0:
            continue
        out = result.stdout
        subject = issuer = not_before = not_after = serial = ''
        san = []
        for line in out.splitlines():
            line = line.strip()
            if line.startswith('subject='): subject = line.split('=', 1)[1].strip()
            elif line.startswith('issuer='): issuer = line.split('=', 1)[1].strip()
            elif line.startswith('notBefore='): not_before = line.split('=', 1)[1].strip()
            elif line.startswith('notAfter='): not_after = line.split('=', 1)[1].strip()
            elif line.startswith('serial='): serial = line.split('=', 1)[1].strip()
            elif 'DNS:' in line: san = re.findall(r'DNS:(\\S+?)(?:,|$)', line)
        days_left = -1
        is_expired = False
        try:
            exp = dt.strptime(not_after, '%b %d %H:%M:%S %Y %Z')
            days_left = (exp - dt.utcnow()).days
            is_expired = days_left < 0
        except: pass
        cert = {
            'path': cf, 'subject': subject, 'issuer': issuer,
            'valid_from': not_before, 'valid_to': not_after, 'serial': serial,
            'san_domains': san, 'days_left': days_left, 'is_expired': is_expired
        }
        if not first: print(',')
        first = False
        print('    ' + json.dumps(cert), end='')
    except: continue
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleUsers(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 18: Benutzer-Accounts
# ═══════════════════════════════════════════════════════════════════════════
gather_users() {
  echo '  "user_accounts": ['
  if command -v python3 &>/dev/null; then
    python3 -c "
import json, subprocess

users = []
no_login = ['/sbin/nologin', '/usr/sbin/nologin', '/bin/false', '/usr/bin/false']
with open('/etc/passwd') as f:
    for line in f:
        parts = line.strip().split(':')
        if len(parts) < 7: continue
        username, uid, gid, home, shell = parts[0], int(parts[2]), int(parts[3]), parts[5], parts[6]
        has_login = shell not in no_login
        if uid >= 1000 or uid == 0 or has_login:
            groups = []
            try:
                result = subprocess.run(['groups', username], capture_output=True, text=True, timeout=3)
                if result.returncode == 0:
                    groups = result.stdout.strip().split(':')[-1].strip().split()
            except: pass
            last_login = ''
            try:
                result = subprocess.run(['lastlog', '-u', username], capture_output=True, text=True, timeout=3)
                lines = result.stdout.strip().splitlines()
                if len(lines) > 1 and '**Never' not in lines[1]:
                    last_login = ' '.join(lines[1].split()[3:])
            except: pass
            users.append({
                'username': username, 'uid': uid, 'gid': gid,
                'shell': shell, 'home_dir': home, 'groups': groups,
                'has_login': has_login, 'last_login': last_login
            })

first = True
for u in users:
    if not first: print(',')
    first = False
    print('    ' + json.dumps(u), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleFirewall(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 19: Firewall-Regeln
# ═══════════════════════════════════════════════════════════════════════════
gather_firewall() {
  echo '  "firewall": {'

  echo -n '    "iptables": '
  if command -v iptables &>/dev/null; then
    echo '['
    local first_fw=true
    iptables -L -n --line-numbers 2>/dev/null | while IFS= read -r line; do
      if [ "$first_fw" = true ]; then first_fw=false; else echo ','; fi
      printf '    %s' "$(echo "$line" | json_escape)"
    done
    echo ''
    echo '    ],'
  else
    echo 'null,'
  fi

  echo -n '    "ufw_status": '
  if command -v ufw &>/dev/null; then
    ufw status verbose 2>/dev/null | json_escape
  else
    echo 'null'
  fi
  echo ','

  echo -n '    "nftables": '
  if command -v nft &>/dev/null; then
    nft list ruleset 2>/dev/null | head -100 | json_escape
  else
    echo 'null'
  fi

  echo '  }'
}
`;
}

function modulePackages(o: Required<GatherScriptOptions>): string {
  if (!o.collectPackages) {
    return `
gather_packages() {
  echo '  "installed_packages": []'
}
`;
  }

  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 20: Installierte Pakete
# ═══════════════════════════════════════════════════════════════════════════
gather_packages() {
  echo '  "installed_packages": ['
  if command -v dpkg &>/dev/null && command -v python3 &>/dev/null; then
    dpkg-query -W -f '\${Package}\\t\${Version}\\t\${Status}\\n' 2>/dev/null | \\
      grep 'install ok installed' | head -500 | python3 -c "
import sys, json
first = True
for line in sys.stdin:
    parts = line.strip().split('\\t')
    if len(parts) >= 2:
        if not first: print(',')
        first = False
        print('    ' + json.dumps({'name': parts[0], 'version': parts[1], 'manager': 'dpkg'}), end='')
if not first: print()
" 2>/dev/null
  elif command -v rpm &>/dev/null && command -v python3 &>/dev/null; then
    rpm -qa --queryformat '%{NAME}\\t%{VERSION}-%{RELEASE}\\n' 2>/dev/null | head -500 | python3 -c "
import sys, json
first = True
for line in sys.stdin:
    parts = line.strip().split('\\t')
    if len(parts) >= 2:
        if not first: print(',')
        first = False
        print('    ' + json.dumps({'name': parts[0], 'version': parts[1], 'manager': 'rpm'}), end='')
if not first: print()
" 2>/dev/null
  fi
  echo '  ]'
}
`;
}

function moduleKernel(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 21: Kernel-Module & Sysctl
# ═══════════════════════════════════════════════════════════════════════════
gather_kernel() {
  echo '  "kernel": {'
  echo -n '    "modules_loaded": '
  lsmod 2>/dev/null | tail -n +2 | wc -l | tr -d ' '
  echo ','
  echo '    "notable_modules": ['
  local first_km=true
  lsmod 2>/dev/null | tail -n +2 | awk '{print $1}' | \\
    grep -iE 'kvm|vhost|br_netfilter|overlay|ip_tables|nf_|bonding|bridge|vlan|wireguard|openvpn|zfs|btrfs|dm_|raid|nvme|drbd' | \\
    while read -r mod; do
      if [ "$first_km" = true ]; then first_km=false; else echo ','; fi
      printf '      "%s"' "$mod"
    done
  echo ''
  echo '    ],'
  echo '    "sysctl_highlights": {'
  echo "      \\"ip_forward\\": $(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo 0),"
  echo "      \\"tcp_syncookies\\": $(sysctl -n net.ipv4.tcp_syncookies 2>/dev/null || echo 0),"
  echo "      \\"somaxconn\\": $(sysctl -n net.core.somaxconn 2>/dev/null || echo 128),"
  echo "      \\"file_max\\": $(sysctl -n fs.file-max 2>/dev/null || echo 0),"
  echo "      \\"vm_swappiness\\": $(sysctl -n vm.swappiness 2>/dev/null || echo 60),"
  echo "      \\"vm_overcommit\\": $(sysctl -n vm.overcommit_memory 2>/dev/null || echo 0)"
  echo '    }'
  echo '  }'
}
`;
}

function moduleSecurity(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 22: Sicherheits-Status
# ═══════════════════════════════════════════════════════════════════════════
gather_security() {
  echo '  "security": {'
  echo -n '    "selinux": '
  if command -v getenforce &>/dev/null; then
    printf '"%s"' "$(getenforce 2>/dev/null)"
  else
    echo '"not_installed"'
  fi
  echo ','

  echo -n '    "apparmor": '
  if command -v aa-status &>/dev/null; then
    local aa_profiles=$(aa-status --profiled 2>/dev/null || echo 0)
    local aa_enforced=$(aa-status --enforced 2>/dev/null || echo 0)
    printf '{"profiles":%s,"enforced":%s}' "$aa_profiles" "$aa_enforced"
  elif [ -d /sys/kernel/security/apparmor ]; then
    echo '{"status":"loaded"}'
  else
    echo '"not_installed"'
  fi
  echo ','

  echo '    "sshd_config": {'
  local permit_root=$(grep -i '^PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
  local pw_auth=$(grep -i '^PasswordAuthentication' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
  local ssh_port=$(grep -i '^Port' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
  echo "      \\"permit_root_login\\": \\"\${permit_root:-not_set}\\","
  echo "      \\"password_auth\\": \\"\${pw_auth:-not_set}\\","
  echo "      \\"port\\": \\"\${ssh_port:-22}\\""
  echo '    },'

  echo -n '    "fail2ban": '
  if command -v fail2ban-client &>/dev/null; then
    local jails=$(fail2ban-client status 2>/dev/null | grep 'Jail list' | sed 's/.*:\\s*//')
    printf '{"active":true,"jails":%s}' "$(echo "$jails" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip().split(', ')))" 2>/dev/null || echo '[]')"
  else
    echo '{"active":false}'
  fi

  echo '  }'
}
`;
}

function moduleLogs(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Modul 23: Fehler-Logs (letzte 24h)
# ═══════════════════════════════════════════════════════════════════════════
gather_logs() {
  echo '  "logs": {'

  # ─── 1. Systemd Journal Errors (Priorität 0-3: emerg, alert, crit, err) ───
  echo -n '    "journald_errors": '
  if command -v journalctl &>/dev/null; then
    journalctl -p 3 -S "1 day ago" --no-pager -o short-iso 2>/dev/null | tail -n 300 | json_escape
  else
    echo '""'
  fi
  echo ','

  # ─── 2. Kernel-Fehler (dmesg) ─────────────────────────────────────────
  echo -n '    "dmesg_errors": '
  if command -v dmesg &>/dev/null; then
    dmesg -T -l err,crit,alert,emerg 2>/dev/null | tail -n 200 | json_escape
  else
    echo '""'
  fi
  echo ','

  # ─── 3. Anwendungs-Logs (dynamische Suche) ────────────────────────────
  echo '    "app_logs": {'

  local first_app=true

  # Definierte Pfade
  local log_paths=(
    "/var/log/nginx/error.log"
    "/var/log/apache2/error.log"
    "/var/log/httpd/error_log"
    "/var/log/mysql/error.log"
    "/var/log/mariadb/mariadb.log"
    "/var/log/postgresql/postgresql-*-main.log"
    "/var/log/redis/redis-server.log"
    "/var/log/mongodb/mongod.log"
    "/var/log/samba/log.smbd"
    "/var/log/mail.err"
    "/var/log/fail2ban.log"
    "/var/log/haproxy.log"
    "/var/log/docker.log"
    "/var/log/unattended-upgrades/unattended-upgrades.log"
  )

  for log_pattern in "\${log_paths[@]}"; do
    # Glob auflösen (für postgresql-*-main.log etc.)
    for logfile in $log_pattern; do
      if [ -f "$logfile" ] && [ -r "$logfile" ]; then
        local basename_log=$(basename "$logfile")
        local safe_key=$(echo "$basename_log" | sed 's/[^a-zA-Z0-9_.-]/_/g')

        if [ "$first_app" = true ]; then
          first_app=false
        else
          echo ','
        fi

        echo -n "      \\"$safe_key\\": "
        tail -n 200 "$logfile" 2>/dev/null | json_escape
      fi
    done
  done

  # Auch in /var/log/ nach weiteren error.log Dateien suchen
  while IFS= read -r logfile; do
    if [ -f "$logfile" ] && [ -r "$logfile" ]; then
      local basename_log=$(basename "$logfile")
      local dirname_log=$(basename "$(dirname "$logfile")")
      local safe_key=$(echo "\${dirname_log}_\${basename_log}" | sed 's/[^a-zA-Z0-9_.-]/_/g')

      # Duplikate vermeiden
      local skip=false
      for known in "\${log_paths[@]}"; do
        for kf in $known; do
          [ "$logfile" = "$kf" ] && skip=true && break 2
        done
      done
      [ "$skip" = true ] && continue

      if [ "$first_app" = true ]; then
        first_app=false
      else
        echo ','
      fi

      echo -n "      \\"$safe_key\\": "
      tail -n 200 "$logfile" 2>/dev/null | json_escape
    fi
  done < <(find /var/log -maxdepth 3 -name "error*.log" -o -name "*.err" 2>/dev/null | head -10)

  echo ''
  echo '    },'

  # ─── 4. Syslog-Errors (letzte 24h) ────────────────────────────────────
  echo -n '    "syslog_errors": '
  if [ -f /var/log/syslog ]; then
    local yesterday=$(date -d "1 day ago" +"%b %e" 2>/dev/null || date -d "yesterday" +"%b %e" 2>/dev/null || echo "")
    if [ -n "$yesterday" ]; then
      grep -iE "error|critical|alert|emergency|fail" /var/log/syslog 2>/dev/null | tail -n 200 | json_escape
    else
      tail -n 300 /var/log/syslog 2>/dev/null | grep -iE "error|critical|alert|emergency|fail" | tail -n 200 | json_escape
    fi
  elif [ -f /var/log/messages ]; then
    grep -iE "error|critical|alert|emergency|fail" /var/log/messages 2>/dev/null | tail -n 200 | json_escape
  else
    echo '""'
  fi
  echo ','

  # ─── 5. Auth / Security Log ───────────────────────────────────────────
  echo -n '    "auth_errors": '
  if [ -f /var/log/auth.log ]; then
    grep -iE "fail|error|invalid|denied|refused" /var/log/auth.log 2>/dev/null | tail -n 100 | json_escape
  elif [ -f /var/log/secure ]; then
    grep -iE "fail|error|invalid|denied|refused" /var/log/secure 2>/dev/null | tail -n 100 | json_escape
  else
    echo '""'
  fi
  echo ','

  # ─── 6. OOM-Killer Events ─────────────────────────────────────────────
  echo -n '    "oom_events": '
  dmesg 2>/dev/null | grep -i "out of memory\\|oom-killer\\|killed process" | tail -n 20 | json_escape

  echo '  }'
}
`;
}

function mainProgram(): string {
  return `
# ═══════════════════════════════════════════════════════════════════════════
# Hauptprogramm: JSON zusammenbauen
# ═══════════════════════════════════════════════════════════════════════════
echo '{'

echo "  \\"_meta\\": {"
echo "    \\"version\\": \\"2.0\\","
echo "    \\"collected_at\\": \\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\","
echo "    \\"collector_host\\": \\"$(hostname)\\","
echo "    \\"duration_start\\": $(date +%s%N | cut -b1-13)"
echo "  },"

run_collector "os" "gather_os"
echo ','
run_collector "disks" "gather_disks"
echo ','
run_collector "lvm" "gather_lvm"
echo ','
run_collector "raid" "gather_raid"
echo ','
run_collector "mounts" "gather_mounts"
echo ','
run_collector "interfaces" "gather_interfaces"
echo ','
run_collector "routing" "gather_routing"
echo ','
run_collector "hosts" "gather_hosts"
echo ','
run_collector "arp" "gather_arp"
echo ','
run_collector "processes" "gather_processes"
echo ','
run_collector "listeners" "gather_listeners"
echo ','
run_collector "sockets" "gather_sockets"
echo ','
run_collector "docker" "gather_docker"
echo ','
run_collector "webserver" "gather_webserver_configs"
echo ','
run_collector "systemd" "gather_systemd"
echo ','
run_collector "cron" "gather_cron"
echo ','
run_collector "ssl" "gather_ssl_certs"
echo ','
run_collector "users" "gather_users"
echo ','
run_collector "firewall" "gather_firewall"
echo ','
run_collector "packages" "gather_packages"
echo ','
run_collector "kernel" "gather_kernel"
echo ','
run_collector "security" "gather_security"
echo ','
run_collector "logs" "gather_logs"

echo ","
echo "  \\"_meta_end\\": {"
echo "    \\"duration_end\\": $(date +%s%N | cut -b1-13)"
echo "  }"

echo '}'
`;
}
