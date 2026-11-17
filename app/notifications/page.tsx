'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, CheckCheck, Trash2, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/hooks/use-notifications'
import { NotificationRow } from '@/components/notifications/notification-item'
import { PushSettings } from '@/components/notifications/push-settings'
import { CATEGORIES } from '@/lib/notification-types'
import { useLanguage } from '@/lib/language-context'

export default function NotificationsPage() {
  const [category, setCategory] = useState<string | null>(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const n = useNotifications({ category, unreadOnly, pageSize: 20 })
  const { t } = useLanguage()
  const tab = (active: boolean) => `rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? 'border-violet-500 bg-violet-500/10 text-violet-500' : 'border-border text-muted-foreground hover:bg-secondary'}`
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <Link href="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> {t('notifications.back')}</Link>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('notifications.title')}{n.unread > 0 && <span className="ml-2 text-sm font-medium text-violet-500">{t('notifications.unread_count', { count: n.unread })}</span>}</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={n.markAllRead} disabled={!n.unread}><CheckCheck className="mr-1 h-3.5 w-3.5" /> {t('notifications.mark_all_read')}</Button>
          <Button size="sm" variant="outline" onClick={n.clearRead}><Trash2 className="mr-1 h-3.5 w-3.5" /> {t('notifications.clear_read')}</Button>
        </div>
      </div>
      <PushSettings />
      <div className="my-4 flex flex-wrap items-center gap-2" role="tablist" aria-label={t('notifications.filter_aria')}>
        <button className={tab(!category)} onClick={() => setCategory(null)}>{t('notifications.all')}</button>
        {CATEGORIES.map(c => <button key={c} className={tab(category === c)} onClick={() => setCategory(c)}>{t(`notifications.category.${c}`)}</button>)}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)} /> {t('notifications.unread_only')}
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {n.loading && !n.items.length ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('notifications.loading')}</div>
        ) : n.error && !n.items.length ? (
          <div className="py-16 text-center text-sm text-muted-foreground">{t('notifications.error_load')} <button className="text-violet-500 underline" onClick={() => n.refresh()}>{t('notifications.retry')}</button></div>
        ) : !n.items.length ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Bell className="mx-auto mb-2 h-7 w-7 opacity-40" />
            {n.identity === 'none' ? t('notifications.empty_guest') : t('notifications.empty')}
          </div>
        ) : <ul>{n.items.map(i => <NotificationRow key={i.id} n={i} onRead={n.markRead} onRemove={n.remove} />)}</ul>}
      </div>
      {n.hasMore && <div className="mt-4 text-center"><Button variant="outline" size="sm" onClick={n.loadMore} disabled={n.loading}>{n.loading ? t('notifications.loading') : t('notifications.load_more')}</Button></div>}
    </main>
  )
}
