/**
 * i18n configuration — single source of truth for languages.
 * Adding a language = add an entry here + a folder lib/i18n/messages/<code>/ (site.ts, user.ts)
 * + one line in lib/i18n/messages/index.ts. No component changes needed.
 */
export type Locale = 'en' | 'hi' | 'de' | 'fr' | 'es' | 'haryanvi'

export interface LocaleInfo {
  code: Locale
  /** Name in its own language (shown in the switcher). */
  native: string
  english: string
  flag: string
  dir: 'ltr' | 'rtl'
  /** BCP-47 tag for <html lang>, hreflang and Intl formatting. */
  tag: string
  /** Tag used for Intl (dates/numbers) — may differ from `tag` for dialects. */
  intl: string
  /** Open Graph locale. */
  og: string
  /** Has its own URL prefix (/hi …) and is indexed. English is the unprefixed default. */
  routed: boolean
  /** Languages to fall back to, in order, before English, when a key is missing. */
  fallback?: Locale[]
}

export const LOCALES: LocaleInfo[] = [
  { code: 'en', native: 'English', english: 'English', flag: '🇬🇧', dir: 'ltr', tag: 'en', intl: 'en-IN', og: 'en_IN', routed: false },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', flag: '🇮🇳', dir: 'ltr', tag: 'hi', intl: 'hi-IN', og: 'hi_IN', routed: true },
  { code: 'de', native: 'Deutsch', english: 'German', flag: '🇩🇪', dir: 'ltr', tag: 'de', intl: 'de-DE', og: 'de_DE', routed: true },
  { code: 'fr', native: 'Français', english: 'French', flag: '🇫🇷', dir: 'ltr', tag: 'fr', intl: 'fr-FR', og: 'fr_FR', routed: true },
  { code: 'es', native: 'Español', english: 'Spanish', flag: '🇪🇸', dir: 'ltr', tag: 'es', intl: 'es-ES', og: 'es_ES', routed: true },
  // Pre-existing dialect option, kept so nobody loses it. Cookie-only: no URL prefix, not indexed
  // (it has no ISO 639-1 code), canonical points at the English page.
  { code: 'haryanvi', native: 'हरियाणवी', english: 'Haryanvi', flag: '🇮🇳', dir: 'ltr', tag: 'hi', intl: 'hi-IN', og: 'hi_IN', routed: false, fallback: ['hi'] },
]

export const DEFAULT_LOCALE: Locale = 'en'
export const LOCALE_CODES = LOCALES.map(l => l.code)
/** Locales that get a URL prefix. */
export const PREFIXED_LOCALES = LOCALES.filter(l => l.routed).map(l => l.code)
/** Locales that are indexed / get hreflang entries (English + prefixed ones). */
export const INDEXED_LOCALES = LOCALES.filter(l => l.routed || l.code === DEFAULT_LOCALE).map(l => l.code)

export const LANG_COOKIE = 'portfolio_lang'
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
export const LOCALE_HEADER = 'x-locale'
export const PATH_HEADER = 'x-pathname'

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALE_CODES as string[]).includes(v)
}
export function parseLocale(v: unknown): Locale { return isLocale(v) ? v : DEFAULT_LOCALE }
export function localeInfo(code: Locale): LocaleInfo { return LOCALES.find(l => l.code === code) || LOCALES[0] }
