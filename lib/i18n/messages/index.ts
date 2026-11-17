/**
 * Message loading. Only the ACTIVE locale's namespaces are imported (webpack splits each file
 * into its own chunk), so visitors never download the other languages.
 */
import type { Locale } from '../config'
import { localeInfo } from '../config'

export type Namespace = 'site' | 'user'
export type Messages = Record<string, string>

type Loader = () => Promise<{ default: Record<string, string | undefined> }>
const L: Record<Locale, Record<Namespace, Loader>> = {
  en: { site: () => import('./en/site'), user: () => import('./en/user') },
  hi: { site: () => import('./hi/site'), user: () => import('./hi/user') },
  de: { site: () => import('./de/site'), user: () => import('./de/user') },
  fr: { site: () => import('./fr/site'), user: () => import('./fr/user') },
  es: { site: () => import('./es/site'), user: () => import('./es/user') },
  haryanvi: { site: () => import('./haryanvi/site'), user: () => import('./haryanvi/user') },
}
export const ALL_NAMESPACES: Namespace[] = ['site', 'user']

const cache = new Map<string, Promise<Messages>>()

/** English ← fallback locales ← locale, so a missing key never renders as a raw key for dialect locales. */
export function loadMessages(locale: Locale, namespaces: Namespace[] = ALL_NAMESPACES): Promise<Messages> {
  const key = `${locale}:${namespaces.join(',')}`
  let p = cache.get(key)
  if (!p) {
    const chain: Locale[] = [...(localeInfo(locale).fallback || []), locale]
    p = (async () => {
      const out: Messages = {}
      for (const loc of chain) {
        for (const ns of namespaces) {
          const mod = await L[loc][ns]()
          for (const [k, v] of Object.entries(mod.default)) if (typeof v === 'string') out[k] = v
        }
      }
      return out
    })()
    cache.set(key, p)
  }
  return p
}
