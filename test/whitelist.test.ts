import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WHITELIST,
  getCommand,
  isWhitelisted,
  COLLECT_BASE_KEYS,
  CONTAINER_DEEP_DIVE_KEYS,
} from '../src/whitelist.js'

test('whitelist has the expected size and unique keys', () => {
  assert.equal(WHITELIST.length, 38)
  const keys = WHITELIST.map((c) => c.key)
  assert.equal(new Set(keys).size, keys.length, 'keys must be unique')
})

test('only CONTAINER commands use the {container} placeholder', () => {
  for (const c of WHITELIST) {
    const hasPlaceholder = c.template.includes('{container}')
    assert.equal(
      hasPlaceholder,
      c.param === 'CONTAINER',
      `${c.key}: placeholder/param mismatch`,
    )
  }
})

test('no template embeds an unexpected substitution token', () => {
  // Our only substitutions are {container} and {probe}. Exclude curl's
  // %{http_code} format token, which is not a substitution.
  const allowed = new Set(['container', 'probe'])
  for (const c of WHITELIST) {
    const tokens = [...c.template.matchAll(/(?<!%)\{([a-z_]+)\}/g)].map((m) => m[1])
    for (const tok of tokens) {
      assert.ok(allowed.has(tok), `${c.key}: unexpected token {${tok}}`)
    }
  }
})

test('shortcut groups reference only whitelisted keys', () => {
  for (const k of [...COLLECT_BASE_KEYS, ...CONTAINER_DEEP_DIVE_KEYS]) {
    assert.ok(isWhitelisted(k), `${k} must be whitelisted`)
  }
})

test('getCommand / isWhitelisted agree', () => {
  assert.ok(isWhitelisted('docker_ps'))
  assert.ok(getCommand('docker_ps'))
  assert.equal(isWhitelisted('rm_rf'), false)
  assert.equal(getCommand('rm_rf'), undefined)
})

test('every command is documented with a non-empty purpose', () => {
  for (const c of WHITELIST) {
    assert.ok(c.purpose.trim().length > 0, `${c.key} missing purpose`)
  }
})
