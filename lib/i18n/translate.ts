/** Message lookup + interpolation + locale-aware formatting. Pure; shared by server and client. */
import type { Locale } from './config'
import { localeInfo } from './config'
import type { Messages } from './messages'

export type Params = Record<string, string | number>

export function format(template: string, params?: Params): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
}

export function createT(messages: Messages) {
  return (key: string, params?: Params): string => {
    const v = messages[key]
    if (v === undefined) {
      if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] missing key: ${key}`)
      return key
    }
    return format(v, params)
  }
}

/** Like t(), but returns `fallback` (no warning) when the key doesn't exist — for server-authored text with optional translations. */
export function createTOr(messages: Messages) {
  return (key: string, fallback: string, params?: Params): string => {
    const v = messages[key]
    return v === undefined ? fallback : format(v, params)
  }
}

export function formatDate(ms: number | Date, locale: Locale, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  try { return new Intl.DateTimeFormat(localeInfo(locale).intl, opts).format(ms) } catch { return new Date(ms).toISOString().slice(0, 10) }
}
export function formatNumber(n: number, locale: Locale, opts?: Intl.NumberFormatOptions): string {
  try { return new Intl.NumberFormat(localeInfo(locale).intl, opts).format(n) } catch { return String(n) }
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536e6], ['month', 2592e6], ['week', 6048e5], ['day', 864e5], ['hour', 36e5], ['minute', 6e4]]
/** "5 minutes ago" / "vor 5 Minuten" / "5 मिनट पहले" — uses Intl, so no extra bundle per language. */
export function formatRelative(ms: number, locale: Locale, now = Date.now()): string {
  const diff = ms - now
  try {
    const rtf = new Intl.RelativeTimeFormat(localeInfo(locale).intl, { numeric: 'auto' })
    for (const [unit, size] of UNITS) if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit)
    return rtf.format(0, 'second')
  } catch { return formatDate(ms, locale) }
}
