/**
 * Read-only command whitelist.
 *
 * Every command here is strictly read-only: it inspects state and never
 * mutates the host. This is the ONLY set of commands this server can run.
 * There is no code path that executes an arbitrary string on a host.
 *
 * The single templated parameter is `{container}`, which is validated
 * against /^[a-zA-Z0-9_.-]+$/ before substitution (see sanitize.ts). No other
 * user-supplied value is ever interpolated into a command.
 *
 * `{probe}` is substituted from a validated connectivity URL (RP_PROBE_URL,
 * default https://cloudflare.com) — an operator-controlled config value, not
 * model/agent input.
 */

export type Param = 'NONE' | 'CONTAINER'

export interface Command {
  /** stable id used by the `collect` tool */
  key: string
  /** short English description of what it inspects */
  purpose: string
  /** shell template; `{container}` / `{probe}` are the only substitutions */
  template: string
  /** whether the command needs a validated container name */
  param: Param
  /** post-processing applied to stdout before returning (see sanitize.ts) */
  postProcess?: 'DOCKER_INSPECT_REDACT'
  /** rough grouping, surfaced by get_whitelist for readability */
  group: 'base' | 'container' | 'resource' | 'network' | 'system'
}

export const WHITELIST: Command[] = [
  // ── base: cheap, always-safe overview ───────────────────────────────
  {
    key: 'docker_ps',
    purpose: 'List all containers with status and image',
    template: 'docker ps -a --format "{{.Names}}\\t{{.Status}}\\t{{.Image}}"',
    param: 'NONE',
    group: 'base',
  },
  {
    key: 'docker_daemon',
    purpose: 'Docker daemon status and running/total container count',
    template:
      "systemctl is-active docker 2>/dev/null; docker info --format '{{.ServerVersion}} running:{{.ContainersRunning}}/{{.Containers}}' 2>/dev/null",
    param: 'NONE',
    group: 'base',
  },
  {
    key: 'df',
    purpose: 'Filesystem disk usage',
    template: 'df -h',
    param: 'NONE',
    group: 'base',
  },
  {
    key: 'df_inode',
    purpose: 'Inode usage (a full inode table looks like a full disk)',
    template: 'df -i',
    param: 'NONE',
    group: 'base',
  },
  {
    key: 'free',
    purpose: 'Memory and swap usage',
    template: 'free -m',
    param: 'NONE',
    group: 'base',
  },
  {
    key: 'uptime',
    purpose: 'Uptime and load average',
    template: 'uptime',
    param: 'NONE',
    group: 'base',
  },
  {
    key: 'dmesg_oom',
    purpose: 'Kernel OOM / killed-process evidence',
    template: "dmesg -T 2>/dev/null | grep -iE 'oom|killed process' | tail -20",
    param: 'NONE',
    group: 'base',
  },

  // ── container: per-container deep dive ──────────────────────────────
  {
    key: 'docker_stats',
    purpose: 'Live CPU / memory / IO per container',
    template: 'docker stats --no-stream',
    param: 'NONE',
    group: 'container',
  },
  {
    key: 'docker_logs',
    purpose: 'Last 500 log lines of a container',
    template: 'docker logs --tail 500 {container} 2>&1',
    param: 'CONTAINER',
    group: 'container',
  },
  {
    key: 'docker_inspect',
    purpose: 'Container configuration (secrets redacted)',
    template: 'docker inspect {container}',
    param: 'CONTAINER',
    postProcess: 'DOCKER_INSPECT_REDACT',
    group: 'container',
  },
  {
    key: 'container_state',
    purpose: 'Exit code / OOMKilled flag / restart count / status',
    template:
      "docker inspect {container} --format 'ExitCode:{{.State.ExitCode}} OOMKilled:{{.State.OOMKilled}} Restarts:{{.RestartCount}} Status:{{.State.Status}}' 2>/dev/null",
    param: 'CONTAINER',
    group: 'container',
  },
  {
    key: 'container_netstat',
    purpose: 'Ports a container is actually listening on (verify claimed vs real)',
    template:
      'docker exec {container} sh -c "(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || cat /proc/net/tcp 2>/dev/null) | head -20" 2>/dev/null || echo "[cannot enter container or no net tools inside]"',
    param: 'CONTAINER',
    group: 'container',
  },
  {
    key: 'docker_top',
    purpose: 'Process list inside a container (in-container CPU hog)',
    template: 'docker top {container} 2>/dev/null || echo "[cannot read container processes]"',
    param: 'CONTAINER',
    group: 'container',
  },
  {
    key: 'docker_events',
    purpose: 'Recent container events (kill / die / oom / restart)',
    template:
      'timeout 5 docker events --since 30m --until "$(date +%s)" 2>/dev/null | tail -40 || echo "[no recent events or docker unavailable]"',
    param: 'NONE',
    group: 'container',
  },

  // ── resource: CPU / memory / IO saturation ──────────────────────────
  {
    key: 'top',
    purpose: 'Process snapshot',
    template: 'top -b -n 1 | head -30',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'ps_mem',
    purpose: 'Top processes by memory',
    template: 'ps -eo pid,user,%mem,rss,comm --sort=-%mem 2>/dev/null | head -16',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'ps_cpu',
    purpose: 'Top processes by CPU',
    template: 'ps -eo pid,user,%cpu,etimes,comm --sort=-%cpu 2>/dev/null | head -16',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'vmstat',
    purpose: 'CPU / IO / swap dynamics over 3 seconds',
    template: 'vmstat 1 3 2>/dev/null || echo "[vmstat not installed (procps)]"',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'iostat',
    purpose: 'Disk IO saturation (%util / await)',
    template: 'iostat -xz 1 2 2>/dev/null || echo "[iostat not installed, needs sysstat]"',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'meminfo',
    purpose: 'Memory / swap / slab breakdown',
    template:
      'grep -E "MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree|Dirty|Writeback|Slab" /proc/meminfo 2>/dev/null',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'loadavg',
    purpose: 'Load average vs core count',
    template: 'cat /proc/loadavg 2>/dev/null; echo "cores=$(nproc 2>/dev/null)"',
    param: 'NONE',
    group: 'resource',
  },

  // ── disk deep dive ──────────────────────────────────────────────────
  {
    key: 'docker_disk',
    purpose: 'Docker disk usage (images / containers / volumes / build cache)',
    template: 'docker system df 2>/dev/null || echo "[docker unavailable]"',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'disk_top_dirs',
    purpose: 'Largest directories (find what filled the disk)',
    template: 'du -xhd1 /var /home /opt /tmp /root /usr 2>/dev/null | sort -rh | head -15',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'deleted_open_files',
    purpose: 'Deleted-but-open files (df full while du is not)',
    template:
      'lsof +L1 2>/dev/null | { IFS= read -r h; echo "$h"; sort -k7 -rn; } | head -20 || echo "[lsof missing or no permission]"',
    param: 'NONE',
    group: 'resource',
  },
  {
    key: 'mounts_ro',
    purpose: 'Read-only remounts on real partitions (disk-failure symptom)',
    template:
      'grep -E " ro,| ro " /proc/mounts 2>/dev/null | grep -vE "tmpfs|cgroup|squashfs|overlay|iso9660|/snap|/run/|/sys/|/proc/|mqueue|devpts|debugfs|tracefs|bpf|pstore|fusectl|autofs" | head; echo "(entries above are suspected read-only real partitions)"',
    param: 'NONE',
    group: 'resource',
  },

  // ── network deep dive ───────────────────────────────────────────────
  {
    key: 'listen_ports',
    purpose: 'Listening TCP ports',
    template: '(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | head -40',
    param: 'NONE',
    group: 'network',
  },
  {
    key: 'net_egress',
    purpose: 'Outbound connectivity probe',
    template: 'timeout 3 curl -sS -o /dev/null -w "HTTP:%{http_code}" {probe} 2>&1; echo " EXIT:$?"',
    param: 'NONE',
    group: 'network',
  },
  {
    key: 'conn_states',
    purpose: 'Connection-state distribution (TIME_WAIT / CLOSE_WAIT floods)',
    template:
      'echo "== state counts =="; ss -tan 2>/dev/null | sed 1d | tr -s " " | cut -d" " -f1 | sort | uniq -c | sort -rn | head; echo "== summary =="; ss -s 2>/dev/null | head -5',
    param: 'NONE',
    group: 'network',
  },
  {
    key: 'dns_check',
    purpose: 'DNS config and a resolution probe',
    template:
      'echo "== resolv.conf =="; grep -vE "^#|^$" /etc/resolv.conf 2>/dev/null | head -5; echo "== resolve probe =="; timeout 3 getent hosts $(echo "{probe}" | sed -E "s#https?://##;s#/.*##") 2>&1 | head -3 || echo "[resolution failed, DNS issue]"',
    param: 'NONE',
    group: 'network',
  },
  {
    key: 'firewall',
    purpose: 'Firewall rules (possible source of refused connections)',
    template:
      '(iptables -S 2>/dev/null || nft list ruleset 2>/dev/null || echo "[needs root or not installed]") | head -40',
    param: 'NONE',
    group: 'network',
  },
  {
    key: 'route_iface',
    purpose: 'Routing table and NIC errors / drops',
    template:
      'echo "== routes =="; ip route 2>/dev/null | head -15; echo "== interfaces (errors/drops) =="; ip -s -br link 2>/dev/null | head || netstat -i 2>/dev/null | head',
    param: 'NONE',
    group: 'network',
  },
  {
    key: 'conntrack',
    purpose: 'Conntrack table usage (a full table drops new connections)',
    template:
      'echo "count=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null) max=$(cat /proc/sys/net/netfilter/nf_conntrack_max 2>/dev/null)"; test -e /proc/sys/net/netfilter/nf_conntrack_max || echo "[conntrack module not loaded]"',
    param: 'NONE',
    group: 'network',
  },

  // ── system / kernel / logs ──────────────────────────────────────────
  {
    key: 'journalctl',
    purpose: 'Last 200 systemd journal lines',
    template: 'journalctl -n 200 --no-pager',
    param: 'NONE',
    group: 'system',
  },
  {
    key: 'service_status',
    purpose: 'Key services installed-but-not-running (silent evidence) + failed units',
    template:
      'echo "== installed but not running =="; for s in cron crond atd sshd ssh docker containerd rsyslog systemd-journald systemd-timesyncd chrony chronyd ntp; do systemctl cat $s >/dev/null 2>&1 && { st=$(systemctl is-active $s 2>/dev/null); [ "$st" != active ] && echo "$s=$st"; }; done; echo "== failed services =="; systemctl --failed --type=service --no-pager --plain 2>/dev/null | grep [.]service || echo "(no failed services)"',
    param: 'NONE',
    group: 'system',
  },
  {
    key: 'dmesg_errors',
    purpose: 'Kernel errors (IO / filesystem / segfault / hung task / NIC)',
    template:
      'dmesg -T 2>/dev/null | grep -iE "error|fail|segfault|call trace|hung_task|blocked for more than|i/o error|ext4-fs error|xfs|link is down|reset|panic|refused" | tail -30 || echo "[dmesg needs permission or no match]"',
    param: 'NONE',
    group: 'system',
  },
  {
    key: 'timedatectl',
    purpose: 'System clock and NTP sync (drift breaks certs / auth / timers)',
    template: 'timedatectl 2>/dev/null || { echo "date: $(date)"; echo "[timedatectl unavailable]"; }',
    param: 'NONE',
    group: 'system',
  },
  {
    key: 'fd_usage',
    purpose: 'File-descriptor usage (Too many open files)',
    template:
      'echo "== file-nr (allocated free max) =="; cat /proc/sys/fs/file-nr 2>/dev/null; echo "== processes with many fds =="; for p in /proc/[0-9]*; do n=$(ls "$p/fd" 2>/dev/null | wc -l); if [ "$n" -gt 200 ]; then echo "$n $(basename $p) $(cat $p/comm 2>/dev/null)"; fi; done 2>/dev/null | sort -rn | head -10',
    param: 'NONE',
    group: 'system',
  },
  {
    key: 'syslog_tail',
    purpose: 'Classic syslog tail (some apps do not write to journald)',
    template:
      'for f in /var/log/syslog /var/log/messages; do [ -r "$f" ] && { echo "== $f (tail 60) =="; tail -60 "$f"; break; }; done 2>/dev/null; true',
    param: 'NONE',
    group: 'system',
  },
]

const BY_KEY = new Map(WHITELIST.map((c) => [c.key, c]))

export function getCommand(key: string): Command | undefined {
  return BY_KEY.get(key)
}

export function isWhitelisted(key: string): boolean {
  return BY_KEY.has(key)
}

/** Fixed shortcut groups. These are simple fixed sets, not adaptive orchestration. */
export const COLLECT_BASE_KEYS = [
  'docker_ps',
  'df',
  'df_inode',
  'free',
  'uptime',
  'dmesg_oom',
  'docker_daemon',
]

export const CONTAINER_DEEP_DIVE_KEYS = [
  'docker_logs',
  'docker_inspect',
  'container_state',
  'docker_stats',
]
