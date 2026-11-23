import { NextRequest, NextResponse } from 'next/server'
import { adminFromRequest } from '@/lib/admin-request'
import { findCommand, NAV_ALLOWLIST } from '@/lib/voice/commands/registry'
import { validateArgs } from '@/lib/voice/commands/args'
import { argsDigest, issueChallenge, verifyChallenge, normalizePhrase, CONFIRM_TTL_MS } from '@/lib/voice/commands/confirm'

const noStore = { 'Cache-Control': 'no-store' }

function audit(admin: string, command: string, status: string) {
  // Structured server log. A persisted audit table needs your approval (see the migration plan).
  console.info(JSON.stringify({ ts: new Date().toISOString(), area: 'voice-command', admin, command, status }))
}

/**
 * POST /api/admin/voice/command
 * body: { command: string, args?: object, confirm?: { token: string, phrase: string } }
 *
 * 1. Admin session required (existing HMAC admin cookie, server-side).
 * 2. Command id must exist in the server registry. Arguments are validated strictly.
 * 3. Read and navigation commands run directly.
 * 4. Sensitive commands need a typed confirmation: the first call returns a challenge, and the
 *    second call must echo the challenge and type the exact phrase.
 */
export async function POST(req: NextRequest) {
  const admin = adminFromRequest(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.command !== 'string') {
    return NextResponse.json({ status: 'error', speech: "I couldn't understand that command." }, { status: 400, headers: noStore })
  }
  const def = findCommand(body.command)
  if (!def) {
    audit(admin, String(body.command).slice(0, 80), 'unknown')
    return NextResponse.json({ status: 'error', speech: "I don't know that command." }, { status: 404, headers: noStore })
  }

  const v = validateArgs(def.args, body.args)
  if (!v.ok) {
    audit(admin, def.id, 'invalid-args')
    return NextResponse.json({ status: 'error', speech: v.error }, { status: 400, headers: noStore })
  }

  if (def.sensitivity === 'sensitive') {
    const secret = process.env.SESSION_SECRET
    if (!secret) {
      // Fail closed: sensitive actions are never allowed on the built-in fallback secret.
      audit(admin, def.id, 'blocked-no-secret')
      return NextResponse.json(
        { status: 'error', speech: 'Sensitive voice actions are disabled until the server secret is configured.' },
        { status: 503, headers: noStore },
      )
    }
    const digest = argsDigest(v.args)
    const phrase = def.confirmPhrase!(v.args)

    if (!body.confirm) {
      const ch = issueChallenge(secret, def.id, digest, admin, Date.now())
      audit(admin, def.id, 'confirmation-issued')
      return NextResponse.json(
        {
          status: 'confirmation_required',
          speech: `This is a sensitive action. Type exactly: ${phrase}`,
          prompt: phrase,
          confirmToken: ch.token,
          expiresAt: ch.expiresAt,
          ttlMs: CONFIRM_TTL_MS,
        },
        { headers: noStore },
      )
    }

    const tokenOk = verifyChallenge(secret, body.confirm.token, { commandId: def.id, digest, admin }, Date.now())
    const phraseOk = normalizePhrase(String(body.confirm.phrase ?? '')) === normalizePhrase(phrase)
    if (!tokenOk || !phraseOk) {
      audit(admin, def.id, 'confirmation-failed')
      return NextResponse.json(
        { status: 'denied', speech: 'The confirmation did not match or has expired. Nothing was changed.' },
        { status: 403, headers: noStore },
      )
    }
  }

  try {
    const result = await def.run(v.args)
    // Navigation is only ever returned for allow-listed routes.
    const navigate = result.navigate && (NAV_ALLOWLIST as readonly string[]).includes(result.navigate) ? result.navigate : undefined
    audit(admin, def.id, 'ok')
    return NextResponse.json({ status: 'ok', speech: result.speech, navigate, data: result.data ?? null }, { headers: noStore })
  } catch (e) {
    console.error('[voice-command] failed:', def.id, e)
    audit(admin, def.id, 'error')
    return NextResponse.json(
      { status: 'error', speech: 'That command failed. Nothing else was changed.' },
      { status: 500, headers: noStore },
    )
  }
}
