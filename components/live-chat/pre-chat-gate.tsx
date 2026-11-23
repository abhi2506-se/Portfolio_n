'use client'
import { useLanguage } from '@/lib/language-context'

import { useRef, useEffect, useState } from 'react'
import { Bot, MessageCircle, ArrowLeft, Send, Loader2, Sparkles } from 'lucide-react'

export interface PreChatDetails { name: string; email: string; mobile: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const cleanMobile = (s: string) => s.replace(/[\s().-]/g, '')
const MOBILE_RE = /^\+?[0-9]{7,15}$/

interface Props {
  initial?: Partial<PreChatDetails>
  /** Called when the visitor picks "Live Chat with Abhii" — the existing live-chat start form takes over. */
  onLiveChat: (d: PreChatDetails) => void
}

const inputCls = 'w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-500/50 placeholder-muted-foreground/50'

/**
 * Step 1: mandatory Name / Email / Mobile.  Step 2: choose Demo Chat or Live Chat with Abhii.
 * Demo Chat is stateless and fully separate from the live-chat tables/APIs.
 */
export function PreChatGate({ initial, onLiveChat }: Props) {
  const { t } = useLanguage()
  const [step, setStep] = useState<'details' | 'choose' | 'demo'>('details')
  const [name, setName] = useState(initial?.name || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [mobile, setMobile] = useState(initial?.mobile || '')
  const [touched, setTouched] = useState(false)

  const errors = {
    name: name.trim().length < 2 ? t('gate.err_name') : '',
    email: !EMAIL_RE.test(email.trim()) ? t('gate.err_email') : '',
    mobile: !MOBILE_RE.test(cleanMobile(mobile)) ? t('gate.err_mobile') : '',
  }
  const valid = !errors.name && !errors.email && !errors.mobile
  const details: PreChatDetails = { name: name.trim(), email: email.trim().toLowerCase(), mobile: cleanMobile(mobile) }

  if (step === 'demo') return <DemoChat details={details} onBack={() => setStep('choose')} />

  if (step === 'choose') {
    return (
      <div className="flex-1 p-4 flex flex-col gap-3 overflow-y-auto">
        <button onClick={() => setStep('details')} className="self-start flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> {t('gate.edit_details')}
        </button>
        <p className="text-sm font-semibold">{t('gate.choose', { name: details.name.split(' ')[0] })}</p>
        <button onClick={() => setStep('demo')}
          className="text-left rounded-2xl border border-border bg-secondary/60 hover:border-violet-500/50 p-4 transition-colors">
          <div className="flex items-center gap-2 font-semibold text-sm"><Bot className="w-4 h-4 text-violet-400" /> {t('gate.demo_title')}</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t('gate.demo_desc')}</p>
        </button>
        <button onClick={() => onLiveChat(details)}
          className="text-left rounded-2xl border border-violet-500/40 bg-gradient-to-br from-violet-600/15 to-blue-600/10 hover:border-violet-400 p-4 transition-colors">
          <div className="flex items-center gap-2 font-semibold text-sm"><MessageCircle className="w-4 h-4 text-blue-400" /> {t('gate.live_title')}</div>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{t('gate.live_desc')}</p>
        </button>
      </div>
    )
  }

  return (
    <form className="flex-1 p-4 flex flex-col gap-3 overflow-y-auto"
      onSubmit={e => { e.preventDefault(); setTouched(true); if (valid) setStep('choose') }} noValidate>
      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
        <p className="text-xs text-violet-300 leading-relaxed">{t('gate.intro')}</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="pc-name">{t('gate.full_name')}</label>
        <input id="pc-name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder={t('gate.full_name_ph')} className={inputCls} maxLength={100} />
        {touched && errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="pc-email">{t('gate.email')}</label>
        <input id="pc-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" className={inputCls} maxLength={254} />
        {touched && errors.email && <p className="text-[11px] text-red-500 mt-1">{errors.email}</p>}
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1" htmlFor="pc-mobile">{t('gate.mobile')}</label>
        <input id="pc-mobile" type="tel" value={mobile} onChange={e => setMobile(e.target.value)} autoComplete="tel" placeholder="+91 98765 43210" className={inputCls} maxLength={25} />
        {touched && errors.mobile && <p className="text-[11px] text-red-500 mt-1">{errors.mobile}</p>}
      </div>
      <button type="submit"
        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-medium">
        {t('gate.continue')}
      </button>
    </form>
  )
}

function DemoChat({ details, onBack }: { details: PreChatDetails; onBack: () => void }) {
  const { t } = useLanguage()
  const [msgs, setMsgs] = useState<{ role: 'user' | 'assistant'; content: string }[]>([
    { role: 'assistant', content: t('gate.demo_hello', { name: details.name.split(' ')[0] }) },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    const next = [...msgs, { role: 'user' as const, content: text }]
    setMsgs(next); setInput(''); setBusy(true); setErr('')
    try {
      // The greeting is UI-only; real history starts at the first user message.
      const history = next.slice(1)
      const res = await fetch('/api/demo-chat/public', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, history }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || t('gate.no_reply'))
      setMsgs(m => [...m, { role: 'assistant', content: data.reply }])
    } catch (e: any) { setErr(e.message || t('gate.no_reply')) }
    setBusy(false)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button onClick={onBack} aria-label={t('gate.back')} className="text-muted-foreground hover:text-foreground"><ArrowLeft className="w-4 h-4" /></button>
        <Sparkles className="w-4 h-4 text-violet-400" /><span className="text-xs font-semibold">{t('gate.demo_title')}</span>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500">{t('gate.demo_only')}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white' : 'bg-secondary'}`}>{m.content}</div>
          </div>
        ))}
        {busy && <div className="flex"><div className="bg-secondary rounded-2xl px-3 py-2"><Loader2 className="w-4 h-4 animate-spin" /></div></div>}
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div ref={end} />
      </div>
      <div className="p-3 border-t border-border flex gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} maxLength={1000}
          placeholder={t('gate.ask_demo')} className={inputCls} />
        <button onClick={send} disabled={!input.trim() || busy} aria-label={t('gate.send')}
          className="px-3 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white disabled:opacity-40"><Send className="w-4 h-4" /></button>
      </div>
    </div>
  )
}
