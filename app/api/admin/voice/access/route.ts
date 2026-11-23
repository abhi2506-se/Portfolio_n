import { NextRequest, NextResponse } from 'next/server'
import { adminFromRequest } from '@/lib/admin-request'
import { lazySql as sql } from '@/lib/neon-lazy'
import { validatePermissionList } from '@/lib/voice/permissions'
import { isMissingTable } from '@/lib/voice/permissions-db'

const noStore = { 'Cache-Control': 'no-store' }
const MIGRATION_MSG = 'Voice access tables are not created yet. Apply voice-permissions.sql after approval.'

function audit(admin: string, action: string, target: string, status: string) {
  console.info(JSON.stringify({ ts: new Date().toISOString(), area: 'voice-access', admin, action, target, status }))
}

/** GET: pending and reviewed requests, plus current grants. Admin only. */
export async function GET(req: NextRequest) {
  const admin = adminFromRequest(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  try {
    const requests = await sql`SELECT id, chat_id, user_name, status, requested_at, reviewed_by, reviewed_at
      FROM voice_access_requests ORDER BY requested_at DESC LIMIT 100`
    const grants = await sql`SELECT chat_id, permissions, granted_by, granted_at, expires_at, revoked_at
      FROM voice_permissions ORDER BY granted_at DESC LIMIT 200`
    return NextResponse.json({ requests, grants }, { headers: noStore })
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MIGRATION_MSG }, { status: 503, headers: noStore })
    console.error('[voice-access] GET failed:', e)
    return NextResponse.json({ error: 'Could not load voice access.' }, { status: 500, headers: noStore })
  }
}

/**
 * POST { action, ... }
 *  approve { requestId, permissions: string[], expiresAt?: number|null }
 *  reject  { requestId }
 *  update  { chatId, permissions: string[], expiresAt?: number|null }
 *  revoke  { chatId }
 */
export async function POST(req: NextRequest) {
  const admin = adminFromRequest(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  const body = await req.json().catch(() => null)
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: noStore })
  const now = Date.now()
  const expiresAt = body.expiresAt === undefined || body.expiresAt === null ? null : Number(body.expiresAt)
  if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt <= now)) {
    return NextResponse.json({ error: 'Expiry must be a future time, or empty for no expiry.' }, { status: 400, headers: noStore })
  }

  try {
    if (body.action === 'approve' || body.action === 'update') {
      const v = validatePermissionList(body.permissions)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers: noStore })
      if (v.keys.length === 0) return NextResponse.json({ error: 'Choose at least one permission.' }, { status: 400, headers: noStore })
      const csv = v.keys.join(',')

      let chatId: string
      if (body.action === 'approve') {
        if (typeof body.requestId !== 'string') return NextResponse.json({ error: 'requestId required.' }, { status: 400, headers: noStore })
        const [r] = (await sql`SELECT chat_id FROM voice_access_requests WHERE id = ${body.requestId}`) as any[]
        if (!r) return NextResponse.json({ error: 'Request not found.' }, { status: 404, headers: noStore })
        chatId = r.chat_id
        await sql`UPDATE voice_access_requests SET status = 'approved', reviewed_by = ${admin}, reviewed_at = ${now} WHERE id = ${body.requestId}`
      } else {
        if (typeof body.chatId !== 'string') return NextResponse.json({ error: 'chatId required.' }, { status: 400, headers: noStore })
        chatId = body.chatId
      }
      // One grant per chat. Granting again (approve or update) clears any earlier revocation.
      await sql`INSERT INTO voice_permissions (id, chat_id, permissions, granted_by, granted_at, expires_at, revoked_at)
        VALUES (${`vp_${now}_${Math.random().toString(36).slice(2, 8)}`}, ${chatId}, ${csv}, ${admin}, ${now}, ${expiresAt}, NULL)
        ON CONFLICT (chat_id) DO UPDATE SET permissions = EXCLUDED.permissions, granted_by = EXCLUDED.granted_by,
          granted_at = EXCLUDED.granted_at, expires_at = EXCLUDED.expires_at, revoked_at = NULL`
      audit(admin, body.action, chatId, 'ok')
      return NextResponse.json({ ok: true, chatId, permissions: v.keys }, { headers: noStore })
    }

    if (body.action === 'reject') {
      if (typeof body.requestId !== 'string') return NextResponse.json({ error: 'requestId required.' }, { status: 400, headers: noStore })
      await sql`UPDATE voice_access_requests SET status = 'rejected', reviewed_by = ${admin}, reviewed_at = ${now} WHERE id = ${body.requestId}`
      audit(admin, 'reject', body.requestId, 'ok')
      return NextResponse.json({ ok: true }, { headers: noStore })
    }

    if (body.action === 'revoke') {
      if (typeof body.chatId !== 'string') return NextResponse.json({ error: 'chatId required.' }, { status: 400, headers: noStore })
      await sql`UPDATE voice_permissions SET revoked_at = ${now} WHERE chat_id = ${body.chatId}`
      audit(admin, 'revoke', body.chatId, 'ok')
      return NextResponse.json({ ok: true }, { headers: noStore })
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400, headers: noStore })
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: MIGRATION_MSG }, { status: 503, headers: noStore })
    console.error('[voice-access] POST failed:', e)
    audit(admin, String(body.action), '', 'error')
    return NextResponse.json({ error: 'Could not update voice access. Nothing was changed.' }, { status: 500, headers: noStore })
  }
}
