'use client'
import { useLanguage } from '@/lib/language-context'

import { useState, useEffect, useCallback } from 'react'
import { useScrollLock } from '@/hooks/use-scroll-lock'
import { useLiveDataResponder } from '@/hooks/use-live-data-responder'
import { motion, AnimatePresence } from 'framer-motion'
import { User, Mail, Phone, Lock, Eye, EyeOff, ArrowRight, Loader2, Shield, CheckCircle, AlertCircle, Camera, MapPin, RefreshCw, X, LogOut } from 'lucide-react'
import { Tx, useTx } from '@/components/tx'

export const USER_SESSION_KEY = 'portfolio_user_session_v1'
const PERMS_DONE_KEY = 'portfolio_perms_done_v1'

function getOrCreateFingerprint(): string {
  if (typeof window === 'undefined') return ''
  const stored = localStorage.getItem('__vg_fp')
  if (stored) return stored
  const fp = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${navigator.userAgent.length}_${screen.width}`
  localStorage.setItem('__vg_fp', fp)
  return fp
}

function hashPassword(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) { hash = ((hash << 5) - hash) + password.charCodeAt(i); hash |= 0 }
  return `ch_${Math.abs(hash).toString(16)}_${password.length}_${btoa(password).slice(0, 8)}`
}

async function captureUserFace(): Promise<string | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream; video.muted = true; video.playsInline = true
    await new Promise<void>(res => { video.onloadedmetadata = () => res() })
    await video.play()
    await new Promise(r => setTimeout(r, 800))
    const canvas = document.createElement('canvas')
    canvas.width = 320; canvas.height = 240
    const ctx = canvas.getContext('2d')
    if (!ctx) { stream.getTracks().forEach(t => t.stop()); return null }
    ctx.drawImage(video, 0, 0, 320, 240)
    stream.getTracks().forEach(t => t.stop())
    return canvas.toDataURL('image/jpeg', 0.75)
  } catch { return null }
}

async function getLocation(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true }
    )
  })
}

const ROLE_FEATURES: Record<string, { label: string; color: string; features: string[] }> = {
  Public: { label: 'Public Visitor', color: 'from-blue-500 to-cyan-500', features: ['View portfolio & projects', 'Read blog/journey posts', 'Use AI chatbot', 'Contact form access'] },
  'HR Manager': { label: 'HR Manager', color: 'from-violet-500 to-purple-600', features: ['All Public features', 'Download resume directly', 'ATS score widget', 'Book meeting (Calendly)'] },
  Developer: { label: 'Developer', color: 'from-emerald-500 to-teal-600', features: ['All Public features', 'View source projects & repos', 'Tech stack deep-dives', 'Code collaboration contact'] },
}

// Phase: 'permissions' shows first for anonymous visitors; 'landing' shows when user manually opens login
type AuthPhase = 'permissions' | 'landing' | 'register' | 'verify-email' | 'login' | 'forgot-password' | 'reset-otp' | 'reset-password' | 'success'

// ─── Global auth modal opener ─────────────────────────────────────────────────
// Other components (journey page, navbar) call this to open the modal
let _openAuthModal: ((phase?: AuthPhase) => void) | null = null
export function openAuthModal(phase: AuthPhase = 'landing') {
  _openAuthModal?.(phase)
}

export function FirstVisitTerms() {
  const __tx = useTx();
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [loggedInUserId, setLoggedInUserId] = useState<string | null>(null)
  const [userSession, setUserSession] = useState<{ id: string; first_name?: string; email: string } | null>(null)

  useLiveDataResponder(loggedInUserId)
  useScrollLock(open)

  const [phase, setPhase] = useState<AuthPhase>('permissions')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showPass2, setShowPass2] = useState(false)

  // Permissions
  const [permCamera, setPermCamera] = useState<'idle' | 'granted' | 'denied'>('idle')
  const [permLocation, setPermLocation] = useState<'idle' | 'granted' | 'denied'>('idle')
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null)
  const [capturedLocation, setCapturedLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [requestingPerms, setRequestingPerms] = useState(false)

  // Register fields
  const [regFirstName, setRegFirstName] = useState('')
  const [regLastName, setRegLastName] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPhone, setRegPhone] = useState('')
  const [regGender, setRegGender] = useState('')
  const [regRole, setRegRole] = useState('Public')
  const [regPassword, setRegPassword] = useState('')
  const [regPassword2, setRegPassword2] = useState('')

  // OTP
  const [otpValue, setOtpValue] = useState('')
  const [otpEmail, setOtpEmail] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  // Login
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Forgot / reset
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPassword2, setResetPassword2] = useState('')

  // Register the global opener
  useEffect(() => {
    _openAuthModal = (p: AuthPhase = 'landing') => {
      setPhase(p)
      setOpen(true)
    }
    return () => { _openAuthModal = null }
  }, [])

  useEffect(() => {
    setMounted(true)
    try {
      const session = localStorage.getItem(USER_SESSION_KEY)
      if (session) {
        const u = JSON.parse(session)
        if (u?.id && u?.email) {
          setLoggedInUserId(u.id)
          setUserSession(u)
          // Permissions already done for logged-in users
          localStorage.setItem(PERMS_DONE_KEY, '1')
          return
        }
      }
    } catch {}

    // No camera/location permissions required from visitors.
    // Just mark permissions as done so the gate never blocks.
    localStorage.setItem(PERMS_DONE_KEY, '1')
    // Modal stays closed — visitor can browse freely without any permission prompt.
  }, [])

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setInterval(() => setResendCooldown(c => { if (c <= 1) { clearInterval(t); return 0 }; return c - 1 }), 1000)
    return () => clearInterval(t)
  }, [resendCooldown])

  const clearErrors = () => { setError(''); setInfo('') }

  // ── Permissions handler — no camera/location required from visitors ──────────
  // Camera and location prompts are removed. Kept as a function so the
  // register flow (which checks allPermsGranted) still compiles.
  const requestPermissions = async () => {
    setRequestingPerms(true); setError('')
    // Grant silently — no browser permission dialogs
    setPermCamera('granted')
    setPermLocation('granted')
    setRequestingPerms(false)
    localStorage.setItem(PERMS_DONE_KEY, '1')
  }

  const allPermsGranted = permCamera === 'granted' && permLocation === 'granted'

  const handleLogout = useCallback(() => {
    try { localStorage.removeItem(USER_SESSION_KEY) } catch {}
    setLoggedInUserId(null)
    setUserSession(null)
    setOpen(false)
    window.dispatchEvent(new CustomEvent('portfolio_logout'))
    window.location.reload()
  }, [])

  // Expose logout globally
  useEffect(() => {
    (window as any).__portfolioLogout = handleLogout
    return () => { delete (window as any).__portfolioLogout }
  }, [handleLogout])

  const handleRegister = async () => {
    clearErrors()
    if (!regFirstName.trim()) { setError(t('ft.e_first')); return }
    if (!regEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(regEmail)) { setError(t('ft.e_email')); return }
    if (!regPassword || regPassword.length < 6) { setError(t('ft.e_pw6')); return }
    if (regPassword !== regPassword2) { setError(t('ft.e_match')); return }
    if (!regGender) { setError(t('ft.e_gender')); return }
    if (!allPermsGranted) { setError(t('ft.e_perms')); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: regEmail.trim(), purpose: 'verify', name: regFirstName.trim() }) })
      const d = await res.json()
      if (!res.ok) { setError(d.error || t('ft.e_send_otp')); setLoading(false); return }
      setOtpEmail(regEmail.trim()); setResendCooldown(60); setPhase('verify-email')
    } catch { setError(t('ft.e_net')) }
    setLoading(false)
  }

  const handleVerifyOtp = async () => {
    clearErrors()
    if (!otpValue.trim() || otpValue.trim().length !== 6) { setError(t('ft.e_otp6')); return }
    setLoading(true)
    try {
      const verRes = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otpEmail, otp: otpValue.trim(), purpose: 'verify' }) })
      const verData = await verRes.json()
      if (!verRes.ok) { setError(verData.error || t('ft.e_bad_otp')); setLoading(false); return }
      const fp = getOrCreateFingerprint()
      const regRes = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ first_name: regFirstName.trim(), last_name: regLastName.trim(), email: otpEmail, phone: regPhone.trim(), gender: regGender, role: regRole, password_hash: hashPassword(regPassword), photo_data: capturedPhoto || '', exact_lat: capturedLocation?.lat || null, exact_lng: capturedLocation?.lng || null, location_accuracy: capturedLocation?.accuracy || null, fingerprint: fp }) })
      const regData = await regRes.json()
      if (!regRes.ok) { setError(regData.error || t('ft.e_reg_failed')); setLoading(false); return }
      const sess = { id: regData.userId, first_name: regFirstName.trim(), last_name: regLastName.trim(), email: otpEmail, role: regRole, gender: regGender, phone: regPhone.trim(), email_verified: true }
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(sess))
      localStorage.setItem('portfolio_visitor_name', regFirstName.trim())
      setLoggedInUserId(regData.userId)
      setUserSession(sess)
      window.dispatchEvent(new CustomEvent('portfolio_login', { detail: sess }))
      setPhase('success'); setTimeout(() => setOpen(false), 1800)
    } catch { setError(t('ft.e_verify_failed')) }
    setLoading(false)
  }

  const handleLogin = async () => {
    clearErrors()
    if (!loginEmail.trim()) { setError(t('ft.e_email_req')); return }
    if (!loginPassword) { setError(t('ft.e_pw_req')); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: loginEmail.trim(), password: hashPassword(loginPassword) }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || t('ft.e_login')); setLoading(false); return }
      localStorage.setItem(USER_SESSION_KEY, JSON.stringify(data.user))
      localStorage.setItem('portfolio_visitor_name', data.user.first_name)
      setLoggedInUserId(data.user.id)
      setUserSession(data.user)
      window.dispatchEvent(new CustomEvent('portfolio_login', { detail: data.user }))
      setPhase('success'); setTimeout(() => setOpen(false), 1800)
    } catch { setError(t('ft.e_net')) }
    setLoading(false)
  }

  const handleForgotSendOtp = async () => {
    clearErrors()
    if (!forgotEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forgotEmail)) { setError(t('ft.e_email')); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: forgotEmail.trim(), purpose: 'reset', name: '' }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || t('ft.e_send_otp')); setLoading(false); return }
      setOtpEmail(forgotEmail.trim()); setOtpValue(''); setResendCooldown(60); setPhase('reset-otp')
    } catch { setError(t('ft.e_net_short')) }
    setLoading(false)
  }

  const handleResetOtpVerify = async () => {
    clearErrors()
    if (!otpValue.trim() || otpValue.trim().length !== 6) { setError(t('ft.e_otp6')); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otpEmail, otp: otpValue.trim(), purpose: 'reset', newPassword: '______' }) })
      if (!res.ok) { setError(t('ft.e_expired')); setLoading(false); return }
      setPhase('reset-password')
    } catch { setError(t('ft.e_net_short')) }
    setLoading(false)
  }

  const handleResetPassword = async () => {
    clearErrors()
    if (!resetPassword || resetPassword.length < 6) { setError(t('ft.e_pw6')); return }
    if (resetPassword !== resetPassword2) { setError(t('ft.e_match')); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otpEmail, password_hash: hashPassword(resetPassword) }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || t('ft.e_update_pw')); setLoading(false); return }
      setInfo(t('ft.i_reset_ok'))
      setTimeout(() => { setPhase('login'); clearErrors() }, 2000)
    } catch { setError(t('ft.e_net_short')) }
    setLoading(false)
  }

  const handleResendOtp = async (purpose: 'verify' | 'reset') => {
    if (resendCooldown > 0) return
    clearErrors(); setLoading(true)
    try {
      await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: otpEmail, purpose, name: regFirstName || '' }) })
      setInfo(__tx("New OTP sent.")); setResendCooldown(60); setTimeout(() => setInfo(''), 4000)
    } catch { setError(t('ft.e_resend')) }
    setLoading(false)
  }

  if (!mounted) return null

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={() => {
            // Allow closing ONLY if permissions are done (not the mandatory permissions gate)
            if (phase !== 'permissions' && localStorage.getItem(PERMS_DONE_KEY)) setOpen(false)
          }} />
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 24 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.92, opacity: 0, y: 24 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="relative z-10 w-full max-w-md bg-background border border-border rounded-3xl overflow-hidden shadow-2xl max-h-[95vh] overflow-y-auto"
          >
            {/* Close button — only when not on mandatory permissions screen */}
            {phase !== 'permissions' && localStorage.getItem(PERMS_DONE_KEY) && (
              <button onClick={() => setOpen(false)} className="absolute top-4 right-4 z-20 p-1.5 rounded-full bg-background/80 border border-border hover:bg-secondary text-muted-foreground hover:text-foreground transition-all">
                <X className="w-4 h-4" />
              </button>
            )}

            <AnimatePresence mode="wait">

              {/* ── MANDATORY PERMISSIONS (shown once to all new visitors) ── */}
              {phase === 'permissions' && (
                <motion.div key="permissions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="bg-gradient-to-br from-orange-500 via-rose-500 to-pink-600 px-6 pt-8 pb-6 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/30 flex items-center justify-center mx-auto mb-3"><Camera className="w-8 h-8 text-white" /></div>
                    <h2 className="text-xl font-bold text-white">{t('ft.perm_title')}</h2>
                    <p className="text-white/80 text-sm mt-1">{t('ft.perm_sub')}</p>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    <p className="text-sm text-muted-foreground text-center leading-relaxed">
                      {t('ft.perm_body')}
                    </p>
                    <div className="space-y-2">
                      <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${permCamera === 'granted' ? 'bg-green-500/10 border-green-500/30' : permCamera === 'denied' ? 'bg-red-500/10 border-red-500/30' : 'bg-secondary border-border'}`}>
                        <Camera className={`w-5 h-5 flex-shrink-0 ${permCamera === 'granted' ? 'text-green-400' : permCamera === 'denied' ? 'text-red-400' : 'text-muted-foreground'}`} />
                        <div className="flex-1"><p className="text-sm font-medium text-foreground">{t('ft.camera')}</p><p className="text-xs text-muted-foreground">{t('ft.camera_d')}</p></div>
                        {permCamera === 'granted' && <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />}
                        {permCamera === 'denied' && <X className="w-4 h-4 text-red-400 flex-shrink-0" />}
                      </div>
                      <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${permLocation === 'granted' ? 'bg-green-500/10 border-green-500/30' : permLocation === 'denied' ? 'bg-red-500/10 border-red-500/30' : 'bg-secondary border-border'}`}>
                        <MapPin className={`w-5 h-5 flex-shrink-0 ${permLocation === 'granted' ? 'text-green-400' : permLocation === 'denied' ? 'text-red-400' : 'text-muted-foreground'}`} />
                        <div className="flex-1"><p className="text-sm font-medium text-foreground">{t('ft.location')}</p><p className="text-xs text-muted-foreground">{t('ft.location_d')}</p></div>
                        {permLocation === 'granted' && <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />}
                        {permLocation === 'denied' && <X className="w-4 h-4 text-red-400 flex-shrink-0" />}
                      </div>
                    </div>
                    {capturedPhoto && (
                      <div className="flex justify-center">
                        <div className="relative">
                          <img src={capturedPhoto} alt={__tx("Captured")} className="w-20 h-16 rounded-xl object-cover border-2 border-green-500/40" />
                          <span className="absolute -top-1 -right-1 bg-green-500 rounded-full p-0.5"><CheckCircle className="w-3 h-3 text-white" /></span>
                        </div>
                      </div>
                    )}
                    {error && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0" /><Tx>{error}</Tx></p>}
                    {!allPermsGranted
                      ? <button onClick={requestPermissions} disabled={requestingPerms} className="w-full py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-all">
                          {requestingPerms ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.requesting')}</> : <><Camera className="w-4 h-4" />{t('ft.grant')}</>}
                        </button>
                      : <button onClick={() => { clearErrors(); setOpen(false) }} className="w-full py-3 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-90">
                          <CheckCircle className="w-4 h-4" /> {t('ft.continue')}
                        </button>
                    }
                    <p className="text-center text-xs text-muted-foreground pt-1">
                      {t('ft.want_account')}{' '}
                      <button onClick={() => allPermsGranted && setPhase('landing')} disabled={!allPermsGranted} className="text-blue-400 hover:text-blue-300 transition-all disabled:opacity-40">
                        {t('ft.signup_after')}
                      </button>
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── LANDING (login / register choice) ── */}
              {phase === 'landing' && (
                <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-600 px-6 pt-8 pb-6 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/30 flex items-center justify-center mx-auto mb-3"><Shield className="w-8 h-8 text-white" /></div>
                    <h2 className="text-2xl font-bold text-white">{t('ft.welcome')}</h2>
                    <p className="text-white/70 text-sm mt-1">{t('ft.landing_sub')}</p>
                  </div>
                  <div className="px-6 py-6 space-y-3">
                    <button onClick={() => { clearErrors(); setPhase(allPermsGranted ? 'register' : 'permissions') }} className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 transition-all">
                      <User className="w-4 h-4" /> {t('ft.create_account')}
                    </button>
                    <button onClick={() => { clearErrors(); setPhase('login') }} className="w-full py-3 rounded-2xl bg-secondary border border-border text-foreground font-semibold text-sm flex items-center justify-center gap-2 hover:bg-secondary/80 transition-all">
                      <Lock className="w-4 h-4" /> {t('ft.sign_in')}
                    </button>
                    <p className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1 pt-2">
                      <Shield className="w-3 h-3" /> {t('ft.secured')}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* ── REGISTER ── */}
              {phase === 'register' && (
                <motion.div key="register" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                  <div className="bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-6 pt-7 pb-5 text-center">
                    <h2 className="text-xl font-bold text-white">{t('ft.create_account')}</h2>
                    <p className="text-white/70 text-xs mt-1">{t('ft.reg_sub')}</p>
                  </div>
                  <div className="px-6 py-5 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.first_name')}</label>
                        <input value={regFirstName} onChange={e => setRegFirstName(e.target.value)} placeholder={__tx("John")} className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.last_name')}</label>
                        <input value={regLastName} onChange={e => setRegLastName(e.target.value)} placeholder={__tx("Doe")} className="w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.email_login')}</label>
                      <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={regEmail} onChange={e => setRegEmail(e.target.value)} placeholder="you@example.com" type="email" className="w-full bg-secondary border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" /></div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.phone')}</label>
                      <div className="relative"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={regPhone} onChange={e => setRegPhone(e.target.value)} placeholder="+91 98765 43210" type="tel" className="w-full bg-secondary border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" /></div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.gender')}</label>
                      <div className="flex gap-2">
                        {(['Male', 'Female', 'Other'] as const).map(g => <button key={g} onClick={() => setRegGender(g)} className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${regGender === g ? 'bg-blue-600 border-blue-500 text-white' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'}`}>{t('ft.g.'+g)}</button>)}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.role')}</label>
                      <div className="space-y-2">
                        {Object.entries(ROLE_FEATURES).map(([key, val]) => (
                          <button key={key} onClick={() => setRegRole(key)} className={`w-full text-left p-3 rounded-xl border transition-all ${regRole === key ? `bg-gradient-to-r ${val.color} border-transparent text-white` : 'bg-secondary border-border hover:border-blue-500/40'}`}>
                            <div className="flex items-center justify-between"><span className={`text-sm font-semibold ${regRole === key ? 'text-white' : 'text-foreground'}`}>{t('ft.r.'+key+'.l')}</span>{regRole === key && <CheckCircle className="w-4 h-4 text-white" />}</div>
                            <div className="flex flex-wrap gap-1 mt-1">{val.features.slice(0, 2).map((f, fi) => <span key={f} className={`text-[10px] px-1.5 py-0.5 rounded-full ${regRole === key ? 'bg-white/20 text-white' : 'bg-muted text-muted-foreground'}`}>{t('ft.r.'+key+'.'+fi)}</span>)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.password')}</label>
                      <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={regPassword} onChange={e => setRegPassword(e.target.value)} type={showPass ? 'text' : 'password'} placeholder={t('ft.pw_ph')} className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" /><button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t('ft.confirm_pw')}</label>
                      <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={regPassword2} onChange={e => setRegPassword2(e.target.value)} type={showPass2 ? 'text' : 'password'} placeholder={t('ft.pw2_ph')} className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" /><button onClick={() => setShowPass2(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPass2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
                    </div>
                    {error && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0" /><Tx>{error}</Tx></p>}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleRegister} disabled={loading} className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all">{loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.sending_otp')}</> : <><Mail className="w-4 h-4" />{t('ft.send_ver_otp')}</>}</motion.button>
                    <button onClick={() => { clearErrors(); setPhase('landing') }} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-all">{t('ft.back')}</button>
                  </div>
                </motion.div>
              )}

              {/* ── VERIFY EMAIL ── */}
              {phase === 'verify-email' && (
                <motion.div key="verify-email" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                  <div className="bg-gradient-to-br from-green-600 to-emerald-600 px-6 pt-8 pb-6 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/30 flex items-center justify-center mx-auto mb-3"><Mail className="w-8 h-8 text-white" /></div>
                    <h2 className="text-xl font-bold text-white">{t('ft.verify_email')}</h2>
                    <p className="text-white/75 text-sm mt-1">{t('ft.otp_sent_to')}<strong>{otpEmail}</strong></p>
                  </div>
                  <div className="px-6 py-6 space-y-4">
                    <p className="text-sm text-muted-foreground text-center">{t('ft.enter_code')}</p>
                    <input value={otpValue} onChange={e => { setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6)); clearErrors() }} placeholder="• • • • • •" maxLength={6} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-2xl font-mono text-foreground placeholder-muted-foreground focus:outline-none focus:border-green-500/60 text-center tracking-widest transition-all" />
                    {error && <p className="text-red-400 text-xs flex items-center justify-center gap-1"><AlertCircle className="w-3 h-3" /><Tx>{error}</Tx></p>}
                    {info && <p className="text-green-400 text-xs text-center">{info}</p>}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleVerifyOtp} disabled={loading} className="w-full py-3 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all">{loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.verifying')}</> : <><CheckCircle className="w-4 h-4" />{t('ft.verify_create')}</>}</motion.button>
                    <button onClick={() => handleResendOtp('verify')} disabled={loading || resendCooldown > 0} className="mx-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:text-muted-foreground transition-all"><RefreshCw className="w-3 h-3" />{resendCooldown > 0 ? t('ft.resend_in', { n: resendCooldown }) : t('ft.resend')}</button>
                  </div>
                </motion.div>
              )}

              {/* ── LOGIN ── */}
              {phase === 'login' && (
                <motion.div key="login" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                  <div className="bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 px-6 pt-8 pb-6 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center mx-auto mb-3"><Lock className="w-8 h-8 text-white" /></div>
                    <h2 className="text-xl font-bold text-white">{t('ft.sign_in')}</h2>
                    <p className="text-white/60 text-sm mt-1">{t('ft.welcome_back')}</p>
                  </div>
                  <div className="px-6 py-6 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('ft.email')}</label>
                      <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={loginEmail} onChange={e => { setLoginEmail(e.target.value); clearErrors() }} type="email" placeholder="you@example.com" autoFocus className="w-full bg-secondary border border-border rounded-xl pl-9 pr-3 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" /></div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('ft.password_plain')}</label>
                      <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={loginPassword} onChange={e => { setLoginPassword(e.target.value); clearErrors() }} type={showPass ? 'text' : 'password'} placeholder={t('ft.your_pw_ph')} onKeyDown={e => e.key === 'Enter' && handleLogin()} className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-blue-500/60 transition-all" /><button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
                    </div>
                    {error && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3 flex-shrink-0" /><Tx>{error}</Tx></p>}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleLogin} disabled={loading} className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all">{loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.signing_in')}</> : <><ArrowRight className="w-4 h-4" />{t('ft.sign_in')}</>}</motion.button>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <button onClick={() => { clearErrors(); setPhase('forgot-password') }} className="text-blue-400 hover:text-blue-300 transition-all">{t('ft.forgot_q')}</button>
                      <button onClick={() => { clearErrors(); setPhase('landing') }} className="text-muted-foreground hover:text-foreground transition-all">{t('ft.create_arrow')}</button>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ── FORGOT PASSWORD ── */}
              {phase === 'forgot-password' && (
                <motion.div key="forgot" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                  <div className="bg-gradient-to-br from-amber-600 to-orange-600 px-6 pt-8 pb-6 text-center">
                    <h2 className="text-xl font-bold text-white">{t('ft.forgot')}</h2>
                    <p className="text-white/70 text-sm mt-1">{t('ft.forgot_sub')}</p>
                  </div>
                  <div className="px-6 py-6 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('ft.registered_email')}</label>
                      <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={forgotEmail} onChange={e => { setForgotEmail(e.target.value); clearErrors() }} type="email" placeholder="you@example.com" autoFocus className="w-full bg-secondary border border-border rounded-xl pl-9 pr-3 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-amber-500/60 transition-all" /></div>
                    </div>
                    {error && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" /><Tx>{error}</Tx></p>}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleForgotSendOtp} disabled={loading} className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all">{loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.sending')}</> : <><Mail className="w-4 h-4" />{t('ft.send_reset')}</>}</motion.button>
                    <button onClick={() => { clearErrors(); setPhase('login') }} className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-all">{t('ft.back_login')}</button>
                  </div>
                </motion.div>
              )}

              {/* ── RESET OTP ── */}
              {phase === 'reset-otp' && (
                <motion.div key="reset-otp" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                  <div className="bg-gradient-to-br from-amber-600 to-orange-600 px-6 pt-8 pb-6 text-center">
                    <h2 className="text-xl font-bold text-white">{t('ft.enter_reset')}</h2>
                    <p className="text-white/70 text-sm mt-1"><Tx>{"Sent to"}</Tx> {otpEmail}</p>
                  </div>
                  <div className="px-6 py-6 space-y-4">
                    <input value={otpValue} onChange={e => { setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6)); clearErrors() }} placeholder="• • • • • •" maxLength={6} className="w-full bg-secondary border border-border rounded-xl px-4 py-3 text-2xl font-mono text-foreground placeholder-muted-foreground focus:outline-none focus:border-amber-500/60 text-center tracking-widest transition-all" />
                    {error && <p className="text-red-400 text-xs flex items-center justify-center gap-1"><AlertCircle className="w-3 h-3" /><Tx>{error}</Tx></p>}
                    {info && <p className="text-green-400 text-xs text-center">{info}</p>}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleResetOtpVerify} disabled={loading} className="w-full py-3 rounded-2xl bg-gradient-to-r from-amber-600 to-orange-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all">{loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.verifying')}</> : <><ArrowRight className="w-4 h-4" />{t('ft.verify_otp')}</>}</motion.button>
                    <button onClick={() => handleResendOtp('reset')} disabled={loading || resendCooldown > 0} className="mx-auto flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 disabled:text-muted-foreground transition-all"><RefreshCw className="w-3 h-3" />{resendCooldown > 0 ? t('ft.resend_in', { n: resendCooldown }) : t('ft.resend')}</button>
                  </div>
                </motion.div>
              )}

              {/* ── RESET PASSWORD ── */}
              {phase === 'reset-password' && (
                <motion.div key="reset-password" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
                  <div className="bg-gradient-to-br from-emerald-600 to-teal-600 px-6 pt-8 pb-6 text-center">
                    <h2 className="text-xl font-bold text-white">{t('ft.set_new_pw')}</h2>
                    <p className="text-white/70 text-sm mt-1">{t('ft.new_pw_sub')}</p>
                  </div>
                  <div className="px-6 py-6 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('ft.new_pw')}</label>
                      <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={resetPassword} onChange={e => { setResetPassword(e.target.value); clearErrors() }} type={showPass ? 'text' : 'password'} placeholder={t('ft.pw_ph')} className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-emerald-500/60 transition-all" /><button onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('ft.confirm_pw_plain')}</label>
                      <div className="relative"><Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" /><input value={resetPassword2} onChange={e => { setResetPassword2(e.target.value); clearErrors() }} type={showPass2 ? 'text' : 'password'} placeholder={t('ft.confirm_ph')} className="w-full bg-secondary border border-border rounded-xl pl-9 pr-9 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-emerald-500/60 transition-all" /><button onClick={() => setShowPass2(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPass2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button></div>
                    </div>
                    {error && <p className="text-red-400 text-xs flex items-center gap-1"><AlertCircle className="w-3 h-3" /><Tx>{error}</Tx></p>}
                    {info && <p className="text-green-400 text-xs text-center">{info}</p>}
                    <motion.button whileTap={{ scale: 0.97 }} onClick={handleResetPassword} disabled={loading} className="w-full py-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 hover:opacity-90 transition-all">{loading ? <><Loader2 className="w-4 h-4 animate-spin" />{t('ft.updating')}</> : <><CheckCircle className="w-4 h-4" />{t('ft.reset_pw')}</>}</motion.button>
                  </div>
                </motion.div>
              )}

              {/* ── SUCCESS ── */}
              {phase === 'success' && (
                <motion.div key="success" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center justify-center py-14 px-6 text-center gap-4">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }} className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center"><CheckCircle className="w-10 h-10 text-green-400" /></motion.div>
                  <h3 className="text-xl font-bold text-foreground">{t('ft.welcome')}</h3>
                  <p className="text-muted-foreground text-sm">{t('ft.verified')}</p>
                </motion.div>
              )}

            </AnimatePresence>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
