/**
 * Minimal SSH exec layer over ssh2.
 *
 * Responsibilities: load host definitions, open a connection, run ONE
 * whitelisted command with a hard timeout, and return {stdout, exit, duration}.
 * It never assembles a command from caller input — it runs a fully-rendered
 * template string produced by the tools layer.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { Client } from 'ssh2'

export interface HostAuthKey {
  type: 'key'
  keyPath: string
  passphrase?: string
}
export interface HostAuthPassword {
  type: 'password'
  password: string
}
export interface Host {
  name: string
  host: string
  port?: number
  user: string
  auth: HostAuthKey | HostAuthPassword
}

export interface ExecResult {
  stdout: string
  exit: number | null
  durationMs: number
  timedOut: boolean
}

function expandHome(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, homedir()) : p
}

/** Load and shallow-validate hosts.json. Throws with a readable message. */
export function loadHosts(path: string): Host[] {
  let raw: string
  try {
    raw = readFileSync(expandHome(path), 'utf8')
  } catch {
    throw new Error(
      `Cannot read hosts file at ${path}. Set RP_HOSTS to a JSON file (see hosts.example.json).`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`hosts file is not valid JSON: ${(e as Error).message}`)
  }
  if (!Array.isArray(parsed)) throw new Error('hosts file must be a JSON array of hosts')
  return parsed.map((h, i) => {
    const host = h as Partial<Host>
    if (!host.name || !host.host || !host.user || !host.auth) {
      throw new Error(`host[${i}] missing required field (name, host, user, auth)`)
    }
    return host as Host
  })
}

interface ConnectConfig {
  host: string
  port: number
  username: string
  readyTimeout: number
  privateKey?: Buffer
  passphrase?: string
  password?: string
}

function connectConfig(h: Host): ConnectConfig {
  const cfg: ConnectConfig = {
    host: h.host,
    port: h.port ?? 22,
    username: h.user,
    readyTimeout: 15000,
  }
  if (h.auth.type === 'key') {
    cfg.privateKey = readFileSync(expandHome(h.auth.keyPath))
    if (h.auth.passphrase) cfg.passphrase = h.auth.passphrase
  } else {
    cfg.password = h.auth.password
  }
  return cfg
}

/**
 * Run one command on a host with a per-command timeout.
 * `command` is a fully-rendered whitelisted template — never raw caller input.
 */
export function execOnce(h: Host, command: string, timeoutMs = 15000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const conn = new Client()
    const started = Date.now()
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      try {
        conn.end()
      } catch {
        /* ignore */
      }
      fn()
    }

    const killTimer = setTimeout(() => {
      finish(() =>
        resolve({ stdout: '', exit: null, durationMs: Date.now() - started, timedOut: true }),
      )
    }, timeoutMs + 2000)

    conn.on('ready', () => {
      conn.exec(command, { pty: false }, (err, stream) => {
        if (err) {
          clearTimeout(killTimer)
          return finish(() => reject(err))
        }
        let out = ''
        // guard against a runaway command flooding memory
        const cap = 512 * 1024
        const onData = (d: Buffer) => {
          if (out.length < cap) out += d.toString('utf8')
        }
        stream.on('data', onData)
        stream.stderr.on('data', onData)
        stream.on('close', (code: number | null) => {
          clearTimeout(killTimer)
          finish(() =>
            resolve({
              stdout: out,
              exit: code,
              durationMs: Date.now() - started,
              timedOut: false,
            }),
          )
        })
      })
    })

    conn.on('error', (err) => {
      clearTimeout(killTimer)
      finish(() => reject(err))
    })

    try {
      conn.connect(connectConfig(h))
    } catch (e) {
      clearTimeout(killTimer)
      finish(() => reject(e))
    }
  })
}

/** Lightweight reachability check (TCP + SSH banner), used by list_hosts. */
export function ping(h: Host, timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = new Client()
    let done = false
    const settle = (v: boolean) => {
      if (done) return
      done = true
      try {
        conn.end()
      } catch {
        /* ignore */
      }
      resolve(v)
    }
    const t = setTimeout(() => settle(false), timeoutMs)
    conn.on('ready', () => {
      clearTimeout(t)
      settle(true)
    })
    conn.on('error', () => {
      clearTimeout(t)
      settle(false)
    })
    try {
      conn.connect({ ...connectConfig(h), readyTimeout: timeoutMs })
    } catch {
      clearTimeout(t)
      settle(false)
    }
  })
}
