export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { adminFromRequest } from '@/lib/admin-request'
import { setLocaleEnabled } from '@/lib/i18n/translations-db'

/** Enable/disable a language site-wide. Body: { locale, enabled }. English cannot be disabled. */
export async function PUT(req: NextRequest) {
  if (!adminFromRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => null)
  try {
    await setLocaleEnabled(String(b?.locale), !!b?.enabled)
    return NextResponse.json({ ok: true })
  } catch (e: any) { return NextResponse.json({ error: e?.message || 'Failed' }, { status: 400 }) }
}
