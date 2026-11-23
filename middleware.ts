/**
 * Locale routing.
 *   /hi/…  /de/…  /fr/…  /es/…   → internal rewrite to the same page without the prefix; locale in a request header
 *   /en/…                         → 308 to the unprefixed (canonical English) URL
 *   anything else                 → locale from the language cookie (default English)
 * English URLs stay exactly as they were, so existing links and SEO are untouched.
 * Admin/portal/visitor/API routes never get a prefix; they follow the cookie.
 */
import { NextResponse, type NextRequest } from 'next/server'
import {
  DEFAULT_LOCALE, LANG_COOKIE, LANG_COOKIE_MAX_AGE, LOCALE_HEADER, PATH_HEADER, PREFIXED_LOCALES, isLocale, type Locale,
} from '@/lib/i18n/config'
import { isLocalizablePath, stripLocale } from '@/lib/i18n/paths'

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const { locale: prefixed, path } = stripLocale(pathname)

  if (prefixed === 'en') {
    const url = req.nextUrl.clone(); url.pathname = path
    return NextResponse.redirect(url, 308)
  }

  if (prefixed && PREFIXED_LOCALES.includes(prefixed)) {
    if (!isLocalizablePath(path)) { // e.g. /hi/admin → not a localized area
      const url = req.nextUrl.clone(); url.pathname = path
      return NextResponse.redirect(url, 308)
    }
    return respond(req, 'rewrite', path, search, prefixed, true)
  }

  const cookie = req.cookies.get(LANG_COOKIE)?.value
  const locale: Locale = isLocale(cookie) ? cookie : DEFAULT_LOCALE
  return respond(req, 'next', pathname, search, locale, false)
}

function respond(req: NextRequest, mode: 'rewrite' | 'next', path: string, search: string, locale: Locale, setCookie: boolean) {
  const headers = new Headers(req.headers)
  headers.set(LOCALE_HEADER, locale)
  headers.set(PATH_HEADER, path)
  let res: NextResponse
  if (mode === 'rewrite') { const url = req.nextUrl.clone(); url.pathname = path; res = NextResponse.rewrite(url, { request: { headers } }) }
  else res = NextResponse.next({ request: { headers } })
  if (setCookie && req.cookies.get(LANG_COOKIE)?.value !== locale) {
    res.cookies.set(LANG_COOKIE, locale, { path: '/', maxAge: LANG_COOKIE_MAX_AGE, sameSite: 'lax' })
  }
  return res
}

export const config = {
  // Skip static assets, Next internals, API and service-worker/manifest files.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
}
