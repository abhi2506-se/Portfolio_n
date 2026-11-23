'use client'
import { useLanguage } from '@/lib/language-context'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { ShieldOff, Bot, Lock } from 'lucide-react'
import { getClientFingerprint } from '@/lib/client-fingerprint'
import { Tx } from '@/components/tx'

/**
 * LiveChatBlockGate
 *
 * Mounted once in the root layout. When this device has been blocked for not
 * replying in time:
 *  - the public site is covered by an overlay (normal browsing is not affected)
 *  - the blocked chat stays on screen, read-only. The block does NOT close it,
 *    and it comes back after a refresh
 *  - the only way to close that chat is to enter the chat password. The site
 *    block stays after that
 *  - the AI assistant button and panel sit above the overlay, so the AI still works
 *
 * It never runs on /admin (the admin panel is never blocked, even from the same
 * browser) or /portal.
 */

const MARKER_KEY = '__lc_blk' // lets the overlay appear instantly on reload
// The chat that was blocked, kept in localStorage so an unblock still brings the
// chat back, even if the visitor comes back a day later and the page has reloaded.
const BLOCKED_CHAT_KEY = '__lc_blocked_chat'
const POLL_MS = 15_000
const MESSAGES_POLL_MS = 4_000

type BlockState = {
  chatId: string | null
  chatDismissed: boolean
  passwordRequired: boolean
}

export function LiveChatBlockGate() {
  const { t } = useLanguage()
  const pathname = usePathname() || ''
  const skip = pathname.startsWith('/admin') || pathname.startsWith('/portal')
  const [blocked, setBlocked] = useState(false)
  const [info, setInfo] = useState<BlockState>({ chatId: null, chatDismissed: false, passwordRequired: false })
  const [fp, setFp] = useState('')

  const check = useCallback(async () => {
    try {
      const fingerprint = await getClientFingerprint()
      setFp(fingerprint)
      const res = await fetch(`/api/live-chat/block-status?fp=${encodeURIComponent(fingerprint)}`, {
        cache: 'no-store',
        credentials: 'include',
      })
      if (!res.ok) return // never change state on a failed check (fail open)
      const data = await res.json()
      if (data.blocked) {
        // Remember the blocked chat, even if its notice was hidden. An unblock brings it back.
        try { if (data.chatId) localStorage.setItem(BLOCKED_CHAT_KEY, data.chatId) } catch {}
        setBlocked(true)
        setInfo({
          chatId: data.chatId || null,
          chatDismissed: !!data.chatDismissed,
          passwordRequired: !!data.passwordRequired,
        })
        try { localStorage.setItem(MARKER_KEY, '1') } catch {}
      } else {
        setBlocked(false)
        setInfo({ chatId: null, chatDismissed: false, passwordRequired: false })
        // Block lifted (by admin or by the visitor, even a day later): bring the same chat back.
        try {
          const pending = localStorage.getItem(BLOCKED_CHAT_KEY)
          if (pending) {
            localStorage.removeItem(BLOCKED_CHAT_KEY)
            window.dispatchEvent(new CustomEvent('lc-unblocked', { detail: { chatId: pending } }))
          }
        } catch {}
        try { localStorage.removeItem(MARKER_KEY) } catch {}
      }
    } catch {
      // Network hiccup: keep whatever state we had.
    }
  }, [])

  useEffect(() => {
    if (skip) return
    try { if (localStorage.getItem(MARKER_KEY) === '1') setBlocked(true) } catch {}
    check()
    const interval = setInterval(check, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const onBlockedNow = () => check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('lc-blocked', onBlockedNow)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('lc-blocked', onBlockedNow)
    }
  }, [skip, check])

  if (skip || !blocked) return null

  const showChat = !!info.chatId && !info.chatDismissed

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="lc-block-title"
      className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-background/85 backdrop-blur-md overflow-y-auto"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card text-card-foreground shadow-2xl p-5">
        {showChat && info.chatId ? (
          <BlockedChatCard
            chatId={info.chatId}
            fp={fp}
            passwordRequired={info.passwordRequired}
            onClosed={() => setInfo(prev => ({ ...prev, chatDismissed: true }))}
          />
        ) : (
          <div className="py-2 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
              <ShieldOff className="h-7 w-7 text-red-500" />
            </div>
            <h2 id="lc-block-title" className="text-lg font-semibold">{t('block.title')}</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              {t('block.body')}
            </p>
          </div>
        )}

        <SelfUnblock fp={fp} onUnblocked={check} />

        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t('block.ai_hint')}
          </p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('lc-open-ai'))}
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:opacity-90"
          >
            <Bot className="h-4 w-4" />
            {t('block.open_ai')}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The blocked notice. It shows no messages. The visitor can hide the notice on this
 * device with the chat password. That does NOT end the chat. Only the visitor or the
 * admin can end it.
 */
function BlockedChatCard({
  chatId, fp, passwordRequired, onClosed,
}: { chatId: string; fp: string; passwordRequired: boolean; onClosed: () => void }) {
  const { t } = useLanguage()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const hide = async () => {
    if (busy) return
    if (passwordRequired && !password.trim()) return setError(t('block.enter_pw'))
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'dismiss_blocked_chat', chatId, password, fingerprint: fp }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setPassword('')
        onClosed()
      } else {
        setError(data.error || t('block.hide_failed'))
      }
    } catch {
      setError(t('block.server_failed'))
    }
    setBusy(false)
  }

  return (
    <div className="text-left">
      <div className="text-center mb-3">
        <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-red-500/10">
          <ShieldOff className="h-5 w-5 text-red-500" />
        </div>
        <h2 id="lc-block-title" className="text-base font-semibold">{t('block.title')}</h2>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
          {t('block.chat_body')}
        </p>
      </div>

      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
        <p className="text-xs text-violet-400 flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" />
          {passwordRequired
            ? t('block.hide_pw')
            : t('block.hide_nopw')}
        </p>
        <div className="flex items-center gap-2">
          {passwordRequired && (
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') hide() }}
              placeholder={t('block.pw_ph')}
              autoComplete="off"
              className="flex-1 min-w-0 bg-background border border-border rounded-full px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-violet-500/40"
            />
          )}
          <button
            type="button"
            onClick={hide}
            disabled={busy || (passwordRequired && !password.trim())}
            className="text-xs bg-violet-600 text-white px-3 py-1.5 rounded-full disabled:opacity-40 shrink-0"
          >
            {busy ? t('block.hiding') : t('block.hide')}
          </button>
        </div>
        {error && <p className="text-[11px] text-red-400"><Tx>{error}</Tx></p>}
      </div>
    </div>
  )
}

/**
 * "I know Abhishek personally": the same relation + name check as the site-wide
 * self-unblock. Lifts this device's live-chat block and reopens the chat.
 */
function SelfUnblock({ fp, onUnblocked }: { fp: string; onUnblocked: () => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [relation, setRelation] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const RELATIONS = [
    { id: 'wife', label: t('block.rel_wife') },
    { id: 'family', label: t('block.rel_family') },
    { id: 'friend', label: t('block.rel_friend') },
    { id: 'other', label: t('block.rel_other') },
  ]

  const submit = async () => {
    if (!name.trim()) return setError(t('block.enter_name'))
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/live-chat/self-unblock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ relation, name: name.trim(), fingerprint: fp }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.unblocked) {
        onUnblocked()
      } else {
        setError(data.error || t('block.no_match'))
      }
    } catch {
      setError(t('block.network'))
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-blue-500/30 bg-blue-600/10 py-2.5 text-sm font-semibold text-blue-500 hover:bg-blue-600/20"
      >
        {t('block.know')}
      </button>
    )
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-3 text-left">
      <p className="text-xs font-semibold text-center">{t('block.relation_q')}</p>
      {!relation ? (
        <div className="grid grid-cols-2 gap-2">
          {RELATIONS.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRelation(r.id)}
              className="rounded-lg border border-border bg-background py-2 text-xs hover:border-blue-500/50"
            >
              <Tx>{r.label}</Tx>
            </button>
          ))}
        </div>
      ) : relation === 'wife' ? (
        <div className="space-y-2">
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder={t('gate.full_name_ph')}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/30"
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="w-full rounded-lg bg-blue-600 py-2 text-xs font-medium text-white disabled:opacity-40"
          >
            {busy ? t('block.checking') : t('block.verify')}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center leading-relaxed">
          {t('block.ask_unblock')}
        </p>
      )}
      {error && <p className="text-[11px] text-red-400 text-center"><Tx>{error}</Tx></p>}
      <button type="button" onClick={() => { setOpen(false); setRelation(null); setName(''); setError(null) }} className="w-full text-[11px] text-muted-foreground hover:underline">
        <Tx>{"Cancel"}</Tx>
      </button>
    </div>
  )
}
