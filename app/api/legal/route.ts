import { NextRequest, NextResponse } from 'next/server'
import { dbGetSettings } from '@/lib/db'
import { isLocale } from '@/lib/i18n/config'
import { getPublishedMap } from '@/lib/i18n/translations-db'

/**
 * GET /api/legal                → English originals (unchanged response shape)
 * GET /api/legal?locale=de      → same, plus `translated`: { privacy_policy?, terms_of_service? } holding ONLY manually reviewed + published
 *                                 translations whose source text hasn't changed since. Missing → absent (page shows the English original).
 */
export async function GET(req: NextRequest) {
  const locale = req.nextUrl.searchParams.get('locale')
  try {
    const settings = await dbGetSettings()
    const body: Record<string, any> = { privacy_policy: settings.privacy_policy ?? '', terms_of_service: settings.terms_of_service ?? '' }
    if (isLocale(locale) && locale !== 'en') {
      const map = await getPublishedMap(locale).catch(() => ({}))
      const translated: Record<string, string> = {}
      const pp = (map as any)['legal:privacy-policy']?.body, tos = (map as any)['legal:terms-of-service']?.body
      if (pp) translated.privacy_policy = pp
      if (tos) translated.terms_of_service = tos
      body.translated = translated
    }
    return NextResponse.json(body)
  } catch (e) {
    console.error('[legal] get error:', e)
    return NextResponse.json({ privacy_policy: '', terms_of_service: '' })
  }
}
