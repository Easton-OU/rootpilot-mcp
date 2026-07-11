/**
 * Core collection logic shared by the `collect`, `collect_base` and
 * `container_deep_dive` tools. Renders a whitelisted template (substituting the
 * validated container name and probe URL only), runs it over SSH, and returns
 * redacted, truncated output.
 */

import { execOnce, type Host } from '../ssh.js'
import {
  getCommand,
  isWhitelisted,
  type Command,
} from '../whitelist.js'
import {
  ValidationError,
  redactDockerInspect,
  redactSecrets,
  truncate,
  validateContainer,
} from '../sanitize.js'

export const MAX_KEYS_PER_CALL = 8
const CMD_TIMEOUT_MS = 15000

export interface CollectItem {
  key: string
  purpose: string
  stdout: string
  exit: number | null
  durationMs?: number
  timedOut?: boolean
  error?: string
}

/** Render a whitelisted template into a runnable command string. */
function render(cmd: Command, container: string | undefined, probeUrl: string): string {
  let out = cmd.template.replace(/\{probe\}/g, probeUrl)
  if (cmd.param === 'CONTAINER') {
    // validateContainer has already run; this is defence in depth.
    const safe = validateContainer(container)
    out = out.replace(/\{container\}/g, safe)
  }
  return out
}

function postProcess(cmd: Command, stdout: string): string {
  const scrubbed =
    cmd.postProcess === 'DOCKER_INSPECT_REDACT'
      ? redactDockerInspect(stdout)
      : redactSecrets(stdout)
  return truncate(scrubbed)
}

/**
 * Execute one whitelisted key. Rejects unknown keys and missing container args
 * before any SSH call. Never throws for command-level failures — those are
 * returned as an item with `error`/non-zero exit so the model still sees them.
 */
async function runKey(
  host: Host,
  key: string,
  container: string | undefined,
  probeUrl: string,
): Promise<CollectItem> {
  const cmd = getCommand(key)
  if (!cmd) {
    return { key, purpose: '', stdout: '', exit: null, error: `key not in whitelist: ${key}` }
  }
  if (cmd.param === 'CONTAINER' && !container) {
    return {
      key,
      purpose: cmd.purpose,
      stdout: '',
      exit: null,
      error: `command "${key}" requires a container argument`,
    }
  }
  let rendered: string
  try {
    rendered = render(cmd, container, probeUrl)
  } catch (e) {
    if (e instanceof ValidationError) {
      return { key, purpose: cmd.purpose, stdout: '', exit: null, error: e.message }
    }
    throw e
  }
  try {
    const r = await execOnce(host, rendered, CMD_TIMEOUT_MS)
    return {
      key,
      purpose: cmd.purpose,
      stdout: postProcess(cmd, r.stdout),
      exit: r.exit,
      durationMs: r.durationMs,
      timedOut: r.timedOut || undefined,
    }
  } catch (e) {
    return {
      key,
      purpose: cmd.purpose,
      stdout: '',
      exit: null,
      error: `ssh/exec failed: ${(e as Error).message}`,
    }
  }
}

export interface CollectOptions {
  keys: string[]
  container?: string
  probeUrl: string
}

/** Validate the request, then run keys sequentially (gentle on the target). */
export async function collect(host: Host, opts: CollectOptions): Promise<CollectItem[]> {
  const { keys, container, probeUrl } = opts
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new ValidationError('keys must be a non-empty array')
  }
  if (keys.length > MAX_KEYS_PER_CALL) {
    throw new ValidationError(`too many keys (${keys.length}); max ${MAX_KEYS_PER_CALL} per call`)
  }
  const unknown = keys.filter((k) => !isWhitelisted(k))
  if (unknown.length) {
    throw new ValidationError(`keys not in whitelist: ${unknown.join(', ')}`)
  }
  if (container !== undefined) validateContainer(container) // fail fast on bad names

  const items: CollectItem[] = []
  for (const key of keys) {
    items.push(await runKey(host, key, container, probeUrl))
  }
  return items
}
