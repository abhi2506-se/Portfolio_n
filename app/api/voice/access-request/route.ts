import { NextRequest, NextResponse } from 'next/server'
import { getOrCreateDeviceId } from '@/lib/device-id'
import { getVisitorForChat, ownsChat } from '@/lib/live-chat-identity'
import { lazySql as sql } from '@/lib/neon-lazy'
import { isMissingTable } from '@/lib/voice/permissions-db'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * POST { chatId } — a live chat visitor asks for voice access for their OWN chat.
 * Creates a pending request (one open request per chat). Never reveals what, if anything, is granted.
 * Only the chat's owner (device or signed-in visitor) can ask.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const chatId = body && typeof body.chatId === 'string' ? body.chatId.slice(0, 200) : ''
  if (!chatId) return NextResponse.json({ error: 'chatId required.' }, { status: 400, headers: noStore })

  const { deviceId } = getOrCreateDeviceId(req)
  try {
    const visitor = await getVisitorForChat(req)
    const [row] = (await sql`SELECT device_id, visitor_id, user_name FROM live_chats WHERE id = ${chatId}`) as any[]
    if (!row || !ownsChat(row, deviceId, visitor?.visitorId ?? null)) {
      return NextResponse.json({ error: 'Not allowed.' }, { status: 403, headers: noStore })
    }
    const [open] = (await sql`SELECT id FROM voice_access_requests WHERE chat_id = ${chatId} AND status = 'pending'`) as any[]
    if (open) return NextResponse.json({ status: 'pending' }, { headers: noStore })

    const now = Date.now()
    await sql`INSERT INTO voice_access_requests (id, chat_id, user_name, status, requested_at)
      VALUES (${`var_${now}_${Math.random().toString(36).slice(2, 8)}`}, ${chatId}, ${String(row.user_name || 'Visitor').slice(0, 100)}, 'pending', ${now})`
    console.info(JSON.stringify({ ts: new Date().toISOString(), area: 'voice-access', action: 'request', chatId }))
    return NextResponse.json({ status: 'pending' }, { headers: noStore })
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: 'Voice access is not available yet.' }, { status: 503, headers: noStore })
    console.error('[voice-access] request failed:', e)
    return NextResponse.json({ error: 'Could not send the request. Please try again.' }, { status: 500, headers: noStore })
  }
}
