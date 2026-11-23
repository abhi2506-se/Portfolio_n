export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { isLocale } from '@/lib/i18n/config'
import { getPublishedMap } from '@/lib/i18n/translations-db'

/**
 * Published translations for one language: { "project:slug": { title, description, "features.0": … }, … }
 * Only status=published AND matching the current English text is returned — everything else falls back to English on the site.
 * Public + cacheable (60 s at the edge); admin publishes show up within a minute.
 */
export async function GET(req: NextRequest) {
  const locale = req.nextUrl.searchParams.get('locale')
  if (!isLocale(locale) || locale === 'en') return NextResponse.json({ locale: 'en', items: {} })
  try {
    return NextResponse.json({ locale, items: await getPublishedMap(locale) }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  } catch (err) {
    console.error('[i18n/content] failed:', err)
    return NextResponse.json({ locale, items: {} })   // site keeps working in English
  }
}
