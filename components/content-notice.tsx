'use client'
import { Languages } from 'lucide-react'
import { useLanguage } from '@/lib/language-context'
import { useContentTranslations } from '@/hooks/use-content-translations'
import { hasTranslation } from '@/lib/i18n/content-apply'
import type { ContentType } from '@/lib/i18n/content-ids'

/**
 * Honest fallback: when some items of a section have no published translation (so the original English is shown),
 * say so once instead of silently mixing languages.
 */
export function ContentNotice({ type, items }: { type: ContentType; items: unknown[] }) {
  const { t } = useLanguage()
  const { map, loaded, language } = useContentTranslations()
  if (language === 'en' || !loaded || !items.length) return null
  if (items.every(i => hasTranslation(type, i, map))) return null
  return (
    <p className="mb-4 flex items-center gap-1.5 text-xs italic text-muted-foreground" role="note">
      <Languages className="h-3.5 w-3.5 flex-shrink-0" /> {t('content.unavailable')}
    </p>
  )
}
