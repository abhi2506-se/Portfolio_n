/**
 * Voice Phase 3 — typed confirmation for sensitive commands (pure, no I/O).
 *
 * Flow: the server issues a short-lived signed challenge bound to ONE command, ONE set of
 * arguments and ONE admin. The admin must then send the challenge back together with the exact
 * typed phrase. Stateless on purpose: works across serverless instances without shared memory.
 *
 * Limitation (documented): within the 2-minute window the same signed challenge could be
 * replayed by the same admin. A single-use nonce would need a DB table (not added yet).
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto'

export const CONFIRM_TTL_MS = 2 * 60_000

/** Uppercase, single spaces. Users may type the phrase with any spacing. */
export function normalizePhrase(s: string): string {
  return (s || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

/** Stable digest of validated arguments, so a challenge can't be reused for different arguments. */
export function argsDigest(args: Record<string, string>): string {
  const canonical = JSON.stringify(Object.keys(args).sort().map(k => [k, args[k]]))
  return createHash('sha256').update(canonical).digest('hex')
}

interface Payload { c: string; a: string; u: string; e: number }

const b64url = (buf: Buffer) => buf.toString('base64url')

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

export function issueChallenge(secret: string, commandId: string, digest: string, admin: string, now: number) {
  const payload: Payload = { c: commandId, a: digest, u: admin, e: now + CONFIRM_TTL_MS }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  return { token: `${body}.${sign(secret, body)}`, expiresAt: payload.e }
}

export function verifyChallenge(
  secret: string,
  token: string,
  expected: { commandId: string; digest: string; admin: string },
  now: number,
): boolean {
  if (typeof token !== 'string' || !token.includes('.')) return false
  const [body, sig] = token.split('.')
  const want = sign(secret, body)
  if (!sig || sig.length !== want.length) return false
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false
  let p: Payload
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return false }
  return p.e > now && p.c === expected.commandId && p.a === expected.digest && p.u === expected.admin
}
