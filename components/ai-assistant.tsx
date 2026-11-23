'use client'

import { useLanguage } from '@/lib/language-context'
import { useVoiceRecognition } from '@/hooks/use-voice-recognition'
import { classifyUtterance, isConfidentEnough } from '@/lib/voice/voice-intents'
import { MSG_REPEAT } from '@/lib/voice/speech-support'
import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Send, Bot, Loader2, Sparkles, Mic, MicOff,
  MessageCircle, Phone, Briefcase, Calendar, Download,
  ExternalLink, CheckCircle, Volume2, VolumeX, Zap,
  UserCheck, Code2, Handshake, User, RotateCw, Maximize2,
} from 'lucide-react'
import { UserChatPanel } from '@/components/live-chat/user-chat-panel'
import { PreChatGate } from '@/components/live-chat/pre-chat-gate'
import { getClientFingerprint } from '@/lib/client-fingerprint'
import { CallModal } from '@/components/live-chat/call-modal'
import { useWebRTCCall } from '@/hooks/use-webrtc-call'
import { Tx, useTx } from '@/components/tx'

interface Message {
  role: 'user' | 'assistant'
  content: string
  intent?: string
  id: string
  typingProgress?: number
}

interface ChatbotSettings {
  whatsapp_number?: string
  calendly_url?: string
  chatbot_name?: string
  resume_url?: string
}

interface UserMeta {
  user_name: string
  browser_name: string
  device_name: string
  fingerprint: string
  user_location: string
  latitude: number
  longitude: number
}

const STORAGE_META_KEY = 'portfolio_user_meta_v1'

const SUGGESTED = [
  "What are Abhishek's top skills?",
  "Tell me about his experience",
  "What projects has he built?",
  "Is he available for hire?",
]

// ── AI Recruiter Mode ────────────────────────────────────────────────────────
function RecruiterModePanel({ onClose, onResult }: { onClose: () => void; onResult: (result: string) => void }) {
  const { t, language } = useLanguage()
  const [jd, setJd] = useState('')
  const [loading, setLoading] = useState(false)

  const evaluate = async () => {
    if (!jd.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Evaluate Abhishek Singh for this job description. Reply with:\n**Match %**: (realistic %)\n**Strengths**: 3 bullet points why he fits\n**Gaps**: 1-2 honest gaps if any\n**Why Hire Him**: one strong sentence\n\nJob:\n${jd.slice(0, 1200)}`,
          history: [],
          language,
        }),
      })
      const data = await res.json()
      onResult(data.reply || 'Could not evaluate. Try again.')
    } catch {
      onResult('Error connecting. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="absolute inset-0 bg-background z-10 flex flex-col rounded-2xl overflow-hidden"
    >
      <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 flex-shrink-0">
        <UserCheck className="w-5 h-5 text-white" />
        <p className="font-semibold text-white text-sm flex-1">{t('ai.rec_title')}</p>
        <button onClick={onClose} className="text-white/70 hover:text-white"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 p-4 flex flex-col gap-3 overflow-y-auto">
        <p className="text-xs text-muted-foreground">{t('ai.rec_desc')}</p>
        <textarea
          value={jd}
          onChange={e => setJd(e.target.value)}
          placeholder={t('ai.rec_ph')}
          rows={7}
          className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-sm outline-none focus:border-purple-500/50 resize-none placeholder-muted-foreground/50"
        />
        <button
          onClick={evaluate}
          disabled={!jd.trim() || loading}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white text-sm font-medium disabled:opacity-40 transition-opacity"
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('ai.evaluating')}</> : <><Zap className="w-4 h-4" /> {t('ai.evaluate')}</>}
        </button>
      </div>
    </motion.div>
  )
}

// Generate stable session ID for analytics
function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr'
  let id = sessionStorage.getItem('chat_session_id')
  if (!id) {
    id = `s_${Date.now()}_${Math.random().toString(36).slice(2,8)}`
    sessionStorage.setItem('chat_session_id', id)
  }
  return id
}

// ── Browser / Device fingerprinting (no permission needed) ───────────────────
function parseBrowserName(ua: string): string {
  if (/Edg\//i.test(ua))    return 'Microsoft Edge'
  if (/OPR\//i.test(ua))    return 'Opera'
  if (/Chrome\//i.test(ua)) return 'Google Chrome'
  if (/Firefox\//i.test(ua))return 'Mozilla Firefox'
  if (/Safari\//i.test(ua)) return 'Apple Safari'
  if (/MSIE|Trident/i.test(ua)) return 'Internet Explorer'
  return 'Unknown Browser'
}

function parseDeviceName(ua: string): string {
  // Mobile devices
  const mobileMatch = ua.match(/\(([^)]+)\)/)
  if (!mobileMatch) return 'Desktop'
  const info = mobileMatch[1]
  // iPhone / iPad
  if (/iPhone/.test(ua)) return ua.match(/iPhone OS ([\d_]+)/)?.[0]?.replace(/_/g,'.') ? `Apple iPhone (iOS ${ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g,'.')})` : 'Apple iPhone'
  if (/iPad/.test(ua))   return 'Apple iPad'
  // Android model
  const androidModel = ua.match(/Android [^;]+; ([^)]+) Build/)?.[1]?.trim()
  if (androidModel) return androidModel
  if (/Android/.test(ua)) return 'Android Device'
  // Windows/Mac desktop
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11 PC'
  if (/Windows NT 6/.test(ua))  return 'Windows PC'
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac'
  if (/Linux/.test(ua)) return 'Linux PC'
  return info.split(';')[0].trim() || 'Desktop'
}

function canvasFingerprintHash(): string {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillStyle = '#f60'
    ctx.fillRect(125, 1, 62, 20)
    ctx.fillStyle = '#069'
    ctx.fillText('Abhishek Portfolio 🎨', 2, 15)
    ctx.fillStyle = 'rgba(102,204,0,0.7)'
    ctx.fillText('canvas fingerprint', 4, 45)
    const data = canvas.toDataURL()
    let h = 0
    for (let i = 0; i < data.length; i++) { h = (Math.imul(31, h) + data.charCodeAt(i)) | 0 }
    return Math.abs(h).toString(36)
  } catch { return 'no-canvas' }
}

function buildFingerprint(): string {
  if (typeof window === 'undefined') return 'ssr'
  const parts = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset(),
    navigator.hardwareConcurrency,
    canvasFingerprintHash(),
  ]
  let h = 0
  const str = parts.join('|')
  for (let i = 0; i < str.length; i++) { h = (Math.imul(31, h) + str.charCodeAt(i)) | 0 }
  return 'fp_' + Math.abs(h).toString(36)
}

async function collectUserMeta(name: string): Promise<UserMeta> {
  const ua          = navigator.userAgent
  const browser     = parseBrowserName(ua)
  const device      = parseDeviceName(ua)
  const fingerprint = buildFingerprint()

  // IP-based geolocation — no user permission needed
  let location = ''
  let latitude  = 0
  let longitude = 0
  try {
    const res  = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(4000) })
    const geo  = await res.json()
    latitude   = geo.latitude  ?? 0
    longitude  = geo.longitude ?? 0
    const parts = [geo.city, geo.region, geo.country_name].filter(Boolean)
    location   = parts.join(', ')
  } catch { /* silent fail — IP lookup optional */ }

  return { user_name: name, browser_name: browser, device_name: device, fingerprint, user_location: location, latitude, longitude }
}

// ── Name Gate Modal ──────────────────────────────────────────────────────────
function NameGateModal({ onSubmit, chatbotName }: { onSubmit: (name: string) => void; chatbotName: string }) {
  const __tx = useTx();
  const { t } = useLanguage()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100) }, [])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed) { setError(__tx("Please enter your name to continue.")); return }
    if (trimmed.length < 2) { setError(__tx("Name must be at least 2 characters.")); return }
    setLoading(true)
    setError('')
    onSubmit(trimmed)
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92, y: 16 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.92, y: 16 }}
      transition={{ type: 'spring', stiffness: 300, damping: 28 }}
      className="fixed bottom-24 right-3 sm:right-5 z-[9998] flex flex-col
        w-[min(calc(100vw-1.5rem),380px)]
        bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-white text-sm truncate">{chatbotName || <Tx>{"Portfolio AI"}</Tx>}</p>
          <p className="text-white/70 text-xs">{t('ai.name_prompt')}</p>
        </div>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3">
          <Sparkles className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300 leading-relaxed">
            <Tx>{"Hi there! I'm"}</Tx> {chatbotName || <Tx>{"Abhishek's AI assistant"}</Tx>}<Tx>{". Before we chat, please share your name so I can greet you properly. 😊"}</Tx>
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-muted-foreground mb-1.5">{t('ai.your_name')}</label>
          <input
            ref={inputRef}
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && !loading && handleSubmit()}
            placeholder={t('ai.name_ph')}
            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-blue-500/60 placeholder-muted-foreground/50 text-foreground transition-colors"
          />
          {error && <p className="text-xs text-red-400 mt-1.5"><Tx>{error}</Tx></p>}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!name.trim() || loading}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 text-white text-sm font-semibold disabled:opacity-40 transition-opacity hover:opacity-90 active:scale-[0.98]"
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('ai.starting')}</> : <><Sparkles className="w-4 h-4" /> {t('ai.start_chat')}</>}
        </button>
        <p className="text-[10px] text-muted-foreground/50 text-center">{t('ai.name_hint')}</p>
      </div>
    </motion.div>
  )
}

// Simple markdown-like renderer for assistant messages
function MessageContent({ content }: { content: string }) {
  const [mainText, ctaText] = content.split('\n\n---\n')

  const renderText = (text: string) => {
    const lines = text.split('\n')
    return lines.map((line, i) => {
      const parts = line.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
      const rendered = parts.map((part, j) => {
        if (/^\*\*([^*]+)\*\*$/.test(part)) {
          return <strong key={j}>{part.slice(2, -2)}</strong>
        }
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
        if (linkMatch) {
          const [, label, href] = linkMatch
          const isDownload = href.endsWith('.pdf') || href.includes('/Cv.')
          return (
            <a key={j} href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
              download={isDownload || undefined}
              className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
            >
              <Tx>{label}</Tx>
              <ExternalLink className="w-3 h-3 opacity-60" />
            </a>
          )
        }
        return part
      })
      return <span key={i}>{rendered}{i < lines.length - 1 ? <br/> : null}</span>
    })
  }

  return (
    <div className="text-sm leading-relaxed">
      <div>{renderText(mainText)}</div>
      {ctaText && (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
          {ctaText.split(' · ').map((part, i) => {
            const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/)
            const labelPart = part.replace(/\[([^\]]+)\]\([^)]+\)/g, '').trim()
            if (linkMatch) {
              const [, label, href] = linkMatch
              const isDownload = href.endsWith('.pdf') || href.includes('/Cv.')
              const isWA = href.includes('wa.me')
              const isCal = href.includes('calendly') || href.includes('cal.com')
              return (
                <span key={i} className="inline-block mr-2 mb-1">
                  {labelPart && <span className="text-white/60 text-xs">{labelPart} </span>}
                  <a href={href}
                    target={href.startsWith('http') ? '_blank' : undefined}
                    rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                    download={isDownload || undefined}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                      isWA ? 'bg-green-500/20 text-green-300 hover:bg-green-500/30 border border-green-500/30'
                      : isCal ? 'bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border border-purple-500/30'
                      : isDownload ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 border border-blue-500/30'
                      : 'bg-white/10 text-white/70 hover:bg-white/20 border border-white/10'
                    }`}
                  >
                    {isWA && <Phone className="w-3 h-3" />}
                    {isCal && <Calendar className="w-3 h-3" />}
                    {isDownload && <Download className="w-3 h-3" />}
                    <Tx>{label}</Tx>
                  </a>
                </span>
              )
            }
            return <span key={i} className="text-xs text-white/60">{part}</span>
          })}
        </div>
      )}
    </div>
  )
}

const STORAGE_KEY = 'portfolio_chat_v2'

export function AIAssistant() {
  const __tx = useTx();
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showBubble, setShowBubble] = useState(false)
  // Voice engine (Phase 2): recognition lives in useVoiceRecognition. Nothing here executes commands.
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null)
  const voice = useVoiceRecognition({
    lang: 'en-IN',
    onInterim: (text) => setInput(text),
    onFinal: (text, confidence) => handleVoiceFinal(text, confidence),
    onError: (message) => setVoiceNotice(message),
  })
  const voiceSupported = voice.supported
  const isListening = voice.listening
  const [settings, setSettings] = useState<ChatbotSettings>({})
  const [showHireBanner, setShowHireBanner] = useState(false)
  const [showRecruiterMode, setShowRecruiterMode] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(false)
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null)
  const [displayedContent, setDisplayedContent] = useState<Record<string, string>>({})
  // Name gate + user meta
  const [showNameGate, setShowNameGate] = useState(false)
  const [userMeta, setUserMeta] = useState<UserMeta | null>(null)
  // Live chat state
  const [showLiveChat, setShowLiveChat] = useState(false)
  const [liveChatId, setLiveChatId] = useState<string | null>(null)
  // Live chat opens full-screen by default — on PC as well as mobile — with
  // a minimize control to shrink it back into the small assistant widget
  // without ending the chat. Defaults true so a freshly-started chat always
  // opens full-screen.
  const [liveChatFullscreen, setLiveChatFullscreen] = useState(true)
  const [liveChatMessages, setLiveChatMessages] = useState<any[]>([])
  const [liveChatStatus, setLiveChatStatus] = useState<string>('pending')
  const [liveChatInput, setLiveChatInput] = useState('')
  const [liveChatName, setLiveChatName] = useState('')
  const [liveChatEmail, setLiveChatEmail] = useState('')
  const [liveChatPhone, setLiveChatPhone] = useState('')
  const [liveChatInitMsg, setLiveChatInitMsg] = useState('')
  // Pre-chat gate: name/email/mobile + Demo-vs-Live choice happens BEFORE the existing live-chat start form.
  const [preChatDone, setPreChatDone] = useState(false)
  const [liveChatStarting, setLiveChatStarting] = useState(false)
  const [liveChatStartError, setLiveChatStartError] = useState<string | null>(null)
  // Server-verified visitor identity for live chat (null = guest / unknown yet).
  const { t, language } = useLanguage()
  const [chatIdentity, setChatIdentity] = useState<{ name: string; email: string } | null>(null)
  const [adminTyping, setAdminTyping] = useState(false)

  // ── Call, lifted up here (instead of inside UserChatPanel) ──────────────
  // AIAssistant stays mounted across normal in-app navigation (it only
  // unmounts on /admin and /journey routes, or on a full page reload), so a
  // call started here keeps running — including its floating minimized
  // bubble/PiP window — even if the user closes the chat widget or browses
  // other pages of the site in the meantime.
  //
  // IMPORTANT: we deliberately do NOT open a second Supabase Realtime
  // subscription to the chat channel here. UserChatPanel already owns the
  // one-and-only subscription for this chat (messages/presence/receipts/
  // typing/call-signal) — a second `client.channel()` call against the same
  // topic from the same browser tab is unreliable (it can silently break
  // delivery for BOTH subscriptions, which is what caused presence/ticks to
  // stop updating for the admin after this was briefly duplicated). Instead,
  // UserChatPanel forwards call signals up via `onCallSignalReady` below,
  // and forwards outgoing signals down via this ref.
  const logCall = useCallback(async (action: 'start' | 'end', data: any) => {
    const res = await fetch('/api/live-chat/call-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }) })
    return res.json()
  }, [])
  const sendCallSignalRef = useRef<(payload: any) => void>(() => {
    console.error('[live-chat] Cannot send call signal — chat panel not mounted / channel not connected yet.')
  })
  const call = useWebRTCCall({ chatId: liveChatId, role: 'user', onSignal: (payload) => sendCallSignalRef.current(payload), logCall })
  const liveChatBottomRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // On mount: restore saved meta from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_META_KEY)
      if (saved) setUserMeta(JSON.parse(saved) as UserMeta)
    } catch {}
  }, [])

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.settings) setSettings(d.settings) })
      .catch(() => {})
  }, [])



  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as Message[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setMessages(parsed)
          return
        }
      }
    } catch {}
  }, [])

  useEffect(() => {
    if (messages.length > 0) {
      try {
        const toSave = messages.slice(-30)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
      } catch {}
    }
  }, [messages])

  useEffect(() => {
    const t = setTimeout(() => setShowBubble(true), 3000)
    const t2 = setTimeout(() => setShowBubble(false), 8000)
    return () => { clearTimeout(t); clearTimeout(t2) }
  }, [])

  useEffect(() => {
    if (open && messages.length === 0) {
      const name = settings.chatbot_name || "Abhishek's AI assistant"
      setMessages([{
        role: 'assistant',
        content: `Hi${userMeta?.user_name ? ` ${userMeta.user_name}` : ''}! 👋 I'm ${name}. Ask me anything about his skills, projects, experience, or availability for hire!`,
        id: `welcome_${Date.now()}`,
      }])
    }
    if (open) setTimeout(() => inputRef.current?.focus(), 300)
  }, [open, settings.chatbot_name])

  // Auto-scroll inside chat only
  useEffect(() => {
    if (!bottomRef.current) return
    const container = bottomRef.current.closest('.chat-messages-container')
    if (container) container.scrollTop = container.scrollHeight
  }, [messages, loading])

  // Live chat: poll messages when active
  useEffect(() => {
    if (!liveChatId || !showLiveChat) return
    const poll = async () => {
      try {
        const res = await fetch(`/api/live-chat?chatId=${encodeURIComponent(liveChatId)}`)
        if (res.ok) {
          const data = await res.json()
          setLiveChatMessages(data.messages || [])
          setLiveChatStatus(data.status || 'pending')
          setAdminTyping(!!data.adminTyping)
        }
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [liveChatId, showLiveChat])

  // Live chat closed because this device was blocked: drop the live-chat view
  // and open the AI assistant, which keeps working. The block gate listens to
  // the same event and shows its overlay under the AI panel.
  useEffect(() => {
    const onBlocked = () => {
      setShowLiveChat(false)
      setLiveChatId(null)
      setLiveChatMessages([])
      setOpen(true)
    }
    const onOpenAi = () => setOpen(true)
    // The block was lifted (by admin, or by the visitor): reopen the same chat.
    const onUnblocked = (e: Event) => {
      const chatId = (e as CustomEvent<{ chatId?: string }>).detail?.chatId
      if (!chatId) return
      setLiveChatId(chatId)
      setLiveChatFullscreen(true)
      setShowLiveChat(true)
      setOpen(true)
    }
    window.addEventListener('lc-blocked', onBlocked)
    window.addEventListener('lc-open-ai', onOpenAi)
    window.addEventListener('lc-unblocked', onUnblocked)
    return () => {
      window.removeEventListener('lc-blocked', onBlocked)
      window.removeEventListener('lc-open-ai', onOpenAi)
      window.removeEventListener('lc-unblocked', onUnblocked)
    }
  }, [])

  // Send typing signal when user types in live chat
  const handleLiveChatInputChange = (val: string) => {
    setLiveChatInput(val)
    if (!liveChatId) return
    // Debounce: send typing signal, clear after 3s of no typing
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current)
    fetch('/api/live-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'typing', chatId: liveChatId, role: 'user' }),
    }).catch(() => {})
    typingTimeoutRef.current = setTimeout(() => { typingTimeoutRef.current = null }, 3000)
  }

  // Live chat: auto-scroll
  useEffect(() => {
    liveChatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveChatMessages])

  // Live chat identity: ask the server who this is. A signed-in visitor skips the
  // name/email/phone form and resumes their own conversation; a guest or a
  // different account never sees the previous user's chat.
  useEffect(() => {
    if (!showLiveChat) return
    let cancelled = false
    ;(async () => {
      let who: any = null
      try {
        const r = await fetch('/api/live-chat?whoami=1', { cache: 'no-store' })
        if (r.ok) who = await r.json()
      } catch { return } // offline: keep whatever the user already has
      if (cancelled || !who) return
      let prevOwner: string | null = null
      try { prevOwner = localStorage.getItem('lc_owner') } catch {}
      const owner = who.authenticated ? `visitor:${who.visitorId || who.email}` : 'guest'
      if (prevOwner && prevOwner !== owner && prevOwner.startsWith('visitor:')) {
        // Account changed or logged out on this browser: drop the old thread.
        setLiveChatId(null)
        setLiveChatMessages([])
        setLiveChatStatus('pending')
      }
      try { localStorage.setItem('lc_owner', owner) } catch {}
      if (who.authenticated) {
        setChatIdentity({ name: who.name, email: who.email })
        setLiveChatName(who.name || '')
        setLiveChatEmail(who.email || '')
        setPreChatDone(true)
        if (who.chat?.id && who.chat.status !== 'closed') setLiveChatId(who.chat.id)
      } else {
        setChatIdentity(null)
      }
    })()
    return () => { cancelled = true }
  }, [showLiveChat])

  // A notification click opens /?openChat=1 → open the live chat widget.
  useEffect(() => {
    try {
      const u = new URL(window.location.href)
      if (u.searchParams.get('openChat') === '1') {
        u.searchParams.delete('openChat')
        window.history.replaceState({}, '', u.pathname + (u.search || '') + u.hash)
        setOpen(true)
        setLiveChatFullscreen(true)
        setShowLiveChat(true)
      }
    } catch {}
  }, [])

  const startLiveChat = async () => {
    if (!liveChatInitMsg.trim() || liveChatStarting) return
    if (!chatIdentity && (!liveChatName.trim() || !liveChatEmail.trim() || !liveChatPhone.trim())) return
    setLiveChatStarting(true)
    setLiveChatStartError(null)
    try {
      const fingerprint = await getClientFingerprint().catch(() => '')
      const res = await fetch('/api/live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          // Signed-in visitors: identity comes from the server session, not the browser.
          ...(chatIdentity ? {} : { userName: liveChatName, userEmail: liveChatEmail, userPhone: liveChatPhone }),
          sessionId: getSessionId(),
          initialMessage: liveChatInitMsg,
          fingerprint,
        }),
      })
      const data = await res.json().catch(() => null)
      if (data?.blocked) {
        // This device was blocked for missing a reply. Close live chat and let
        // the block gate show the notice; the AI assistant stays available.
        setLiveChatStarting(false)
        window.dispatchEvent(new CustomEvent('lc-blocked'))
        return
      }
      if (!res.ok || !data?.chatId) {
        // Don't clear the typed name/message — the person shouldn't have to
        // retype anything to try again. Just surface the problem and let
        // them hit "Send again".
        setLiveChatStartError(data?.error || "Couldn't send your message. Please try again.")
        setLiveChatStarting(false)
        return
      }
      setLiveChatId(data.chatId)
      setLiveChatFullscreen(true)
      setLiveChatMessages([{ id: 'init', role: 'user', content: liveChatInitMsg, created_at: Date.now() }])
    } catch {
      setLiveChatStartError("Couldn't reach the server. Check your connection and try again.")
    }
    setLiveChatStarting(false)
  }

  const sendLiveChatMessage = async () => {
    if (!liveChatId || !liveChatInput.trim()) return
    const content = liveChatInput.trim()
    setLiveChatInput('')
    setLiveChatMessages(prev => [...prev, { id: `tmp_${Date.now()}`, role: 'user', content, created_at: Date.now() }])
    try {
      await fetch('/api/live-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'message', chatId: liveChatId, content }),
      })
    } catch {}
  }

  // Voice Phase 2: a finished transcript fills the input so the user can review it. It is never
  // auto-sent, and nothing executes from voice yet (commands come later through the server registry).
  const handleVoiceFinal = (text: string, confidence?: number) => {
    const c = classifyUtterance(text)
    if (!isConfidentEnough(confidence) || c.kind === 'unclear') {
      setVoiceNotice(MSG_REPEAT)
      if (ttsEnabled) speak(MSG_REPEAT)
      return
    }
    setVoiceNotice(null)
    if (c.kind === 'stop_listening') { voice.stop(); return }
    if (c.kind === 'help') {
      setVoiceNotice('You can speak or type a question about my portfolio, projects, skills, or experience.')
      return
    }
    if (c.kind === 'confirm_yes' || c.kind === 'confirm_no' || c.kind === 'repeat') {
      setVoiceNotice('Nothing is waiting for confirmation. Say your question, or type it.')
      return
    }
    setInput(text.trim())
  }

  const startListening = useCallback(() => { setVoiceNotice(null); voice.start() }, [voice.start])
  const stopListening = useCallback(() => { voice.stop() }, [voice.stop])
  const toggleVoice = useCallback(() => { setVoiceNotice(null); voice.toggle() }, [voice.toggle])

  const send = async (text?: string) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    const userMsg: Message = { role: 'user', content: msg, id: `u_${Date.now()}` }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    if (isListening) stopListening()

    const tempId = `a_${Date.now()}`
    setTypingMessageId(tempId)
    setDisplayedContent(prev => ({ ...prev, [tempId]: '' }))

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: msg,
            history,
            language,
            session_id: getSessionId(),
            ...(userMeta ? {
              user_name:     userMeta.user_name,
              browser_name:  userMeta.browser_name,
              device_name:   userMeta.device_name,
              fingerprint:   userMeta.fingerprint,
              user_location: userMeta.user_location,
              latitude:      userMeta.latitude,
              longitude:     userMeta.longitude,
            } : {}),
          }),
      })
      const data = await res.json()
      const fullContent = data.reply

      // Typewriter effect: reveal character by character
      let currentIndex = 0
      const typeChar = () => {
        if (currentIndex < fullContent.length) {
          currentIndex++
          setDisplayedContent(prev => ({ ...prev, [tempId]: fullContent.slice(0, currentIndex) }))
          setTimeout(typeChar, 12)
        } else {
          // Finished typing - add full message to messages state
          const aiMsg: Message = { role: 'assistant', content: fullContent, intent: data.intent, id: tempId }
          setMessages(prev => [...prev, aiMsg])
          setTypingMessageId(null)
          speak(fullContent)
          if (data.intent === 'hire') {
            setShowHireBanner(true)
            setTimeout(() => setShowHireBanner(false), 8000)
          }
        }
      }
      typeChar()
    } catch {
      setTypingMessageId(null)
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I'm having trouble connecting. Please try again!", id: `err_${Date.now()}` }])
    } finally {
      setLoading(false)
    }
  }

  const speak = (text: string) => {
    if (!ttsEnabled || typeof window === 'undefined' || !window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').slice(0, 400))
    utterance.rate = 1.0
    utterance.pitch = 1.0

    const doSpeak = () => {
      const voices = window.speechSynthesis.getVoices()
      const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female')) || voices.find(v => v.lang.startsWith('en'))
      if (preferred) utterance.voice = preferred
      window.speechSynthesis.speak(utterance)
    }

    const voices = window.speechSynthesis.getVoices()
    if (voices.length > 0) {
      doSpeak()
    } else {
      // Voices not yet loaded — wait for them
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null
        doSpeak()
      }
      // Fallback: speak even if no voices event fires (some browsers don't fire it)
      setTimeout(() => {
        if (!utterance.voice) doSpeak()
      }, 300)
    }
  }

  const clearChat = () => {
    setMessages([])
    localStorage.removeItem(STORAGE_KEY)
    setShowHireBanner(false)
  }

  const handleNameSubmit = async (name: string) => {
    const meta = await collectUserMeta(name)
    setUserMeta(meta)
    try { localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta)) } catch {}
    setShowNameGate(false)
    setOpen(true)
  }

  const waUrl = settings.whatsapp_number
    ? `https://wa.me/${settings.whatsapp_number.replace(/\D/g,'')}?text=Hi%20Abhishek%2C%20I%20found%20your%20portfolio%20and%20would%20love%20to%20connect!`
    : null

  return (
    <>
      {/* ── Live call, rendered globally so it (and its minimized floating
          bubble / native Picture-in-Picture window) keeps showing even
          while the chat widget is closed or the user is browsing other
          parts of the site — see the `call` hook lifted above. ── */}
      <CallModal
        state={call.state} callType={call.callType} peerName="Admin" error={call.error}
        localVideoEl={call.localVideoEl} remoteVideoEl={call.remoteVideoEl} remoteAudioEl={call.remoteAudioEl}
        localMuted={call.localMuted} localVideoOff={call.localVideoOff} speakerOn={call.speakerOn} duration={call.duration}
        onAccept={call.acceptCall} onReject={call.rejectCall} onEnd={call.endCall}
        onToggleMute={call.toggleMute} onToggleVideo={call.toggleVideo} onToggleSpeaker={call.toggleSpeaker}
        videoFilter={call.videoFilter} videoFilterOptions={call.videoFilterOptions} onSetVideoFilter={call.applyVideoFilter}
        proximitySupported={call.proximitySupported} screenDimmed={call.screenDimmed} onDismissScreenDim={call.dismissScreenDim}
        minimized={call.minimized} onToggleMinimize={call.toggleMinimize}
        pipSupported={call.pipSupported} pipActive={call.pipActive} onRequestPiP={call.requestPiP}
      />

      {/* ── Name Gate Modal ── */}
      <AnimatePresence>
        {showNameGate && !userMeta && (
          <NameGateModal
            onSubmit={handleNameSubmit}
            chatbotName={settings.chatbot_name || "Portfolio AI"}
          />
        )}
      </AnimatePresence>

      {/* ── Floating button — FIXED RIGHT side, never scrolls ── */}
      <div className="fixed bottom-5 right-5 z-[9999] flex flex-col items-end gap-2">
        <AnimatePresence>
          {showBubble && !open && !showNameGate && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: 10 }}
              className="bg-foreground text-background text-xs font-medium px-3 py-2 rounded-2xl rounded-br-sm shadow-lg max-w-[170px] text-center"
            >
              <Tx>{"Ask me anything about Abhishek! 💬"}</Tx>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}
          onClick={() => {
            if (!userMeta) {
              // Must enter name first
              setShowNameGate(n => !n)
              setShowBubble(false)
            } else {
              setOpen(o => !o)
              setShowNameGate(false)
              setShowBubble(false)
            }
          }}
          className="relative w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-500/30 flex items-center justify-center text-white"
        >
          <AnimatePresence mode="wait">
            {open
              ? <motion.div key="close" initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }}><X className="w-6 h-6" /></motion.div>
              : <motion.div key="open"  initial={{ rotate: 90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: -90, opacity: 0 }}><Bot className="w-6 h-6" /></motion.div>
            }
          </AnimatePresence>
          {!open && <span className="absolute inset-0 rounded-full bg-blue-500 animate-ping opacity-20" />}
          {!open && messages.length > 1 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white">
              {Math.min(messages.filter(m => m.role === 'assistant').length, 9)}
            </span>
          )}
        </motion.button>
      </div>

      {/* ── Chat window — FIXED position, right side, capped height, responsive ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="fixed bottom-24 right-3 sm:right-5 z-[9998] flex flex-col
              w-[min(calc(100vw-1.5rem),380px)]
              max-h-[min(calc(100vh-7rem),580px)]
              bg-background border border-border rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* ── Header ── */}
            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-blue-600 to-cyan-500 flex-shrink-0">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white text-sm truncate">{settings.chatbot_name || <Tx>{"Portfolio AI"}</Tx>}</p>
                <p className="text-white/70 text-xs truncate">{t('ai.ask_work')}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setShowRecruiterMode(true)}
                  title={t('ai.eval_title')}
                  className="hidden sm:flex items-center gap-1 px-2 py-1 bg-white/10 hover:bg-white/20 text-white/80 text-xs rounded-full transition-colors"
                >
                  <UserCheck className="w-3 h-3" /> {t('ai.eval_me')}
                </button>
                <button
                  onClick={() => setTtsEnabled(p => !p)}
                  title={ttsEnabled ? t('ai.mute') : t('ai.voice_on')}
                  className="text-white/60 hover:text-white transition-colors"
                >
                  {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-white/70 text-xs hidden sm:inline">{t('ai.online')}</span>
                {messages.length > 1 && (
                  <button onClick={clearChat} className="text-white/50 hover:text-white/90 text-xs transition-colors" title={t('ai.clear')}>↺</button>
                )}
                {/* Close button — always visible */}
                <button
                  onClick={() => setOpen(false)}
                  className="ml-1 text-white/70 hover:text-white transition-colors"
                  title={t('ai.close')}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* ── Recruiter Mode Panel ── */}
            <AnimatePresence>
              {showRecruiterMode && (
                <RecruiterModePanel
                  onClose={() => setShowRecruiterMode(false)}
                  onResult={(result) => {
                    setShowRecruiterMode(false)
                    setMessages(prev => [
                      ...prev,
                      { role: 'user', content: t('ai.rec_user_msg'), id: `u_rec_${Date.now()}` },
                      { role: 'assistant', content: result, id: `a_rec_${Date.now()}` },
                    ])
                  }}
                />
              )}
            </AnimatePresence>

            {/* ── Live Chat Panel ──
                Once a chat has actually started, it opens full-screen (PC
                and mobile alike) by rendering UserChatPanel directly —
                which portals itself to document.body and covers the whole
                viewport — instead of being boxed into this small widget.
                Minimizing it (via UserChatPanel's own header button) flips
                `liveChatFullscreen` off, which falls through to the small
                embedded view below without ending the chat. */}
            {showLiveChat && liveChatId && liveChatFullscreen ? (
              <UserChatPanel
                chatId={liveChatId}
                onClose={() => setShowLiveChat(false)}
                onEnded={() => setLiveChatStatus('closed')}
                externalCall={call}
                onCallSignalChannelReady={(send) => { sendCallSignalRef.current = send }}
                forceFullscreen
                onToggleFullscreen={() => setLiveChatFullscreen(false)}
                onMinimize={() => setLiveChatFullscreen(false)}
              />
            ) : (
            <AnimatePresence>
              {showLiveChat && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  className="absolute inset-0 bg-background z-10 flex flex-col rounded-2xl overflow-hidden"
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-violet-600 to-blue-600 flex-shrink-0">
                    <MessageCircle className="w-5 h-5 text-white" />
                    <p className="font-semibold text-white text-sm flex-1">{t('ai.live_head')}</p>
                    {liveChatId && (
                      <button onClick={() => setLiveChatFullscreen(true)} title={t('ai.expand')} className="text-white/70 hover:text-white">
                        <Maximize2 className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => setShowLiveChat(false)} className="text-white/70 hover:text-white">
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {liveChatId ? (
                    <UserChatPanel
                      chatId={liveChatId}
                      onClose={() => setShowLiveChat(false)}
                      onEnded={() => setLiveChatStatus('closed')}
                      externalCall={call}
                      onCallSignalChannelReady={(send) => { sendCallSignalRef.current = send }}
                    />
                  ) : !preChatDone ? (
                    <PreChatGate
                      initial={{ name: liveChatName, email: liveChatEmail, mobile: liveChatPhone }}
                      onLiveChat={(d) => { setLiveChatName(d.name); setLiveChatEmail(d.email); setLiveChatPhone(d.mobile); setPreChatDone(true) }}
                    />
                  ) : (
                    /* Start chat form (details already collected by the pre-chat gate) */
                    <div className="flex-1 p-4 flex flex-col gap-3 overflow-y-auto">
                      <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-3">
                        <p className="text-xs text-violet-300 leading-relaxed">
                          {t('ai.live_intro')}
                        </p>
                      </div>
                      <div className="space-y-2.5">
                        {chatIdentity ? (
                          <p className="text-xs text-muted-foreground">
                            {t('chat.signed_in_as', { name: chatIdentity.name, email: chatIdentity.email })}
                          </p>
                        ) : (
                          <>
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground mb-1">{t('ai.your_name')}</label>
                          <input
                            value={liveChatName}
                            onChange={e => setLiveChatName(e.target.value)}
                            placeholder={__tx("Enter your name")}
                            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-500/50 placeholder-muted-foreground/50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground mb-1"><Tx>{"Email *"}</Tx></label>
                          <input
                            value={liveChatEmail}
                            onChange={e => setLiveChatEmail(e.target.value)}
                            placeholder="your@email.com"
                            type="email"
                            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-500/50 placeholder-muted-foreground/50"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground mb-1"><Tx>{"Mobile number *"}</Tx></label>
                          <input
                            value={liveChatPhone}
                            onChange={e => setLiveChatPhone(e.target.value)}
                            placeholder="+91 98765 43210"
                            type="tel"
                            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-500/50 placeholder-muted-foreground/50"
                          />
                          <p className="text-[10px] text-muted-foreground/70 mt-1">
                            <Tx>{"If you've chatted before, adding the same number picks up right where you left off — even from a different device or browser."}</Tx>
                          </p>
                        </div>
                          </>
                        )}
                        <div>
                          <label className="block text-xs font-semibold text-muted-foreground mb-1"><Tx>{"Your Message *"}</Tx></label>
                          <textarea
                            value={liveChatInitMsg}
                            onChange={e => setLiveChatInitMsg(e.target.value)}
                            placeholder={__tx("Hi, I'd like to discuss...")}
                            rows={4}
                            className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-500/50 resize-none placeholder-muted-foreground/50"
                          />
                        </div>
                      </div>
                      {liveChatStartError && (
                        <p className="text-xs text-red-500 flex items-center gap-1.5">
                          <RotateCw className="w-3 h-3" /> {liveChatStartError}
                        </p>
                      )}
                      <button
                        onClick={startLiveChat}
                        disabled={(!chatIdentity && (!liveChatName.trim() || !liveChatEmail.trim() || !liveChatPhone.trim())) || !liveChatInitMsg.trim() || liveChatStarting}
                        className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white text-sm font-medium disabled:opacity-40 transition-opacity"
                      >
                        {liveChatStarting
                          ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('ai.starting')}</>
                          : liveChatStartError
                            ? <><RotateCw className="w-4 h-4" /> {t('ai.send_again')}</>
                            : <><MessageCircle className="w-4 h-4" /> {t('ai.start_live')}</>}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            )}

            {/* ── Hire banner ── */}
            <AnimatePresence>
              {showHireBanner && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="bg-gradient-to-r from-blue-600/20 to-cyan-500/10 border-b border-blue-500/20 overflow-hidden flex-shrink-0"
                >
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Briefcase className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <p className="text-xs text-blue-300 flex-1 min-w-0">
                      <strong>{t('ai.hire_banner')}</strong> {t('ai.hire_avail')}
                    </p>
                    <div className="flex gap-1 flex-shrink-0">
                      {waUrl && (
                        <a href={waUrl} target="_blank" rel="noopener noreferrer"
                          className="px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-full border border-green-500/30 hover:bg-green-500/30 transition-colors flex items-center gap-1">
                          <Phone className="w-3 h-3" /> <Tx>{"WA"}</Tx>
                        </a>
                      )}
                      {settings.calendly_url && (
                        <a href={settings.calendly_url} target="_blank" rel="noopener noreferrer"
                          className="px-2 py-1 bg-purple-500/20 text-purple-300 text-xs rounded-full border border-purple-500/30 hover:bg-purple-500/30 transition-colors flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {t('ai.call')}
                        </a>
                      )}
                    </div>
                    <button onClick={() => setShowHireBanner(false)} className="text-white/40 hover:text-white/70 flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Messages ── */}
            <div className="chat-messages-container flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 }}
                  className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2.5 ${
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-sm rounded-tr-sm'
                      : 'bg-secondary text-foreground rounded-tl-sm'
                  }`}>
                    {m.role === 'assistant'
                      ? <MessageContent content={m.content} />
                      : <p className="text-sm leading-relaxed">{m.content}</p>
                    }
                  </div>
                </motion.div>
              ))}

              {/* Typewriter message being typed */}
              {typingMessageId && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-2 justify-start"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="max-w-[85%] rounded-2xl px-3 py-2.5 bg-secondary text-foreground rounded-tl-sm">
                    <MessageContent content={displayedContent[typingMessageId] || ''} />
                    <span className="inline-block w-2 h-4 bg-blue-500 ml-1 animate-pulse" />
                  </div>
                </motion.div>
              )}

              {loading && !typingMessageId && (
                <div className="flex gap-2 items-center">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce"
                        style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              )}

              {messages.length === 1 && !loading && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SUGGESTED.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="text-xs px-3 py-1.5 bg-secondary hover:bg-secondary/80 border border-border rounded-full text-muted-foreground hover:text-foreground transition-colors text-left">
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* ── Quick action buttons ── */}
            <div className="px-3 pb-1 flex gap-2 flex-shrink-0 justify-center">
              <button onClick={() => send("Is Abhishek available for hire?")}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs rounded-xl whitespace-nowrap transition-colors font-medium">
                <Briefcase className="w-3.5 h-3.5" /> {t('ai.hire_me')}
              </button>
              {waUrl && (
                <a href={waUrl} target="_blank" rel="noopener noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 text-xs rounded-xl whitespace-nowrap transition-colors font-medium">
                  <Phone className="w-3.5 h-3.5" /> <Tx>{"WhatsApp"}</Tx>
                </a>
              )}
              <button onClick={() => setShowLiveChat(true)}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-violet-500/10 hover:bg-violet-500/20 border border-violet-500/20 text-violet-400 text-xs rounded-xl whitespace-nowrap transition-colors font-medium">
                <MessageCircle className="w-3.5 h-3.5" /> {t('ai.live_chat')}
              </button>
            </div>

            {/* ── Input ── */}
            <div className="px-3 py-3 border-t border-border flex-shrink-0">
              <div className="flex gap-2 items-center">
                {(
                  <button
                    onClick={toggleVoice}
                    disabled={!voiceSupported}
                    aria-label={isListening ? t('ai.stop_listen') : t('ai.voice_input')}
                    title={!voiceSupported ? 'Voice input is not supported in this browser' : (isListening ? t('ai.stop_listen') : t('ai.voice_input'))}
                    className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                      isListening
                        ? 'bg-red-500 text-white animate-pulse'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </button>
                )}
                <input
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                  placeholder={isListening ? t('ai.listening') : t('ai.input_ph')}
                  className="flex-1 bg-secondary rounded-full px-4 py-2 text-sm outline-none placeholder-muted-foreground text-foreground min-w-0"
                />
                <button
                  onClick={() => send()}
                  disabled={!input.trim() || loading}
                  className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white disabled:opacity-40 transition-opacity flex-shrink-0"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              {isListening && (
                <p className="text-center text-xs text-red-400 mt-1.5 animate-pulse">
                  {t('ai.listening_hint')}
                </p>
              )}
              {voiceNotice && (
                <p role="status" className="text-center text-xs text-amber-500 mt-1.5">{voiceNotice}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </>
  )
}
