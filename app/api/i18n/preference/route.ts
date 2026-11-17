export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { getVisitorForChat } from '@/lib/live-chat-identity'
import { getLanguagePref, setLanguagePref } from '@/lib/i18n/preferences'
import { isLocale } from '@/lib/i18n/config'

const noStore = { 'Cache-Control': 'no-store' }

/** Account language for the signed-in visitor (guests: authenticated=false; their choice lives in the cookie). */
export async function GET(req: NextRequest) {
  try {
    const v = await getVisitorForChat(req)
    if (!v) return NextResponse.json({ authenticated: false }, { headers: noStore })
    const pref = await getLanguagePref(`v:${v.visitorId}`)
    return NextResponse.json({ authenticated: true, locale: pref?.locale ?? null, updatedAt: pref?.updatedAt ?? 0 }, { headers: noStore })
  } catch (err) {
    console.error('[i18n] preference GET failed:', err)
    return NextResponse.json({ authenticated: false }, { headers: noStore })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!isLocale(body?.locale)) return NextResponse.json({ error: 'Unsupported language' }, { status: 400, headers: noStore })
    const v = await getVisitorForChat(req)
    if (!v) return NextResponse.json({ saved: false }, { headers: noStore })   // guest: cookie only
    await setLanguagePref(`v:${v.visitorId}`, body.locale)
    return NextResponse.json({ saved: true }, { headers: noStore })
  } catch (err) {
    console.error('[i18n] preference POST failed:', err)
    return NextResponse.json({ saved: false }, { status: 500, headers: noStore })
  }
}
