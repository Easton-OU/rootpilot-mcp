/**
 * Input validation and output redaction.
 *
 * Two independent jobs:
 *  1. validateContainer() — the ONLY place a caller-supplied value becomes part
 *     of a shell command. A container name must match /^[a-zA-Z0-9_.-]+$/, so it
 *     cannot contain spaces, quotes, `;`, `|`, `$`, backticks, or newlines. Any
 *     value that fails is rejected before a command is ever built.
 *  2. redact*() — scrubs likely secrets/PII from stdout before it leaves the
 *     process, so credentials in logs or `docker inspect` env do not reach the
 *     model or the client transcript.
 */

const CONTAINER_RE = /^[a-zA-Z0-9_.-]+$/
const PROBE_RE = /^https?:\/\/[a-zA-Z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/

export class ValidationError extends Error {}

/** Validate and return a safe container name, or throw ValidationError. */
export function validateContainer(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new ValidationError('container must be a non-empty string')
  }
  if (name.length > 128) {
    throw new ValidationError('container name too long')
  }
  if (!CONTAINER_RE.test(name)) {
    throw new ValidationError(
      `invalid container name ${JSON.stringify(name)}: only [a-zA-Z0-9_.-] allowed`,
    )
  }
  return name
}

/** Validate an operator-supplied connectivity probe URL. */
export function validateProbeUrl(url: string): string {
  if (!PROBE_RE.test(url)) {
    throw new ValidationError(`invalid probe URL: ${JSON.stringify(url)}`)
  }
  return url
}

const REDACTIONS: Array<[RegExp, string]> = [
  // key=value secrets (env vars in docker inspect, connection strings, etc.)
  [
    /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)[A-Za-z0-9_]*)(["']?\s*[:=]\s*["']?)([^"'\s,}]+)/gi,
    '$1$2***REDACTED***',
  ],
  // bearer / authorization headers
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 ***REDACTED***'],
  // common API-key shapes (sk-, ghp_, xox…, AKIA…)
  [/\b(sk-[A-Za-z0-9]{16,}|gh[posru]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g, '***REDACTED***'],
  // private-key blocks
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '***REDACTED-PRIVATE-KEY***'],
  // credentials embedded in URLs
  [/\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s:@]+@/g, '$1***:***@'],
]

/** Best-effort scrub of secrets in arbitrary stdout. */
export function redactSecrets(text: string): string {
  let out = text
  for (const [re, repl] of REDACTIONS) out = out.replace(re, repl)
  return out
}

/**
 * `docker inspect` returns full Env arrays; redact the values of any
 * "KEY=secret" env entries in addition to the generic secret scrub.
 */
export function redactDockerInspect(text: string): string {
  const envRedacted = text.replace(
    /("(?:[A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH|CREDENTIAL)[A-Za-z0-9_]*)=)[^"]*(")/gi,
    '$1***REDACTED***$2',
  )
  return redactSecrets(envRedacted)
}

/** Truncate long output, keeping head and tail, with a clear marker. */
export function truncate(text: string, maxChars = 12000): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.7)
  const tail = maxChars - head
  return (
    text.slice(0, head) +
    `\n… [truncated ${text.length - maxChars} chars] …\n` +
    text.slice(text.length - tail)
  )
}
