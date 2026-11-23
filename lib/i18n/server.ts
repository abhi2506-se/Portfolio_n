import { headers } from 'next/headers'
import { DEFAULT_LOCALE, LOCALE_HEADER, PATH_HEADER, parseLocale, type Locale } from './config'
import { getEnabledLocales } from './translations-db'

/** Locale for this request: from middleware, but never a language the admin has switched off. Never throws. */
export async function getRequestLocale(): Promise<{ locale: Locale; path: string }> {
  const h = await headers()
  let locale = parseLocale(h.get(LOCALE_HEADER))
  if (locale !== DEFAULT_LOCALE) {
    try { if (!(await getEnabledLocales()).has(locale)) locale = DEFAULT_LOCALE } catch { /* keep */ }
  }
  return { locale, path: h.get(PATH_HEADER) || '/' }
}
