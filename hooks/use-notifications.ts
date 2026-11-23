'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseBrowserClient, chatChannelName } from '@/lib/supabase-realtime'
import type { NotificationItem } from '@/lib/notification-types'

interface Opts { category?: string | null; unreadOnly?: boolean; pageSize?: number; enabled?: boolean }

/** Notification list with optimistic updates, realtime refresh (Supabase) and a polling fallback. */
export function useNotifications({ category = null, unreadOnly = false, pageSize = 20, enabled = true }: Opts = {}) {
  const [items, setItems] = useState<NotificationItem[]>([])
  const [unread, setUnread] = useState(0)
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<'load' | 'more' | null>(null)
  const [identity, setIdentity] = useState<'none' | 'guest' | 'visitor'>('none')
  const [channel, setChannel] = useState<string | null>(null)
  const seq = useRef(0)

  const qs = useCallback((c?: string | null) => {
    const p = new URLSearchParams({ limit: String(pageSize) })
    if (category) p.set('category', category)
    if (unreadOnly) p.set('unread', '1')
    if (c) p.set('cursor', c)
    return p.toString()
  }, [category, unreadOnly, pageSize])

  const refresh = useCallback(async (silent = false) => {
    const my = ++seq.current
    if (!silent) setLoading(true)
    try {
      const r = await fetch(`/api/notifications?${qs()}`, { cache: 'no-store' })
      if (!r.ok) throw new Error('bad status')
      const d = await r.json()
      if (my !== seq.current) return
      setItems(d.items || []); setUnread(d.unread || 0); setCursor(d.nextCursor || null)
      setChannel(d.channel || null); setIdentity(d.identity === 'visitor' ? 'visitor' : d.identity === 'guest' ? 'guest' : 'none')
      setError(null)
    } catch {
      if (my === seq.current) setError('load')
    } finally { if (my === seq.current && !silent) setLoading(false) }
  }, [qs])

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const r = await fetch(`/api/notifications?${qs(cursor)}`, { cache: 'no-store' })
      if (!r.ok) throw new Error('bad status')
      const d = await r.json()
      setItems(prev => { const seen = new Set(prev.map(i => i.id)); return [...prev, ...(d.items || []).filter((i: NotificationItem) => !seen.has(i.id))] })
      setCursor(d.nextCursor || null)
    } catch { setError('more') } finally { setLoading(false) }
  }, [cursor, loading, qs])

  const act = useCallback(async (body: Record<string, unknown>) => {
    try {
      const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!r.ok) throw new Error()
    } catch { refresh(true) } // roll back optimistic change by re-syncing
  }, [refresh])

  const markRead = useCallback((id: string) => {
    setItems(p => p.map(i => i.id === id && !i.readAt ? { ...i, readAt: Date.now() } : i))
    setUnread(u => Math.max(0, u - 1))
    act({ action: 'read', ids: [id] })
  }, [act])
  const markAllRead = useCallback(() => {
    setItems(p => p.map(i => i.readAt ? i : { ...i, readAt: Date.now() })); setUnread(0); act({ action: 'read_all' })
  }, [act])
  const remove = useCallback((id: string) => {
    setItems(p => { const it = p.find(i => i.id === id); if (it && !it.readAt) setUnread(u => Math.max(0, u - 1)); return p.filter(i => i.id !== id) })
    act({ action: 'delete', id })
  }, [act])
  const clearRead = useCallback(() => { setItems(p => p.filter(i => !i.readAt)); act({ action: 'clear_read' }) }, [act])

  useEffect(() => { if (enabled) refresh() }, [enabled, refresh])

  // Realtime: the channel id is unguessable and carries only {t:'changed'}.
  const realtime = useRef(false)
  useEffect(() => {
    realtime.current = false
    if (!enabled || !channel) return
    const client = getSupabaseBrowserClient()
    if (!client) return
    const ch = client.channel(chatChannelName(channel), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'notif' }, () => refresh(true))
      .subscribe(status => { realtime.current = status === 'SUBSCRIBED' })
    return () => { realtime.current = false; client.removeChannel(ch) }
  }, [enabled, channel, refresh])

  // Refetch on focus/online; poll only when realtime isn't connected.
  useEffect(() => {
    if (!enabled) return
    const onVis = () => { if (document.visibilityState === 'visible') refresh(true) }
    const onOnline = () => refresh(true)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    const t = setInterval(() => { if (document.visibilityState === 'visible' && !realtime.current) refresh(true) }, 45_000)
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline); clearInterval(t) }
  }, [enabled, refresh])

  return { items, unread, loading, error, hasMore: !!cursor, identity, refresh, loadMore, markRead, markAllRead, remove, clearRead }
}
