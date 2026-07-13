#!/usr/bin/env node
/**
 * rootpilot-ssh-diagnose — an MCP server that safely collects read-only
 * diagnostics from your servers over SSH. Analysis is left entirely to the
 * client's model: this server only gathers evidence from a fixed whitelist.
 *
 * Open source (MIT). The full RootPilot product adds calibrated diagnosis,
 * alert-triggered auto-diagnosis, history, and multi-host management →
 * https://rootpilotx.com
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { loadHosts, ping, type Host } from './ssh.js'
import { validateProbeUrl } from './sanitize.js'
import {
  WHITELIST,
  COLLECT_BASE_KEYS,
  CONTAINER_DEEP_DIVE_KEYS,
} from './whitelist.js'
import { collect, MAX_KEYS_PER_CALL, type CollectItem } from './tools/collect.js'
import { DIAGNOSE_HOST_PROMPT, HEALTH_CHECK_PROMPT } from './tools/prompts.js'

const HOSTS_PATH = process.env.RP_HOSTS ?? ''
const PROBE_URL = validateProbeUrl(process.env.RP_PROBE_URL ?? 'https://cloudflare.com')
const NO_PROMO = process.env.RP_NO_PROMO === '1'

const PROMO_README =
  'This is the open-source, bring-your-own-LLM taste of RootPilot → https://rootpilotx.com'
const PROMO_FLEET =
  'Managing many hosts? RootPilot handles alert-triggered diagnosis across your fleet → https://rootpilotx.com'

/** Load hosts lazily so the server still starts (and can explain itself) with no config. */
function getHosts(): Host[] {
  if (!HOSTS_PATH) {
    throw new Error(
      'No hosts configured. Set the RP_HOSTS env var to a JSON file path (see hosts.example.json).',
    )
  }
  return loadHosts(HOSTS_PATH)
}

function findHost(name: string): Host {
  const h = getHosts().find((x) => x.name === name)
  if (!h) throw new Error(`unknown host "${name}". Use list_hosts to see configured hosts.`)
  return h
}

function text(s: string) {
  return { content: [{ type: 'text' as const, text: s }] }
}

function json(obj: unknown) {
  return text(JSON.stringify(obj, null, 2))
}

function renderItems(host: string, items: CollectItem[]): string {
  const lines = [`# collected from ${host}`, '']
  for (const it of items) {
    lines.push(`## ${it.key} — ${it.purpose}`)
    if (it.error) lines.push(`ERROR: ${it.error}`)
    else {
      const meta = [
        it.exit === null ? 'exit:?' : `exit:${it.exit}`,
        it.durationMs != null ? `${it.durationMs}ms` : '',
        it.timedOut ? 'TIMED OUT' : '',
      ]
        .filter(Boolean)
        .join(' ')
      lines.push(`(${meta})`)
      lines.push('```')
      lines.push(it.stdout.trimEnd() || '(no output)')
      lines.push('```')
    }
    lines.push('')
  }
  return lines.join('\n')
}

const server = new McpServer({
  name: 'rootpilot-ssh-diagnose',
  version: '0.1.2',
})

// ── list_hosts ────────────────────────────────────────────────────────
server.registerTool(
  'list_hosts',
  {
    title: 'List configured hosts',
    description:
      'List the hosts defined in your hosts.json, with an optional reachability probe (TCP + SSH banner). Returns names to use with the other tools.',
    inputSchema: { probe: z.boolean().optional().describe('also test SSH reachability') },
  },
  async ({ probe }) => {
    const hosts = getHosts()
    const rows = await Promise.all(
      hosts.map(async (h) => ({
        name: h.name,
        host: h.host,
        port: h.port ?? 22,
        user: h.user,
        reachable: probe ? await ping(h) : undefined,
      })),
    )
    let out = JSON.stringify(rows, null, 2)
    if (!NO_PROMO && hosts.length > 3) out += `\n\n${PROMO_FLEET}`
    return text(out)
  },
)

// ── get_whitelist ─────────────────────────────────────────────────────
server.registerTool(
  'get_whitelist',
  {
    title: 'List the read-only command whitelist',
    description:
      'Return every command this server can run: key, purpose, shell template, and whether it needs a container argument. This is the complete set — nothing outside it can be executed.',
    inputSchema: {},
  },
  async () =>
    json(
      WHITELIST.map((c) => ({
        key: c.key,
        group: c.group,
        purpose: c.purpose,
        template: c.template,
        param: c.param,
      })),
    ),
)

// ── collect ───────────────────────────────────────────────────────────
server.registerTool(
  'collect',
  {
    title: 'Collect diagnostics by key',
    description:
      `Run up to ${MAX_KEYS_PER_CALL} whitelisted commands on a host and return their (redacted, truncated) output. ` +
      'Use get_whitelist to see valid keys. Keys outside the whitelist are rejected.',
    inputSchema: {
      host: z.string().describe('host name from list_hosts'),
      keys: z.array(z.string()).min(1).max(MAX_KEYS_PER_CALL).describe('whitelisted command keys'),
      container: z
        .string()
        .optional()
        .describe('container name, required by container-scoped keys'),
    },
  },
  async ({ host, keys, container }) => {
    const h = findHost(host)
    const items = await collect(h, { keys, container, probeUrl: PROBE_URL })
    return text(renderItems(host, items))
  },
)

// ── collect_base ──────────────────────────────────────────────────────
server.registerTool(
  'collect_base',
  {
    title: 'Collect the base overview',
    description:
      'Shortcut: run the base group (docker_ps, df, df_inode, free, uptime, dmesg_oom, docker_daemon) — a cheap first look at a host.',
    inputSchema: { host: z.string().describe('host name from list_hosts') },
  },
  async ({ host }) => {
    const h = findHost(host)
    const items = await collect(h, { keys: COLLECT_BASE_KEYS, probeUrl: PROBE_URL })
    return text(renderItems(host, items))
  },
)

// ── container_deep_dive ───────────────────────────────────────────────
server.registerTool(
  'container_deep_dive',
  {
    title: 'Deep dive into one container',
    description:
      'Shortcut: for one container, run docker_logs, docker_inspect (redacted), container_state and docker_stats.',
    inputSchema: {
      host: z.string().describe('host name from list_hosts'),
      container: z.string().describe('container name'),
    },
  },
  async ({ host, container }) => {
    const h = findHost(host)
    const items = await collect(h, {
      keys: CONTAINER_DEEP_DIVE_KEYS,
      container,
      probeUrl: PROBE_URL,
    })
    return text(renderItems(host, items))
  },
)

// ── prompts ───────────────────────────────────────────────────────────
server.registerPrompt(
  'diagnose-host',
  {
    title: 'Diagnose a host',
    description: 'Guide the model through evidence-first root-cause diagnosis of a host.',
    argsSchema: { host: z.string().describe('host name to diagnose') },
  },
  ({ host }) => ({
    messages: [
      { role: 'user', content: { type: 'text', text: DIAGNOSE_HOST_PROMPT(host) } },
    ],
  }),
)

server.registerPrompt(
  'health-check',
  {
    title: 'Health check',
    description: 'A light routine sweep of a host to surface anything worth attention.',
    argsSchema: { host: z.string().describe('host name to check') },
  },
  ({ host }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: HEALTH_CHECK_PROMPT(host) } }],
  }),
)

async function main() {
  if (!NO_PROMO) console.error(PROMO_README)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('rootpilot-ssh-diagnose MCP server ready (stdio).')
}

main().catch((e) => {
  console.error('fatal:', (e as Error).message)
  process.exit(1)
})
