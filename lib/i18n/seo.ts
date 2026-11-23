import { DEFAULT_LOCALE, INDEXED_LOCALES, localeInfo, type Locale } from './config'
import { isLocalizablePath, localizePath, stripLocale } from './paths'

const base = () => (process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '')

/** Absolute URL of `path` in `locale`. */
export function localizedUrl(path: string, locale: Locale): string {
  const p = localizePath(stripLocale(path).path, locale)
  return base() + (p === '/' ? '' : p) || base() + '/'
}

/**
 * canonical + hreflang for a page.
 *  • indexed locale → canonical is its own localized URL (no duplicate-content between languages)
 *  • cookie-only dialect (haryanvi) → canonical is the English URL
 *  • non-localized pages (admin, portal…) → plain canonical, no hreflang
 */
export function buildAlternates(path: string, locale: Locale) {
  const clean = stripLocale(path).path
  if (!isLocalizablePath(clean)) return { canonical: base() + clean }
  const canonLocale: Locale = INDEXED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE
  const languages: Record<string, string> = {}
  for (const code of INDEXED_LOCALES) languages[localeInfo(code).tag] = localizedUrl(clean, code)
  languages['x-default'] = localizedUrl(clean, DEFAULT_LOCALE)
  return { canonical: localizedUrl(clean, canonLocale), languages }
}
