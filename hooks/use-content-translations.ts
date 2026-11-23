'use client'
import { useEffect, useState } from 'react'
import { useLanguage } from '@/lib/language-context'
import type { TranslationMap } from '@/lib/i18n/content-apply'

/** One request per language per page load, shared by every component (the response is also edge-cached for 60 s). */
const cache = new Map<string, Promise<TranslationMap>>()
function load(locale: string): Promise<TranslationMap> {
  let p = cache.get(locale)
  if (!p) {
    p = fetch(`/api/i18n/content?locale=${locale}`).then(r => (r.ok ? r.json() : { items: {} })).then(d => d.items || {}).catch(() => ({}))
    cache.set(locale, p)
    setTimeout(() => cache.delete(locale), 5 * 60_000)   // pick up newly published translations without a reload
  }
  return p
}

/** Published translations for the active language ({} for English, while loading, or if none exist). */
export function useContentTranslations(): { map: TranslationMap; loaded: boolean; language: string } {
  const { language } = useLanguage()
  const [state, setState] = useState<{ locale: string; map: TranslationMap } | null>(null)
  useEffect(() => {
    if (language === 'en') return
    let off = false
    load(language).then(map => { if (!off) setState({ locale: language, map }) })
    return () => { off = true }
  }, [language])
  if (language === 'en') return { map: {}, loaded: true, language }
  const ready = state?.locale === language
  return { map: ready ? state!.map : {}, loaded: ready, language }
}
