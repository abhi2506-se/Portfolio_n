export const runtime = 'nodejs'
import { NextResponse } from 'next/server'
import { getEnabledLocales } from '@/lib/i18n/translations-db'

/** Languages currently enabled by the admin (used by the language switcher). */
export async function GET() {
  const set = await getEnabledLocales()
  return NextResponse.json({ enabled: Array.from(set) }, { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' } })
}
