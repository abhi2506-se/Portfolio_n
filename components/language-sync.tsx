'use client'
/**
 * Keeps a signed-in visitor's language in sync across devices.
 *  • account pref newer than this browser's choice → adopt it (e.g. changed on another device, or just logged in)
 *  • this browser's choice newer / account empty    → save it to the account
 * Guests: nothing to do (cookie only). Runs once per page load; failures are silent.
 */
import { useEffect } from 'react'
import { useLanguage } from '@/lib/language-context'
import { isLocale } from '@/lib/i18n/config'

export function LanguageSync() {
  const { language, setLanguage } = useLanguage()
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/i18n/preference', { cache: 'no-store' })
        if (!r.ok) return
        const d = await r.json()
        if (cancelled || !d.authenticated) return
        const localAt = Number(localStorage.getItem('portfolio_language_at') || 0)
        if (isLocale(d.locale) && d.updatedAt > localAt && d.locale !== language) { setLanguage(d.locale, { sync: false }); return }
        if (!d.locale || localAt > d.updatedAt) {
          await fetch('/api/i18n/preference', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: language }) })
        }
      } catch {}
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}
