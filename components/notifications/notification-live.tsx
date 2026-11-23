'use client'
/**
 * Makes notifications come TO the visitor instead of waiting in the bell:
 *  • a pop-up card the moment a new notification arrives (realtime / next poll);
 *  • a one-tap "Allow notifications" card (visitors, or guests who opened live chat),
 *    so replies reach them even when the tab is closed. Permission is only requested on that click.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, BellRing, X } from 'lucide-react'
import { useNotifications } from '@/hooks/use-notifications'
import { usePushSubscription } from '@/hooks/use-push-subscription'
import type { NotificationItem } from '@/lib/notification-types'
import { useLanguage } from '@/lib/language-context'

const DISMISS_KEY = 'push_prompt_dismissed_at'
const WEEK = 7 * 864e5

export function NotificationLive() {
  const pathname = usePathname() || ''
  const { t, tOr } = useLanguage()
  const off = pathname.startsWith('/admin') || pathname.startsWith('/notifications')
  const n = useNotifications({ pageSize: 5, enabled: !off })
  const push = usePushSubscription()
  const [popup, setPopup] = useState<NotificationItem | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const [promptHidden, setPromptHidden] = useState(true)

  // Pop up anything unread that wasn't there on the first load.
  useEffect(() => {
    if (off || n.loading) return
    if (seen.current === null) { seen.current = new Set(n.items.map(i => i.id)); return }
    const fresh = n.items.find(i => !i.readAt && !seen.current!.has(i.id))
    n.items.forEach(i => seen.current!.add(i.id))
    if (fresh) setPopup(fresh)
  }, [n.items, n.loading, off])

  useEffect(() => { if (!popup) return; const t = setTimeout(() => setPopup(null), 8000); return () => clearTimeout(t) }, [popup])

  // Decide whether to offer push.
  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) || 0)
      const chatted = !!localStorage.getItem('lc_owner')
      setPromptHidden(!(Date.now() - at > WEEK && (n.identity === 'visitor' || chatted)))
    } catch { setPromptHidden(true) }
  }, [n.identity, pathname])

  const showPrompt = !off && !promptHidden && !popup && push.state === 'default'
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch {}; setPromptHidden(true) }

  if (off) return null
  return (
    <div className="pointer-events-none fixed right-3 top-16 z-[60] flex w-[min(92vw,22rem)] flex-col gap-2 sm:right-5" aria-live="polite">
      {popup && (
        <div role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-xl">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500"><Bell className="h-4 w-4" /></span>
          <Link href={popup.url || '/notifications'} onClick={() => { n.markRead(popup.id); setPopup(null) }} className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug">{tOr(`notif.${popup.type}.title`, popup.title, popup.data as any)}</p>
            {popup.body && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{tOr(`notif.${popup.type}.body`, popup.body, popup.data as any)}</p>}
          </Link>
          <button aria-label={t('notifications.close')} onClick={() => setPopup(null)} className="rounded p-1 text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {showPrompt && (
        <div className="pointer-events-auto rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-500/10 text-violet-500"><BellRing className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('push.prompt.title')}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t('push.prompt.body')}</p>
              {push.error && <p role="alert" className="mt-1 text-xs text-red-500">{t(push.error === 'unavailable' ? 'push.error_unavailable' : 'push.error_enable')}</p>}
              <div className="mt-2 flex gap-2">
                <button onClick={async () => { await push.enable() }} disabled={push.busy} className="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60">{t('push.prompt.allow')}</button>
                <button onClick={dismiss} className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary">{t('push.prompt.not_now')}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
