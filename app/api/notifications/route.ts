export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import {
  resolveRecipient, listNotifications, markRead, markAllRead, deleteNotification, clearRead, recipientChannel,
} from '@/lib/notification-center'

const noStore = { 'Cache-Control': 'no-store' }
const EMPTY = { items: [], nextCursor: null, unread: 0, channel: null, identity: 'none' }

export async function GET(req: NextRequest) {
  try {
    const me = await resolveRecipient(req)
    if (!me) return NextResponse.json(EMPTY, { headers: noStore })
    const p = req.nextUrl.searchParams
    const data = await listNotifications(me.key, {
      limit: Number(p.get('limit')) || 20, cursor: p.get('cursor'), category: p.get('category'), unreadOnly: p.get('unread') === '1',
    })
    return NextResponse.json({ ...data, channel: recipientChannel(me.key), identity: me.kind }, { headers: noStore })
  } catch (err) {
    console.error('[api/notifications] GET failed:', err)
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500, headers: noStore })
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await resolveRecipient(req)
    if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
    const body = await req.json().catch(() => ({}))
    switch (body?.action) {
      case 'read': await markRead(me.key, Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : []); break
      case 'read_all': await markAllRead(me.key); break
      case 'delete': if (typeof body.id === 'string') await deleteNotification(me.key, body.id); break
      case 'clear_read': await clearRead(me.key); break
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400, headers: noStore })
    }
    return NextResponse.json({ ok: true }, { headers: noStore })
  } catch (err) {
    console.error('[api/notifications] POST failed:', err)
    return NextResponse.json({ error: 'Could not update notifications' }, { status: 500, headers: noStore })
  }
}
