/**
 * Built-in MCP prompts. These are generic, hand-written guidance for driving
 * the whitelisted tools — not a calibrated diagnostic prompt. The point is to
 * give a good out-of-the-box experience: collect evidence first, reason from it,
 * and never guess past what the output shows.
 */

export function DIAGNOSE_HOST_PROMPT(host: string): string {
  return `You are diagnosing the server "${host}" using the rootpilot-ssh-diagnose MCP tools.

Work strictly from evidence you collect. Do not assume a cause you have not seen in command output.

1. Start with \`collect_base\` on "${host}" to get disk, memory, load, OOM history and the container list.
2. Read the output. Note anything abnormal: a full or nearly-full filesystem, OOM kills, a container that is restarting or exited non-zero, load far above the core count.
3. For any suspect container, run \`container_deep_dive\` (logs, config, exit state, live stats).
4. If a category still looks unexplained, pull more evidence with \`collect\` (≤8 keys). Pick keys by symptom — e.g. disk pressure → disk_top_dirs, deleted_open_files, docker_disk; network → conn_states, dns_check, route_iface, conntrack; CPU/IO → vmstat, iostat, ps_cpu, ps_mem; kernel/service → dmesg_errors, service_status, journalctl. Call \`get_whitelist\` if unsure what a key does.
5. Stop collecting once the evidence points to a cause. Then report:
   - **Root cause** — one sentence, only if the evidence supports it. If it does not, say what is still unknown and which command would settle it.
   - **Evidence** — quote the specific lines you relied on.
   - **Suggested fix** — concrete commands, each marked (safe) or (disruptive). You collect read-only; the human runs any change.

Be honest about uncertainty. "The evidence is consistent with X but does not confirm it" is a valid answer.`
}

export function HEALTH_CHECK_PROMPT(host: string): string {
  return `Do a light health check of "${host}" using the rootpilot-ssh-diagnose MCP tools.

1. Run \`collect_base\` on "${host}".
2. Skim for early warnings rather than active failures: a filesystem above ~80%, inodes running low, swap in steady use, load creeping toward the core count, a container that has restarted many times, or recent OOM lines.
3. Only if something looks off, pull one or two targeted keys with \`collect\` to confirm.
4. Report a short bill of health: what looks fine, what is worth watching (with the number you saw), and anything that needs action now. Do not invent problems — "nothing notable" is a good result.`
}
