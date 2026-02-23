// ─── Config-Discovery Gather Script ──────────────────────────────────────
// Phase 5.5: Generiert ein Bash-Skript das Config-Dateien aller
// Nicht-System-Prozesse erkennt und deren Inhalte als Base64 zurückgibt.
//
// Portiert aus ansatz2/gconf.sh – vereinfacht für SystemMAP-Integration.
// Methoden: M1 (cmdline), M3/M4 (lsof/fd), M5 (pkg), M6 (/etc/*),
//           M7 (Standard-Locations), M8 (systemd), M11 (includes)
//
// Output: JSON mit { configs: { [process]: { files: [...], executable, pid } } }

export function generateConfigGatherScript(): string {
  return `#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# SystemMAP Config-Discovery – Phase 5.5
# Sammelt Config-Dateien aller aktiven Nicht-System-Prozesse
# Gibt JSON auf stdout aus: { configs: { processName: { ... } } }
# ═══════════════════════════════════════════════════════════════════════════
set -o pipefail
export LC_ALL=C

MAX_FILE_SIZE=262144  # 256KB max pro Datei
MAX_FILES_PER_PROC=30 # Max Config-Dateien pro Prozess
MAX_TOTAL_FILES=200   # Max Gesamt

# ─── Hilfsfunktionen ──────────────────────────────────────────────────────

json_escape_b64() {
  # Gibt Base64 einer Datei aus (URL-safe)
  base64 -w0 "$1" 2>/dev/null || echo ""
}

json_escape() {
  if command -v python3 &>/dev/null; then
    python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null
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

# ─── System-Prozess-Filter ────────────────────────────────────────────────
# NUR echte Kernel-Threads und systemd-Infrastruktur (NICHT Userspace-Daemons!)

KERNEL_NAMES="kthreadd|kworker|ksoftirqd|migration|rcu_gp|rcu_par_gp|rcu_preempt|\
rcu_sched|rcu_bh|cpuhp|khugepaged|kswapd|kblockd|kcompactd|kdevtmpfs|\
ata_sff|edac-poller|blkcg_punt_bio|devfreq_wq|jbd2|kauditd|khungtaskd|\
kintegrityd|ksmd|kstrp|kthrotld|ext4-rsv-conver|cryptd|ipv6_addrconf|\
acpi_thermal_pm|oom_reaper|inet_frag_wq|mm_percpu_wq|netns|mld|psimon|\
writeback|flush-|scsi_eh|scsi_tmf|ttm_swap|zswap-shrink|tpm_dev_wq|\
irq_|card0-crtc|slub_flushwq|watchdogd|kcompactd0|kswapd0"

# Prozesse die KEINE Config-Dateien haben und übersprungen werden
SKIP_NAMES="agetty|login|\\(sd-pam\\)|getty|sulogin|init"

# Name-Aliase: Prozessname → tatsächlicher Config-Verzeichnisname
# z.B. postgres → postgresql, sshd → ssh
declare -A CONFIG_ALIASES
CONFIG_ALIASES[postgres]="postgresql"
CONFIG_ALIASES[mysqld]="mysql"
CONFIG_ALIASES[mariadbd]="mariadb mysql"
CONFIG_ALIASES[sshd]="ssh"
CONFIG_ALIASES[named]="bind bind9"
CONFIG_ALIASES[smbd]="samba"
CONFIG_ALIASES[nmbd]="samba"
CONFIG_ALIASES[cupsd]="cups"
CONFIG_ALIASES[ntpd]="ntp"
CONFIG_ALIASES[redis-server]="redis"
CONFIG_ALIASES[mongod]="mongodb"
CONFIG_ALIASES[chronyd]="chrony"
CONFIG_ALIASES[unbound]="unbound"
CONFIG_ALIASES[pihole-FTL]="pihole"
CONFIG_ALIASES[influxd]="influxdb"
CONFIG_ALIASES[grafana-server]="grafana"
CONFIG_ALIASES[mosquitto]="mosquitto"
CONFIG_ALIASES[node-red]="nodered node-red"
CONFIG_ALIASES[haproxy]="haproxy"
CONFIG_ALIASES[squid]="squid"

is_system() {
  local name="\$1"
  local exe="\$2"
  
  # Kernel-Threads: kein Executable
  [[ -z "\$exe" ]] && return 0
  
  # Kernel-Threads
  if echo "\$name" | grep -qE "^(\$KERNEL_NAMES)"; then
    return 0
  fi
  
  # Unwichtige Prozesse ohne Configs
  if echo "\$name" | grep -qE "^(\$SKIP_NAMES)\$"; then
    return 0
  fi
  
  return 1
}

# ─── Config-Pfade finden (Methoden M1, M3/M4, M5, M6, M7, M8) ───────────

find_configs() {
  local pid="\$1"
  local name="\$2"
  local exe="\$3"
  local configs=""
  
  # M1: /proc/PID/cmdline – Config-Pfade aus Argumenten
  if [[ -r /proc/\$pid/cmdline ]]; then
    local args
    args=$(tr '\\0' '\\n' < /proc/\$pid/cmdline 2>/dev/null || true)
    while read -r arg; do
      [[ -z "\$arg" ]] && continue
      # Suche nach Dateipfaden (beginnt mit / und hat Config-Endung)
      if [[ "\$arg" =~ ^/.*\\.(conf|cfg|ini|yml|yaml|toml|json|cnf|cf|properties|xml|env)$ ]]; then
        [[ -f "\$arg" && -r "\$arg" ]] && configs+="\$arg"$'\\n'
      fi
      # -c /path oder --config /path oder --config=/path
      if [[ "\$arg" =~ ^--?[a-zA-Z]*[Cc]onfig[=:](.+)$ ]]; then
        local p="\${BASH_REMATCH[1]}"
        [[ -f "\$p" && -r "\$p" ]] && configs+="\$p"$'\\n'
      fi
    done <<< "\$args"
  fi
  
  # M3/M4: lsof oder /proc/PID/fd – offene Config-Dateien
  if command -v lsof &>/dev/null; then
    local lsof_out
    lsof_out=$(lsof -p "\$pid" 2>/dev/null | awk '\$4~/^[0-9]+r/ && \$NF~/\\.(conf|cfg|ini|yml|yaml|toml|json|cnf|xml|properties)$/ {print \$NF}' || true)
    [[ -n "\$lsof_out" ]] && configs+="\$lsof_out"$'\\n'
  else
    # M4 Fallback: /proc/PID/fd
    if [[ -d /proc/\$pid/fd ]]; then
      for fd in /proc/\$pid/fd/*; do
        local target
        target=$(readlink -f "\$fd" 2>/dev/null || true)
        if [[ -n "\$target" && "\$target" =~ \\.(conf|cfg|ini|yml|yaml|toml|json|cnf|xml|properties)$ ]]; then
          [[ -f "\$target" && -r "\$target" ]] && configs+="\$target"$'\\n'
        fi
      done
    fi
  fi
  
  # M5: Paketmanager – Configs des Pakets
  if [[ -n "\$exe" && -x "\$exe" ]]; then
    local pkg=""
    if command -v dpkg &>/dev/null; then
      pkg=$(dpkg -S "\$exe" 2>/dev/null | head -1 | cut -d: -f1)
      if [[ -n "\$pkg" ]]; then
        local pkgfiles
        pkgfiles=$(dpkg -L "\$pkg" 2>/dev/null | grep -E '^/(etc|usr/local/etc)/' | head -20)
        while read -r f; do
          [[ -f "\$f" && -r "\$f" ]] && configs+="\$f"$'\\n'
        done <<< "\$pkgfiles"
        
        # Falls keine /etc/-Dateien: verwandte Pakete prüfen (z.B. postgresql-common)
        if [[ -z "\$pkgfiles" || "\$pkgfiles" == "" ]]; then
          local base_pkg="\${pkg%%-[0-9]*}"  # postgresql-16 → postgresql
          if [[ "\$base_pkg" != "\$pkg" ]]; then
            # Suche nach <base>-common oder <base>-server
            for suffix in common server; do
              local rel_pkg="\${base_pkg}-\${suffix}"
              local rel_files
              rel_files=$(dpkg -L "\$rel_pkg" 2>/dev/null | grep -E '^/(etc|usr/local/etc)/' | head -20)
              while read -r f; do
                [[ -f "\$f" && -r "\$f" ]] && configs+="\$f"$'\\n'
              done <<< "\$rel_files"
            done
          fi
        fi
      fi
    elif command -v rpm &>/dev/null; then
      pkg=$(rpm -qf "\$exe" 2>/dev/null)
      if [[ -n "\$pkg" && "\$pkg" != *"not owned"* ]]; then
        local pkgfiles
        pkgfiles=$(rpm -qc "\$pkg" 2>/dev/null | head -20)
        while read -r f; do
          [[ -f "\$f" && -r "\$f" ]] && configs+="\$f"$'\\n'
        done <<< "\$pkgfiles"
      fi
    fi
  fi
  
  # M6: /etc/<processname>* Namensbasiert
  local ename="\${name%%:*}"  # Doppelpunkt entfernen (z.B. postgres:main)
  ename="\${ename%%.*}"       # Punkt entfernen
  
  # Alle zu prüfenden Namen sammeln (Originalname + Aliase)
  local all_names="\$ename"
  local alias_val="\${CONFIG_ALIASES[\$ename]:-}"
  if [[ -n "\$alias_val" ]]; then
    all_names="\$ename \$alias_val"
  fi
  
  for check_name in \$all_names; do
    for loc in /etc/"\$check_name" /etc/"\$check_name".conf /etc/"\$check_name".cfg /etc/default/"\$check_name"; do
      if [[ -f "\$loc" && -r "\$loc" ]]; then
        configs+="\$loc"$'\\n'
      elif [[ -d "\$loc" ]]; then
        local found
        found=$(find "\$loc" -maxdepth 2 -type f -size -256k \\( -name '*.conf' -o -name '*.cfg' -o -name '*.ini' -o -name '*.yml' -o -name '*.yaml' -o -name '*.toml' -o -name '*.json' -o -name '*.cnf' -o -name '*.xml' -o -name '*.env' \\) 2>/dev/null | head -20)
        [[ -n "\$found" ]] && configs+="\$found"$'\\n'
      fi
    done
  done
  
  # M7: Standard-Locations
  for loc in /usr/local/etc/"\$ename" /opt/*/etc/"\$ename"*; do
    if [[ -f "\$loc" && -r "\$loc" ]]; then
      configs+="\$loc"$'\\n'
    elif [[ -d "\$loc" ]]; then
      local found
      found=$(find "\$loc" -maxdepth 2 -type f -size -256k \\( -name '*.conf' -o -name '*.cfg' -o -name '*.ini' -o -name '*.yml' -o -name '*.yaml' \\) 2>/dev/null | head -10)
      [[ -n "\$found" ]] && configs+="\$found"$'\\n'
    fi
  done
  
  # M8: systemd Unit-Files (Originalname + Aliase)
  if command -v systemctl &>/dev/null; then
    for svc_name in \$all_names; do
      local unit_file
      unit_file=$(systemctl show "\$svc_name" --property=FragmentPath --value 2>/dev/null || true)
      [[ -f "\$unit_file" && -r "\$unit_file" ]] && configs+="\$unit_file"$'\\n'
      
      local env_file
      env_file=$(systemctl show "\$svc_name" --property=EnvironmentFiles --value 2>/dev/null | tr ' ' '\\n' | grep '^/' || true)
      while read -r f; do
        [[ -f "\$f" && -r "\$f" ]] && configs+="\$f"$'\\n'
      done <<< "\$env_file"
    done
  fi
  
  # Deduplizieren und filtern
  echo "\$configs" | sort -u | grep -v '^$' | head -\$MAX_FILES_PER_PROC
}

# ─── Hauptprogramm ────────────────────────────────────────────────────────

echo '{'
echo '  "configs": {'

FIRST_PROC=true
TOTAL_FILES=0

# Alle aktiven PIDs durchgehen
while read -r pid exe name; do
  [[ -z "\$pid" || -z "\$name" ]] && continue
  
  # System-Prozesse überspringen
  is_system "\$name" "\$exe" && continue
  
  # Config-Dateien finden
  local_configs=$(find_configs "\$pid" "\$name" "\$exe")
  [[ -z "\$local_configs" ]] && continue
  
  # Configs als JSON ausgeben
  if [[ "\$FIRST_PROC" == "true" ]]; then
    FIRST_PROC=false
  else
    echo ','
  fi
  
  echo -n "    $(echo "\$name" | json_escape): {"
  echo ""
  echo "      \\"pid\\": \$pid,"
  echo "      \\"executable\\": $(echo "\$exe" | json_escape),"
  echo "      \\"files\\": ["
  
  FILE_FIRST=true
  FILE_COUNT=0
  while read -r cfg_path; do
    [[ -z "\$cfg_path" ]] && continue
    [[ \$TOTAL_FILES -ge \$MAX_TOTAL_FILES ]] && break
    [[ \$FILE_COUNT -ge \$MAX_FILES_PER_PROC ]] && break
    
    # Dateigröße prüfen
    local fsize
    fsize=$(stat -c%s "\$cfg_path" 2>/dev/null || echo 0)
    [[ \$fsize -gt \$MAX_FILE_SIZE || \$fsize -eq 0 ]] && continue
    
    if [[ "\$FILE_FIRST" == "true" ]]; then
      FILE_FIRST=false
    else
      echo ','
    fi
    
    local b64content
    b64content=$(json_escape_b64 "\$cfg_path")
    
    echo -n "        {"
    echo -n "\\"path\\": $(echo "\$cfg_path" | json_escape)"
    echo -n ", \\"size\\": \$fsize"
    echo -n ", \\"content_b64\\": \\"\$b64content\\""
    echo -n "}"
    
    FILE_COUNT=$((FILE_COUNT + 1))
    TOTAL_FILES=$((TOTAL_FILES + 1))
  done <<< "\$local_configs"
  
  echo ""
  echo "      ]"
  echo -n "    }"
  
done < <(
  # Liste: PID EXECUTABLE NAME
  # Benutze /proc/*/exe + /proc/*/comm
  for p in /proc/[0-9]*/exe; do
    local_pid=\${p#/proc/}
    local_pid=\${local_pid%%/*}
    local_exe=$(readlink -f "\$p" 2>/dev/null || echo "")
    local_name=$(cat /proc/\$local_pid/comm 2>/dev/null || echo "")
    [[ -n "\$local_name" ]] && echo "\$local_pid \$local_exe \$local_name"
  done 2>/dev/null | sort -t' ' -k3 -u  # Deduplizieren nach Name
)

echo ""
echo '  },'
echo "  \\"_meta\\": {"
echo "    \\"total_files\\": \$TOTAL_FILES,"
echo "    \\"collected_at\\": \\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\\""
echo "  }"
echo '}'
`;
}
