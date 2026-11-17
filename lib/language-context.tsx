'use client'
/**
 * Language provider (client). The locale and its messages are decided on the SERVER
 * (middleware → layout) and passed in as props, so first paint is already in the right
 * language — no localStorage flash, no hydration mismatch.
 *
 * API kept compatible with the old provider: useLanguage() → { language, setLanguage, t }.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import {
  DEFAULT_LOCALE, LANG_COOKIE, LANG_COOKIE_MAX_AGE, localeInfo, type Locale, type LocaleInfo,
} from '@/lib/i18n/config'
import { localizePath, stripLocale } from '@/lib/i18n/paths'
import { createT, createTOr, formatDate, formatNumber, formatRelative, type Params } from '@/lib/i18n/translate'
import type { Messages } from '@/lib/i18n/messages'

export type Language = Locale

interface Ctx {
  language: Locale
  info: LocaleInfo
  dir: 'ltr' | 'rtl'
  setLanguage: (lang: Locale, opts?: { sync?: boolean }) => void
  t: (key: string, params?: Params) => string
  tOr: (key: string, fallback: string, params?: Params) => string
  formatDate: (d: number | Date, o?: Intl.DateTimeFormatOptions) => string
  formatNumber: (n: number, o?: Intl.NumberFormatOptions) => string
  formatRelative: (ms: number) => string
}

const LanguageContext = createContext<Ctx | undefined>(undefined)
const LS_KEY = 'portfolio_language'
const LS_AT = 'portfolio_language_at'

function persistLocally(lang: Locale) {
  try {
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`
    localStorage.setItem(LS_KEY, lang)
    localStorage.setItem(LS_AT, String(Date.now()))
  } catch {}
}

export function LanguageProvider({ children, locale, messages }: { children: React.ReactNode; locale: Locale; messages: Messages }) {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const t = useMemo(() => createT(messages), [messages])
  const tOr = useMemo(() => createTOr(messages), [messages])
  const info = localeInfo(locale)
  const first = useRef(true)

  // Keep the cookie in step with what the server rendered (e.g. visitor arrived on /de/… from a search result).
  useEffect(() => {
    if (first.current) { first.current = false; try { if (!document.cookie.includes(`${LANG_COOKIE}=${locale}`)) persistLocally(locale) } catch {} }
  }, [locale])

  const setLanguage = useCallback((lang: Locale, opts: { sync?: boolean } = {}) => {
    if (lang === locale) return
    persistLocally(lang)
    // Save to the account when signed in (for guests the server just ignores it).
    if (opts.sync !== false) fetch('/api/i18n/preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: lang }) }).catch(() => {})
    const { path } = stripLocale(pathname)
    const target = localizePath(path, lang)
    const rest = (typeof window !== 'undefined' ? window.location.search + window.location.hash : '')
    if (target === pathname) router.refresh()          // same URL (private pages): re-render with the new cookie
    else router.push(target + rest)                     // localized public page: no full reload
  }, [locale, pathname, router])

  const value = useMemo<Ctx>(() => ({
    language: locale, info, dir: info.dir, setLanguage, t, tOr,
    formatDate: (d, o) => formatDate(d, locale, o),
    formatNumber: (n, o) => formatNumber(n, locale, o),
    formatRelative: ms => formatRelative(ms, locale),
  }), [locale, info, setLanguage, t, tOr])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

const fallbackContext: Ctx = {
  language: DEFAULT_LOCALE, info: localeInfo(DEFAULT_LOCALE), dir: 'ltr', setLanguage: () => {},
  t: k => k, tOr: (_k, f) => f, // outside the provider (e.g. /_not-found): never a crash
  formatDate: d => new Date(d).toISOString().slice(0, 10), formatNumber: n => String(n), formatRelative: () => '',
}

export function useLanguage(): Ctx { return useContext(LanguageContext) ?? fallbackContext }
