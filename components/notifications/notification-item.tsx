'use client'
import Link from 'next/link'
import { MessageCircle, Globe, UserCircle, ShieldAlert, Info, X } from 'lucide-react'
import type { NotificationItem, NotificationCategory } from '@/lib/notification-types'
import { useLanguage } from '@/lib/language-context'

const ICONS: Record<NotificationCategory, any> = { live_chat: MessageCircle, website: Globe, account: UserCircle, security: ShieldAlert, system: Info }
const TONE: Record<NotificationCategory, string> = {
  live_chat: 'text-violet-500 bg-violet-500/10', website: 'text-blue-500 bg-blue-500/10', account: 'text-emerald-500 bg-emerald-500/10',
  security: 'text-amber-500 bg-amber-500/10', system: 'text-muted-foreground bg-secondary',
}

export function NotificationRow({ n, onRead, onRemove, onNavigate }: { n: NotificationItem; onRead: (id: string) => void; onRemove: (id: string) => void; onNavigate?: () => void }) {
  const { tOr, t, formatRelative } = useLanguage()
  const Icon = ICONS[n.category] || Info
  // Server-authored notifications carry a type; show the translated text when we have one, else the stored text.
  const params = (n.data || undefined) as Record<string, string | number> | undefined
  const title = tOr(`notif.${n.type}.title`, n.title, params)
  const body = tOr(`notif.${n.type}.body`, n.body, params)
  const inner = (
    <div className="flex items-start gap-3 min-w-0">
      <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${TONE[n.category]}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug ${n.readAt ? 'text-muted-foreground' : 'font-semibold text-foreground'}`}>{title}</p>
        {body && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{body}</p>}
        <p className="mt-1 text-[10px] text-muted-foreground/70">{formatRelative(n.createdAt)}</p>
      </div>
      {!n.readAt && <span aria-label={t('notifications.unread_dot')} className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-violet-500" />}
    </div>
  )
  const click = () => { if (!n.readAt) onRead(n.id); onNavigate?.() }
  return (
    <li className="group relative border-b border-border/60 last:border-0 hover:bg-secondary/60 transition-colors">
      {n.url
        ? <Link href={n.url} onClick={click} className="block px-3 py-3 pr-9">{inner}</Link>
        : <button type="button" onClick={click} className="block w-full px-3 py-3 pr-9 text-left">{inner}</button>}
      <button type="button" aria-label={t('notifications.dismiss')} onClick={() => onRemove(n.id)}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground/60 opacity-60 hover:opacity-100 hover:bg-secondary focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}
