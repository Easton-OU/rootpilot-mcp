import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collect, MAX_KEYS_PER_CALL } from '../src/tools/collect.js'
import { ValidationError } from '../src/sanitize.js'
import type { Host } from '../src/ssh.js'

// A host that must never actually be dialed: every case here should be rejected
// by validation *before* any SSH connection is attempted.
const HOST: Host = {
  name: 'unused',
  host: '203.0.113.1',
  user: 'nobody',
  auth: { type: 'password', password: 'x' },
}
const PROBE = 'https://cloudflare.com'

test('collect rejects keys outside the whitelist', async () => {
  await assert.rejects(
    collect(HOST, { keys: ['docker_ps', 'rm_rf'], probeUrl: PROBE }),
    ValidationError,
  )
})

test('collect rejects more than the per-call key cap', async () => {
  const keys = Array.from({ length: MAX_KEYS_PER_CALL + 1 }, () => 'docker_ps')
  await assert.rejects(collect(HOST, { keys, probeUrl: PROBE }), ValidationError)
})

test('collect rejects an empty key list', async () => {
  await assert.rejects(collect(HOST, { keys: [], probeUrl: PROBE }), ValidationError)
})

test('collect rejects an injection container name before dialing SSH', async () => {
  await assert.rejects(
    collect(HOST, { keys: ['docker_logs'], container: 'web; rm -rf /', probeUrl: PROBE }),
    ValidationError,
  )
})

test('collect surfaces a missing-container requirement as an item, not a throw', async () => {
  // docker_logs needs a container; with none given it returns an item with an
  // error rather than attempting a connection.
  const items = await collect(HOST, { keys: ['docker_logs'], probeUrl: PROBE })
  assert.equal(items.length, 1)
  assert.match(items[0].error ?? '', /requires a container/)
})
