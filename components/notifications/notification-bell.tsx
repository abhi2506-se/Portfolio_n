'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Bell, Loader2, CheckCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useNotifications } from '@/hooks/use-notifications'
import { useLanguage } from '@/lib/language-context'
import { NotificationRow } from '@/components/notifications/notification-item'

export function NotificationBell({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const n = useNotifications({ pageSize: 8 })
  const { t } = useLanguage()
  return (
    <Popover open={open} onOpenChange={o => { setOpen(o); if (o) n.refresh(true) }}>
      <PopoverTrigger asChild>
        <Button size="icon" variant="outline" className={`relative rounded-full ${className}`}
          aria-label={n.unread ? t('notifications.aria_unread', { count: n.unread }) : t('notifications.aria')}>
          <Bell className="w-4 h-4" />
          {n.unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-600 px-1 text-[10px] font-bold leading-none text-white">
              {n.unread > 9 ? '9+' : n.unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">{t('notifications.title')}</p>
          <button onClick={n.markAllRead} disabled={!n.unread} className="flex items-center gap-1 text-xs text-violet-500 disabled:opacity-40 hover:underline">
            <CheckCheck className="h-3.5 w-3.5" /> {t('notifications.mark_all_read')}
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {n.loading && !n.items.length ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('notifications.loading')}</div>
          ) : n.error && !n.items.length ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t('notifications.error_load')} <button className="text-violet-500 underline" onClick={() => n.refresh()}>{t('notifications.retry')}</button>
            </div>
          ) : !n.items.length ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <Bell className="mx-auto mb-2 h-6 w-6 opacity-40" /> {t('notifications.caught_up')}
            </div>
          ) : (
            <ul>{n.items.map(i => <NotificationRow key={i.id} n={i} onRead={n.markRead} onRemove={n.remove} onNavigate={() => setOpen(false)} />)}</ul>
          )}
        </div>
        <div className="border-t border-border px-3 py-2 text-center">
          <Link href="/notifications" onClick={() => setOpen(false)} className="text-xs font-medium text-violet-500 hover:underline">{t('notifications.view_all')}</Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
