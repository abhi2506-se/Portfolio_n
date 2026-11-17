export const runtime = 'nodejs'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/admin-auth'
import { broadcastNotification } from '@/lib/notification-center'
import { safeRelativeUrl } from '@/lib/notification-types'

/** Admin → every visitor (in-app + Web Push). Body: { title, body?, url?, category?: 'website'|'system' } */
export async function POST(req: NextRequest) {
  const c = req.cookies.get('portfolio_admin_session')?.value
  let ok = false
  try { ok = !!c && !!verifyToken(c) } catch {}
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const title = typeof b.title === 'string' ? b.title.trim() : ''
  if (!title || title.length > 140) return NextResponse.json({ error: 'Title is required (max 140 characters)' }, { status: 400 })
  const url = b.url ? safeRelativeUrl(b.url) : null
  if (b.url && !url) return NextResponse.json({ error: 'URL must be a relative path such as /blog' }, { status: 400 })
  const type = b.category === 'system' ? 'system.notice' : 'site.announcement'
  const recipients = await broadcastNotification({
    type, title, body: typeof b.body === 'string' ? b.body.trim().slice(0, 400) : '', url,
    dedupeKey: `ann_${Date.now().toString(36)}`,
  })
  return NextResponse.json({ ok: true, recipients })
}
