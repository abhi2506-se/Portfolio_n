import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { issueChallenge, verifyChallenge, argsDigest, normalizePhrase, CONFIRM_TTL_MS } from './confirm'
import { validateArgs } from './args'

const SECRET = 'test-secret-value'
const NOW = 1_000_000

test('challenge verifies for the same command, args, admin, within TTL', () => {
  const d = argsDigest({ username: 'ravi_01' })
  const { token } = issueChallenge(SECRET, 'team.coadmin_remove', d, 'admin', NOW)
  assert.equal(verifyChallenge(SECRET, token, { commandId: 'team.coadmin_remove', digest: d, admin: 'admin' }, NOW + 1000), true)
})

test('challenge expires after the TTL', () => {
  const d = argsDigest({})
  const { token } = issueChallenge(SECRET, 'site.maintenance_on', d, 'admin', NOW)
  assert.equal(verifyChallenge(SECRET, token, { commandId: 'site.maintenance_on', digest: d, admin: 'admin' }, NOW + CONFIRM_TTL_MS + 1), false)
})

test('challenge is bound to command, arguments and admin', () => {
  const d1 = argsDigest({ username: 'ravi_01' })
  const d2 = argsDigest({ username: 'other_user' })
  const { token } = issueChallenge(SECRET, 'team.coadmin_remove', d1, 'admin', NOW)
  const ok = { commandId: 'team.coadmin_remove', digest: d1, admin: 'admin' }
  assert.equal(verifyChallenge(SECRET, token, { ...ok, commandId: 'team.coadmin_disable' }, NOW), false)
  assert.equal(verifyChallenge(SECRET, token, { ...ok, digest: d2 }, NOW), false)
  assert.equal(verifyChallenge(SECRET, token, { ...ok, admin: 'someone_else' }, NOW), false)
})

test('tampered tokens and wrong secrets are rejected', () => {
  const d = argsDigest({})
  const { token } = issueChallenge(SECRET, 'site.maintenance_on', d, 'admin', NOW)
  const exp = { commandId: 'site.maintenance_on', digest: d, admin: 'admin' }
  const [body, sig] = token.split('.')
  assert.equal(verifyChallenge(SECRET, `${body}x.${sig}`, exp, NOW), false)
  assert.equal(verifyChallenge(SECRET, `${body}.${'0'.repeat(sig.length)}`, exp, NOW), false)
  assert.equal(verifyChallenge('other-secret', token, exp, NOW), false)
  assert.equal(verifyChallenge(SECRET, 'garbage', exp, NOW), false)
  assert.equal(verifyChallenge(SECRET, '', exp, NOW), false)
})

test('phrase matching ignores case and spacing but nothing else', () => {
  assert.equal(normalizePhrase('  confirm   maintenance  on '), 'CONFIRM MAINTENANCE ON')
  assert.notEqual(normalizePhrase('confirm maintenance off'), normalizePhrase('CONFIRM MAINTENANCE ON'))
})

test('argument validation rejects extra, missing, and malformed fields', () => {
  assert.equal(validateArgs({ username: 'username' }, { username: 'ravi_01' }).ok, true)
  assert.equal(validateArgs({ username: 'username' }, { username: 'ravi_01', password: 'x' }).ok, false)
  assert.equal(validateArgs({ username: 'username' }, {}).ok, false)
  assert.equal(validateArgs({ username: 'username' }, { username: 'a; DROP TABLE' }).ok, false)
  assert.equal(validateArgs({}, undefined).ok, true)
  assert.equal(validateArgs({}, ['x']).ok, false)
})

test('name argument accepts real names and rejects injection-like input', () => {
  assert.equal(validateArgs({ name: 'name' }, { name: 'Gayatri' }).ok, true)
  assert.equal(validateArgs({ name: 'name' }, { name: "Mary-Ann O'Neil" }).ok, true)
  assert.equal(validateArgs({ name: 'name' }, { name: 'x' }).ok, false)
  assert.equal(validateArgs({ name: 'name' }, { name: "x'; DROP TABLE live_chats; --" }).ok, false)
})
