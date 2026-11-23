'use client'
import { useLanguage } from '@/lib/language-context'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Lock } from 'lucide-react'
import { Tx } from '@/components/tx'

/**
 * Idle-based screen lock. The visitor sets a PIN and an idle time in "Lock settings".
 * Typing or any other activity keeps the session open. Once there's no activity for the
 * chosen time, the site locks, and a solid cover hides the chat and the site until the
 * PIN is entered. There's no manual lock button. Nothing here recognises a face or any
 * other biometric. The lock state survives a reload.
 *
 * Never runs on /admin or /portal.
 */

const LOCK_KEY = '__vlock'            // '1' while locked
const IDLE_KEY = '__vlock_idle_s'     // idle seconds (0 = off). Seconds, so short values like 10 s work.
const IDLE_OPTIONS: { value: number; key: string }[] = [
  { value: 0, key: 'lock.never' },
  { value: 10, key: 'lock.s10' },
  { value: 30, key: 'lock.s30' },
  { value: 60, key: 'lock.m1' },
  { value: 300, key: 'lock.m5' },
  { value: 900, key: 'lock.m15' },
]

export function VisitorLock() {
  const pathname = usePathname() || ''
  const skip = pathname.startsWith('/admin') || pathname.startsWith('/portal')
  const [locked, setLocked] = useState(false)
  const [hasPin, setHasPin] = useState<boolean | null>(null)
  const [idle, setIdle] = useState(0)
  const [panel, setPanel] = useState<'none' | 'setup'>('none')
  const lastActive = useRef(Date.now())

  // Restore state. A lock from before a reload stays on.
  useEffect(() => {
    if (skip) return
    try {
      setLocked(localStorage.getItem(LOCK_KEY) === '1')
      setIdle(Number(localStorage.getItem(IDLE_KEY) || 0))
    } catch {}
    fetch('/api/visitor-lock', { cache: 'no-store', credentials: 'include' })
      .then(r => r.json())
      .then(d => setHasPin(!!d.hasPin))
      .catch(() => setHasPin(false))
  }, [skip])

  // Only the idle timer locks the site.
  const lockForIdle = () => {
    try { localStorage.setItem(LOCK_KEY, '1') } catch {}
    setLocked(true)
  }

  // Opened from the chat header menu
  useEffect(() => {
    if (skip) return
    const onSettings = () => setPanel('setup')
    window.addEventListener('vlock-open-settings', onSettings)
    return () => window.removeEventListener('vlock-open-settings', onSettings)
  }, [skip])

  // Idle auto-lock
  useEffect(() => {
    if (skip || idle === 0 || locked || hasPin !== true) return
    const bump = () => { lastActive.current = Date.now() }
    // Any typing or interaction keeps the session active. Typing fires 'input' and 'keydown'.
    const events = ['pointerdown', 'keydown', 'input', 'touchstart', 'scroll'] as const
    events.forEach(e => window.addEventListener(e, bump, { passive: true }))
    const t = setInterval(() => {
      if (Date.now() - lastActive.current > idle * 1000) lockForIdle()
    }, 1_000)
    return () => {
      events.forEach(e => window.removeEventListener(e, bump))
      clearInterval(t)
    }
  }, [skip, idle, locked, hasPin]) // eslint-disable-line react-hooks/exhaustive-deps

  if (skip) return null

  if (locked) return <LockCover onUnlocked={() => {
    try { localStorage.removeItem(LOCK_KEY) } catch {}
    lastActive.current = Date.now()
    setLocked(false)
  }} />

  if (panel === 'setup') return (
    <PinSetup
      currentIdle={idle}
      onCancel={() => setPanel('none')}
      onSaved={(minutes) => {
        try { localStorage.setItem(IDLE_KEY, String(minutes)) } catch {}
        lastActive.current = Date.now()
        setIdle(minutes)
        setHasPin(true)
        setPanel('none')
      }}
    />
  )

  return null
}

function LockCover({ onUnlocked }: { onUnlocked: () => void }) {
  const { t } = useLanguage()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const unlock = async () => {
    if (busy || !/^\d{4,8}$/.test(pin)) return setError(t('lock.err_pin'))
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/visitor-lock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ action: 'verify', pin }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok && d.ok) onUnlocked()
      else setError(d.error || t('lock.err_unlock'))
    } catch {
      setError(t('lock.err_network'))
    }
    setPin('')
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[100100] flex items-center justify-center p-6 bg-background" role="dialog" aria-modal="true" aria-label={t('lock.locked')}>
      <div className="w-full max-w-xs text-center space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
          <Lock className="h-6 w-6 text-foreground" />
        </div>
        <h2 className="text-lg font-semibold">{t('lock.locked')}</h2>
        <p className="text-sm text-muted-foreground">{t('lock.enter_pin')}</p>
        <input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          onKeyDown={e => { if (e.key === 'Enter') unlock() }}
          placeholder={t('lock.pin')}
          autoComplete="off"
          autoFocus
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-lg tracking-widest outline-none focus:ring-2 focus:ring-blue-500/30"
        />
        <button type="button" onClick={unlock} disabled={busy || pin.length < 4}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-40">
          {busy ? t('lock.checking') : t('lock.unlock')}
        </button>
        {error && <p className="text-xs text-red-500"><Tx>{error}</Tx></p>}
      </div>
    </div>
  )
}

function PinSetup({ currentIdle, onSaved, onCancel }: {
  currentIdle: number; onSaved: (minutes: number) => void; onCancel: () => void
}) {
  const { t } = useLanguage()
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [idle, setIdle] = useState(currentIdle)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!/^\d{4,8}$/.test(pin)) return setError(t('lock.err_pin_len'))
    if (pin !== confirm) return setError(t('lock.err_match'))
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/visitor-lock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ action: 'set', pin }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) return setError(d.error || t('lock.err_save'))
      onSaved(idle)
    } catch {
      setError(t('lock.err_network'))
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[100090] flex items-center justify-center p-4 bg-black/60" role="dialog" aria-modal="true" aria-label={t('lock.settings')}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card text-card-foreground p-5 space-y-3 shadow-2xl">
        <h2 className="font-semibold">{t('lock.settings')}</h2>
        <p className="text-xs text-muted-foreground">
          {t('lock.settings_desc')}
        </p>
        <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder={t('lock.new_pin')} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none" />
        <input type="password" inputMode="numeric" value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
          placeholder={t('lock.confirm_pin')} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none" />
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{t('lock.idle_label')}</label>
          <select value={idle} onChange={e => setIdle(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
            {IDLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.key)}</option>)}
          </select>
        </div>
        {error && <p className="text-xs text-red-500"><Tx>{error}</Tx></p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-border py-2 text-sm">{t('lock.cancel')}</button>
          <button type="button" onClick={save} disabled={busy} className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-40">
            {busy ? t('lock.saving') : t('lock.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
