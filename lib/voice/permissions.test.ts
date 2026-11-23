import { test } from 'node:test'
import * as assert from 'node:assert/strict'
import { evaluatePermission, validatePermissionList, parsePermissions } from './permissions'

const NOW = 1_000_000
const grant = (p: string, extra: Partial<{ expiresAt: number | null; revokedAt: number | null }> = {}) =>
  ({ permissions: p, expiresAt: null, revokedAt: null, ...extra })

test('no grant means no permission at all', () => {
  assert.deepEqual(evaluatePermission(null, 'nav', NOW), { allowed: false, reason: 'no-grant' })
})

test('granted key is allowed, other keys are not', () => {
  assert.equal(evaluatePermission(grant('nav,projects'), 'projects', NOW).allowed, true)
  assert.deepEqual(evaluatePermission(grant('nav,projects'), 'live_chat', NOW), { allowed: false, reason: 'not-in-grant' })
})

test('revoked and expired grants are denied immediately', () => {
  assert.deepEqual(evaluatePermission(grant('nav', { revokedAt: NOW - 1 }), 'nav', NOW), { allowed: false, reason: 'revoked' })
  assert.deepEqual(evaluatePermission(grant('nav', { expiresAt: NOW }), 'nav', NOW), { allowed: false, reason: 'expired' })
  assert.equal(evaluatePermission(grant('nav', { expiresAt: NOW + 1 }), 'nav', NOW).allowed, true)
})

test('unknown keys are dropped when parsing stored data, rejected when admin submits them', () => {
  assert.deepEqual(parsePermissions('nav, bogus ,nav,contact'), ['nav', 'contact'])
  assert.equal(validatePermissionList(['nav', 'admin_everything']).ok, false)
  assert.equal(validatePermissionList('nav').ok, false)
  assert.equal(validatePermissionList(['nav', 'nav']).ok, true)
})
