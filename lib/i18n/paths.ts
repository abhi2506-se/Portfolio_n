/** Pure URL helpers (usable in middleware, server and client). */
import { DEFAULT_LOCALE, PREFIXED_LOCALES, type Locale } from './config'

/** Public, indexable pages that get localized URLs. Everything else (admin, portal, visitor, api…) is cookie-only. */
const LOCALIZABLE = ['/', '/journey', '/languages', '/projects', '/privacy-policy', '/terms-of-service', '/sitemap']

export function isLocalizablePath(path: string): boolean {
  if (path === '/') return true
  return LOCALIZABLE.some(p => p !== '/' && (path === p || path.startsWith(p + '/')))
}

/** "/hi/projects/x" → { locale: 'hi', path: '/projects/x' };  "/projects/x" → { locale: null, path: "/projects/x" } */
export function stripLocale(pathname: string): { locale: Locale | null; path: string } {
  const m = pathname.match(/^\/([a-z]{2})(\/.*)?$/)
  if (m) {
    const code = m[1] as Locale
    if (code === DEFAULT_LOCALE || PREFIXED_LOCALES.includes(code)) return { locale: code, path: m[2] || '/' }
  }
  return { locale: null, path: pathname || '/' }
}

/** Public URL path for `path` in `locale` (English and cookie-only locales are unprefixed). */
export function localizePath(path: string, locale: Locale): string {
  const clean = stripLocale(path).path
  if (!PREFIXED_LOCALES.includes(locale) || !isLocalizablePath(clean)) return clean
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`
}
