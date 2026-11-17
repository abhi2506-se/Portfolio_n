export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { LANG_COOKIE, parseLocale } from '@/lib/i18n/config'
import { getOrCreateDeviceId, attachDeviceCookie } from '@/lib/device-id'
import { resolveRecipient, type Recipient } from '@/lib/notification-center'
import { pushConfigured, parseSubscription, savePushSubscription, removePushSubscription, hasPushSubscription } from '@/lib/notification-push'

const noStore = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const me = await resolveRecipient(req)
  const endpoint = req.nextUrl.searchParams.get('endpoint')
  return NextResponse.json({
    configured: pushConfigured(),
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
    subscribed: me ? await hasPushSubscription(me.key, endpoint).catch(() => false) : false,
  }, { headers: noStore })
}

/** Subscribe (or refresh/rebind). A guest device cookie is created ONLY here, on an explicit opt-in. */
export async function POST(req: NextRequest) {
  if (!pushConfigured()) return NextResponse.json({ error: 'Push is not configured' }, { status: 503, headers: noStore })
  const body = await req.json().catch(() => null)
  const sub = parseSubscription(body?.subscription)
  if (!sub) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400, headers: noStore })
  let me: Recipient | null = await resolveRecipient(req)
  let newToken: string | null = null
  if (!me) {
    const d = getOrCreateDeviceId(req)
    me = { key: `g:${d.deviceId}`, kind: 'guest' }
    if (d.isNew) newToken = d.token
  }
  const oldEndpoint = typeof body?.oldEndpoint === 'string' ? body.oldEndpoint : null
  await savePushSubscription(me.key, sub, req.headers.get('user-agent') || '', oldEndpoint, parseLocale(req.cookies.get(LANG_COOKIE)?.value))
  const res = NextResponse.json({ ok: true, identity: me.kind }, { headers: noStore })
  if (newToken) attachDeviceCookie(res, newToken)
  return res
}

export async function DELETE(req: NextRequest) {
  const me = await resolveRecipient(req)
  const body = await req.json().catch(() => null)
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null
  if (me && endpoint) await removePushSubscription(me.key, endpoint)
  return NextResponse.json({ ok: true }, { headers: noStore })
}
