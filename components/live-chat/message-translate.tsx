'use client'
import { useState } from 'react'
import { Languages, Loader2 } from 'lucide-react'
import { useLanguage } from '@/lib/language-context'
import type { LiveChatMessage } from './message-bubble'

/**
 * Optional, on-demand translation of the admin's message into the visitor's language.
 * The original bubble is never replaced — the translation appears beneath it and can be hidden again.
 * First use shows a disclosure (the single message text goes to a translation service) and asks for consent.
 */
export function MessageTranslate({ chatId, message }: { chatId: string; message: LiveChatMessage }) {
  const { t, language } = useLanguage()
  const [text, setText] = useState<string | null>(null)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  if (language === 'en' || message.role !== 'admin' || message.media_type || message._pending || message.unsent_at || !message.content?.trim()) return null

  const go = async () => {
    if (text) return setShow(s => !s)
    let consented = false
    try { consented = localStorage.getItem('lc_translate_consent') === '1' } catch {}
    if (!consented) {
      if (!window.confirm(t('chat.translate_disclosure'))) return
      try { localStorage.setItem('lc_translate_consent', '1') } catch {}
    }
    setBusy(true); setError(false)
    try {
      const r = await fetch('/api/live-chat/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, messageId: message.id, locale: language }) })
      const d = await r.json()
      if (!r.ok || !d.text) throw new Error()
      setText(d.text); setShow(true)
    } catch { setError(true) } finally { setBusy(false) }
  }

  return (
    <div className="mt-0.5 pl-1 text-[11px]">
      <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-1 text-blue-500 hover:underline disabled:opacity-60">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
        {busy ? t('chat.translating') : text ? (show ? t('chat.show_original') : t('chat.show_translation')) : t('chat.translate')}
      </button>
      {error && <span role="alert" className="ml-2 text-red-500">{t('chat.translate_failed')}</span>}
      {show && text && (
        <div className="mt-1 max-w-[85%] rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs text-foreground">
          <p className="whitespace-pre-wrap" lang={language}>{text}</p>
          <p className="mt-1 text-[10px] italic text-muted-foreground">{t('chat.translated_notice')}</p>
        </div>
      )}
    </div>
  )
}
