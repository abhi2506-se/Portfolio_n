'use client'
import { useCallback, useEffect, useState } from 'react'

export type PushState = 'loading' | 'unsupported' | 'unconfigured' | 'denied' | 'default' | 'subscribed' | 'granted-unsubscribed'

function b64ToU8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

/** Web Push opt-in. Permission is requested ONLY inside enable(), i.e. on an explicit click. */
export function usePushSubscription() {
  const [state, setState] = useState<PushState>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  const sync = useCallback(async () => {
    if (!supported) return setState('unsupported')
    try {
      const info = await (await fetch('/api/notifications/push', { cache: 'no-store' })).json()
      if (!info.configured) return setState('unconfigured')
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (Notification.permission !== 'granted') return setState('default')
      if (!sub) return setState('granted-unsubscribed')
      // Re-POST to refresh/rebind to the CURRENT identity (login/logout on this browser, key rotation).
      const r = await fetch('/api/notifications/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
      setState(r.ok ? 'subscribed' : 'granted-unsubscribed')
    } catch { setState('default') }
  }, [supported])

  useEffect(() => { sync() }, [sync])

  const enable = useCallback(async () => {
    if (!supported) return
    setBusy(true); setError(null)
    try {
      const info = await (await fetch('/api/notifications/push', { cache: 'no-store' })).json()
      if (!info.publicKey) { setError('unavailable'); return }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'default'); return }
      const reg = (await navigator.serviceWorker.getRegistration('/')) || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }))
      await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(info.publicKey) })
      const r = await fetch('/api/notifications/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) })
      if (!r.ok) throw new Error('save failed')
      setState('subscribed')
    } catch { setError('enable') } finally { setBusy(false) }
  }, [supported])

  const disable = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/notifications/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setState('granted-unsubscribed')
    } finally { setBusy(false) }
  }, [])

  return { state, busy, error, enable, disable, resync: sync }
}
