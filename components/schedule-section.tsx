'use client'
import { useLanguage } from '@/lib/language-context'
/**
 * ScheduleSection — renders on the public portfolio homepage.
 * Full scheduling form with:
 *  • Purpose selector (Interview / Consultation / Freelance / Other)
 *  • Interview: Recruiter Name, Recruiter Email (company-based), Company Name, Your Role (all mandatory)
 *  • Consultation/Freelance: Company & Role hidden
 *  • Real-time availability grid fetched from /api/schedule/availability
 *  • Platform picker, Duration picker
 *  • Inline success state
 */
import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Calendar, Clock, User, Mail, Building2, Briefcase,
  MessageSquare, CheckCircle2, X, Loader2, Video,
  ChevronLeft, ChevronRight, Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tx } from '@/components/tx'

/* ── Recruiter email domain map ─────────────────────────────────────────────── */
const COMPANY_EMAIL_DOMAINS: Record<string, string> = {
  // Private / Tech
  amazon: 'amazon.com',
  tcs: 'tcs.com',
  flipkart: 'flipkart.com',
  infosys: 'infosys.com',
  wipro: 'wipro.com',
  accenture: 'accenture.com',
  cognizant: 'cognizant.com',
  hcl: 'hcltech.com',
  'hcl technologies': 'hcltech.com',
  'tech mahindra': 'techmahindra.com',
  capgemini: 'capgemini.com',
  ibm: 'ibm.com',
  microsoft: 'microsoft.com',
  google: 'google.com',
  meta: 'meta.com',
  facebook: 'meta.com',
  apple: 'apple.com',
  oracle: 'oracle.com',
  sap: 'sap.com',
  deloitte: 'deloitte.com',
  pwc: 'pwc.com',
  ey: 'ey.com',
  kpmg: 'kpmg.com',
  // Government
  'indian navy': 'indiannavy.gov.in',
  nic: 'nic.gov.in',
  isro: 'isro.gov.in',
  drdo: 'drdo.gov.in',
  upsc: 'upsc.gov.in',
  'indian army': 'indianarmy.gov.in',
  'indian air force': 'iaf.nic.in',
  bsnl: 'bsnl.co.in',
  'indian railways': 'indianrailways.gov.in',
  irctc: 'irctc.co.in',
}

function getRecruiterEmailDomain(companyName: string): string {
  const key = companyName.trim().toLowerCase()
  if (COMPANY_EMAIL_DOMAINS[key]) return COMPANY_EMAIL_DOMAINS[key]
  // Check partial match
  for (const [company, domain] of Object.entries(COMPANY_EMAIL_DOMAINS)) {
    if (key.includes(company) || company.includes(key)) return domain
  }
  // Auto-derive: "Company Name" → companyname.com
  const sanitized = key.replace(/[^a-z0-9]/g, '')
  return sanitized ? `${sanitized}.com` : 'company.com'
}

/* ── Types ──────────────────────────────────────────────────────────────────── */
type Purpose  = 'interview' | 'consultation' | 'freelance' | 'other'
type Platform = 'google_meet' | 'zoom' | 'teams' | 'jitsi'

interface Availability {
  day_of_week: number
  start_time: string
  end_time: string
  is_active: boolean
  timezone: string
}

/* ── Constants ──────────────────────────────────────────────────────────────── */
const PURPOSES: { value: Purpose; label: string; icon: string; desc: string }[] = [
  { value: 'interview',    label: 'Interview',       icon: '💼', desc: 'Job / technical interview'      },
  { value: 'consultation', label: 'Consultation',    icon: '💡', desc: 'Technical advice or mentoring'  },
  { value: 'freelance',    label: 'Freelance',       icon: '🎯', desc: 'Project discussion / proposal'  },
  { value: 'other',        label: 'Other',           icon: '📅', desc: 'Something else entirely'        },
]

const PLATFORMS: { value: Platform; label: string; icon: string }[] = [
  { value: 'google_meet', label: 'Google Meet', icon: '🟢' },
  { value: 'zoom',        label: 'Zoom',        icon: '🔵' },
  { value: 'teams',       label: 'MS Teams',    icon: '🟣' },
  { value: 'jitsi',       label: 'Jitsi',       icon: '🎥' },
]

const DURATIONS = [30, 45, 60]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TIMEZONES = [
  'Asia/Kolkata','America/New_York','America/Los_Angeles','America/Chicago',
  'Europe/London','Europe/Berlin','Asia/Singapore','Asia/Tokyo','Australia/Sydney','UTC',
]
function generateTimeSlots(startTime: string, endTime: string): string[] {
  const slots: string[] = []
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  let cur = sh * 60 + sm
  const end = eh * 60 + em
  while (cur + 30 <= end) {
    const h = Math.floor(cur / 60).toString().padStart(2, '0')
    const m = (cur % 60).toString().padStart(2, '0')
    slots.push(`${h}:${m}`)
    cur += 30
  }
  return slots
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════════════════ */
export function ScheduleSection() {
  const { t, info } = useLanguage()
  const intl = info.intl
  const DAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(intl, { weekday: 'short' }))
  const pLabel = (v: string) => t(`sc.p_${v}`)
  const pDesc = (v: string) => t(`sc.p_${v}_d`)
  /* ── Form state ─────────────────────────────────────────────────────────── */
  const [purpose, setPurpose]               = useState<Purpose>('interview')
  const [name, setName]                     = useState('')
  const [email, setEmail]                   = useState('')
  const [company, setCompany]               = useState('')
  const [role, setRole]                     = useState('')
  const [message, setMessage]               = useState('')
  const [timezone, setTimezone]             = useState('Asia/Kolkata')
  const [platform, setPlatform]             = useState<Platform>('google_meet')
  const [duration, setDuration]             = useState(30)
  const [selectedDate, setSelectedDate]     = useState<string>('')  // "YYYY-MM-DD"
  const [selectedTime, setSelectedTime]     = useState<string>('')  // "HH:MM"
  const [submitting, setSubmitting]         = useState(false)
  const [success, setSuccess]               = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [step, setStep]                     = useState<1|2|3>(1)
  // Interview-specific recruiter fields
  const [recruiterName, setRecruiterName]   = useState('')
  const [recruiterEmail, setRecruiterEmail] = useState('')

  /* ── Availability state ─────────────────────────────────────────────────── */
  const [availability, setAvailability]   = useState<Availability[]>([])
  const [bookedSlots, setBookedSlots]     = useState<Record<string, string[]>>({})
  const [calMonth, setCalMonth]           = useState(() => new Date())
  const [availLoading, setAvailLoading]   = useState(true)

  /* ── Fetch availability ─────────────────────────────────────────────────── */
  const fetchAvailability = useCallback(async () => {
    setAvailLoading(true)
    try {
      const r = await fetch('/api/schedule/availability')
      if (r.ok) {
        const d = await r.json()
        setAvailability(d.availability || [])
        setBookedSlots(d.bookedSlots || {})
      }
    } catch {}
    finally { setAvailLoading(false) }
  }, [])

  useEffect(() => {
    fetchAvailability()
    /* Auto-detect timezone */
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone) } catch {}
    /* Poll every 60 s for real-time slot updates */
    const iv = setInterval(fetchAvailability, 60_000)
    return () => clearInterval(iv)
  }, [fetchAvailability])

  /* ── Calendar helpers ───────────────────────────────────────────────────── */
  const isDayAvailable = (date: Date): boolean => {
    const dow = date.getDay()
    const avEntry = availability.find(a => a.day_of_week === dow && a.is_active)
    if (!avEntry) return false
    const now = new Date()
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1); tomorrow.setHours(0,0,0,0)
    return date >= tomorrow
  }

  const getAvailableSlots = (dateStr: string): string[] => {
    const date = new Date(dateStr)
    const dow  = date.getDay()
    const avEntry = availability.find(a => a.day_of_week === dow && a.is_active)
    if (!avEntry) return []
    const allSlots   = generateTimeSlots(avEntry.start_time, avEntry.end_time)
    const booked     = (bookedSlots[dateStr] || []).map(b => b.substring(11, 16))
    return allSlots.filter(s => !booked.includes(s))
  }

  const calDays = (): (Date | null)[] => {
    const year  = calMonth.getFullYear()
    const month = calMonth.getMonth()
    const first = new Date(year, month, 1).getDay()
    const days  = new Date(year, month + 1, 0).getDate()
    const cells: (Date | null)[] = Array(first).fill(null)
    for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d))
    return cells
  }

  /* ── Validate recruiter email domain matches company ────────────────────── */
  const [recruiterEmailError, setRecruiterEmailError] = useState<string | null>(null)
  const [recruiterEmailBlocked, setRecruiterEmailBlocked] = useState(false)

  const validateRecruiterEmail = (emailVal: string, companyVal: string) => {
    if (!emailVal || !companyVal) { setRecruiterEmailError(null); setRecruiterEmailBlocked(false); return true }
    const domain = getRecruiterEmailDomain(companyVal)
    const emailDomain = emailVal.split('@')[1]?.toLowerCase() || ''
    // Allow if domain matches
    if (emailDomain === domain) { setRecruiterEmailError(null); setRecruiterEmailBlocked(false); return true }
    // Detect personal email providers
    const personal = ['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','rediffmail.com','ymail.com','aol.com','protonmail.com','live.com']
    if (personal.includes(emailDomain)) {
      setRecruiterEmailError(t('sc.email_personal', { company: companyVal, domain })); setRecruiterEmailBlocked(true)
      return false
    }
    // Allow if they typed a different company domain (we can't block all valid corp emails)
    // but warn if it doesn't match expected domain
    setRecruiterEmailError(t('sc.email_expected', { company: companyVal, domain })); setRecruiterEmailBlocked(false)
    return true // soft warning, not hard block
  }

  const handleRecruiterEmailChange = (val: string) => {
    setRecruiterEmail(val)
    validateRecruiterEmail(val, company)
  }

  // Re-validate when company changes
  useEffect(() => {
    if (purpose === 'interview' && recruiterEmail) {
      validateRecruiterEmail(recruiterEmail, company)
    } else {
      setRecruiterEmailError(null); setRecruiterEmailBlocked(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, purpose])

  /* ── Submit ─────────────────────────────────────────────────────────────── */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedDate || !selectedTime) { setError(t('sc.err_slot')); return }
    if (!name.trim() || !email.trim()) { setError(t('sc.err_name_email')); return }
    // Interview-specific validation
    if (purpose === 'interview') {
      if (!company.trim()) { setError(t('sc.err_company')); return }
      if (!recruiterName.trim()) { setError(t('sc.err_rname')); return }
      if (!role.trim()) { setError(t('sc.err_role')); return }
      if (!recruiterEmail.trim()) { setError(t('sc.err_remail')); return }
      // Block personal emails
      const personal = ['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','rediffmail.com','ymail.com','aol.com','protonmail.com','live.com']
      const emailDomain = recruiterEmail.split('@')[1]?.toLowerCase() || ''
      if (personal.includes(emailDomain)) {
        setError(t('sc.err_personal', { domain: emailDomain })); return
      }
    }
    setSubmitting(true); setError(null)

    try {
      const preferred_date = `${selectedDate}T${selectedTime}`
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, company, role, purpose, message,
          preferred_date, timezone, platform, duration_mins: duration,
          recruiter_name: purpose === 'interview' ? recruiterName : undefined,
          recruiter_email: purpose === 'interview' ? recruiterEmail : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('sc.err_generic'))
    } finally { setSubmitting(false) }
  }

  /* ── Success Screen ─────────────────────────────────────────────────────── */
  if (success) {
    const p = PURPOSES.find(p => p.value === purpose)!
    const dateLabel = selectedDate ? new Date(`${selectedDate}T${selectedTime}`).toLocaleString(intl, {
      weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : ''

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center text-center py-16 px-4 space-y-5"
      >
        <div className="w-20 h-20 rounded-full bg-green-500/20 border border-green-500/40 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-green-400" />
        </div>
        <h3 className="text-2xl font-bold text-white">{t('sc.submitted')}</h3>
        <p className="text-white/60 text-sm max-w-sm">
          {t('sc.submitted_body', { purpose: `${p.icon} ${pLabel(p.value)}`, date: dateLabel })}
        </p>
        <p className="text-white/30 text-xs">{t('sc.few_hours')}</p>
        <button
          onClick={() => { setSuccess(false); setStep(1); setSelectedDate(''); setSelectedTime('') }}
          className="text-blue-400 hover:text-blue-300 text-sm mt-4 underline"
        >
          {t('sc.another')}
        </button>
      </motion.div>
    )
  }

  const availableSlots = selectedDate ? getAvailableSlots(selectedDate) : []

  return (
    <div className="space-y-8">
      {/* ── Step indicator ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0">
        {([t('sc.step1'), t('sc.step2'), t('sc.step3')]).map((label, i) => (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className={`flex items-center gap-2 ${i + 1 === step ? 'text-blue-400' : i + 1 < step ? 'text-green-400' : 'text-white/30'}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border ${
                i + 1 === step ? 'border-blue-500 bg-blue-600/30 text-blue-300' :
                i + 1 < step  ? 'border-green-500 bg-green-600/20 text-green-400' :
                'border-white/20 bg-white/5 text-white/30'
              }`}>
                {i + 1 < step ? '✓' : i + 1}
              </div>
              <span className="text-xs font-medium hidden sm:block"><Tx>{label}</Tx></span>
            </div>
            {i < 2 && <div className={`flex-1 h-px mx-3 ${i + 1 < step ? 'bg-green-500/40' : 'bg-white/10'}`} />}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <AnimatePresence mode="wait">

          {/* ════════════════════════════════════════════════════════════════
              STEP 1 — Details
              ════════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <motion.div key="step1" initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }} className="space-y-5">

              {/* Purpose grid */}
              <div>
                <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-3">{t('sc.purpose')}</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {PURPOSES.map(p => (
                    <button key={p.value} type="button" onClick={() => setPurpose(p.value)}
                      className={`flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all ${
                        purpose === p.value
                          ? 'border-blue-500/60 bg-blue-600/20 text-white'
                          : 'border-white/10 bg-white/[0.03] text-white/50 hover:border-white/20 hover:text-white/80'
                      }`}
                    >
                      <span className="text-xl leading-none mt-0.5">{p.icon}</span>
                      <div>
                        <p className="text-sm font-semibold leading-tight">{pLabel(p.value)}</p>
                        <p className="text-[11px] leading-tight opacity-60 mt-0.5">{pDesc(p.value)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Name + Email — always shown (user's own contact details) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">{t('sc.your_name')}</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="text" value={name} onChange={e => setName(e.target.value)} required
                      placeholder={t('gate.full_name_ph')}
                      className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 transition-colors" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-1.5">{t('sc.your_email')}</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                      placeholder="you@example.com"
                      className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 transition-colors" />
                  </div>
                </div>
              </div>

              {/* Interview-only recruiter fields */}
              <AnimatePresence>
                {purpose === 'interview' && (
                  <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}
                    className="space-y-4 overflow-hidden">

                    {/* Divider */}
                    <div className="flex items-center gap-2">
                      <div className="h-px flex-1 bg-white/10" />
                      <span className="text-[10px] text-white/30 uppercase tracking-widest font-semibold">{t('sc.recruiter_details')}</span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>

                    {/* Company Name */}
                    <div>
                      <label className="block text-xs font-medium text-white/50 mb-1.5">{t('sc.company')} <span className="text-red-400">*</span></label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                        <input type="text" value={company} onChange={e => setCompany(e.target.value)} required={purpose === 'interview'}
                          placeholder={t('sc.company_ph')}
                          className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 transition-colors" />
                      </div>
                    </div>

                    {/* Recruiter Name + Your Role */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-white/50 mb-1.5">{t('sc.rec_name')} <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                          <input type="text" value={recruiterName} onChange={e => setRecruiterName(e.target.value)} required={purpose === 'interview'}
                            placeholder={t('sc.rec_name_ph')}
                            className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 transition-colors" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-white/50 mb-1.5">{t('sc.your_role')} <span className="text-red-400">*</span></label>
                        <div className="relative">
                          <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                          <input type="text" value={role} onChange={e => setRole(e.target.value)} required={purpose === 'interview'}
                            placeholder={t('sc.role_ph')}
                            className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 transition-colors" />
                        </div>
                      </div>
                    </div>

                    {/* Recruiter Official Email */}
                    <div>
                      <label className="block text-xs font-medium text-white/50 mb-1.5">
                        <Tx>{"Recruiter Official Email"}</Tx> <span className="text-red-400">*</span>
                        {company.trim() && (
                          <span className="ml-1.5 text-white/30 font-normal">
                            <Tx>{"— must be @"}</Tx>{getRecruiterEmailDomain(company)}
                          </span>
                        )}
                      </label>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                        <input
                          type="email"
                          value={recruiterEmail}
                          onChange={e => handleRecruiterEmailChange(e.target.value)}
                          required={purpose === 'interview'}
                          placeholder={company.trim() ? `name@${getRecruiterEmailDomain(company)}` : 'official@company.com'}
                          className={`w-full pl-9 pr-4 py-2.5 bg-white/5 border rounded-xl text-sm text-white placeholder-white/25 focus:outline-none transition-colors ${
                            recruiterEmailError
                              ? recruiterEmailBlocked ? 'border-red-500/60 focus:border-red-500' : 'border-amber-500/60 focus:border-amber-500'
                              : recruiterEmail && !recruiterEmailError ? 'border-green-500/40 focus:border-green-500/60' : 'border-white/10 focus:border-blue-500/60'
                          }`}
                        />
                      </div>
                      {recruiterEmailError ? (
                        <p className={`text-[11px] mt-1.5 flex items-center gap-1 ${recruiterEmailBlocked ? 'text-red-400' : 'text-amber-400'}`}>
                          <span>{recruiterEmailBlocked ? '🚫' : '⚠️'}</span>
                          {recruiterEmailError}
                        </p>
                      ) : recruiterEmail && (
                        <p className="text-[11px] mt-1.5 text-green-400 flex items-center gap-1">{t('sc.official_ok')}</p>
                      )}
                      <p className="text-[10px] text-white/25 mt-1">{t('sc.personal_not')}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Platform + Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-2 flex items-center gap-1.5">
                    <Video className="w-3.5 h-3.5" /> {t('sc.platform')}
                  </label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {PLATFORMS.map(p => (
                      <button key={p.value} type="button" onClick={() => setPlatform(p.value)}
                        className={`flex flex-col items-center gap-1 py-2.5 px-1 rounded-lg border text-[10px] font-medium transition-all ${
                          platform === p.value
                            ? 'border-blue-500/60 bg-blue-600/20 text-white'
                            : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20'
                        }`}>
                        <span className="text-base">{p.icon}</span>
                        <span><Tx>{p.label}</Tx></span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-white/50 mb-2">{t('sc.duration')}</label>
                  <div className="flex gap-2">
                    {DURATIONS.map(d => (
                      <button key={d} type="button" onClick={() => setDuration(d)}
                        className={`flex-1 py-2.5 rounded-lg border text-sm font-semibold transition-all ${
                          duration === d
                            ? 'border-blue-500/60 bg-blue-600/20 text-white'
                            : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20'
                        }`}>
                        {d} <Tx>{"min"}</Tx>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-medium text-white/50 mb-1.5">
                  {purpose === 'interview' ? t('sc.msg_interview') :
                   purpose === 'freelance'  ? t('sc.msg_freelance') : t('sc.msg_other')}
                </label>
                <div className="relative">
                  <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-white/30" />
                  <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3}
                    placeholder={
                      purpose === 'interview'    ? t('sc.ph_interview') :
                      purpose === 'freelance'    ? t('sc.ph_freelance') :
                      purpose === 'consultation' ? t('sc.ph_consultation') :
                      t('sc.ph_other')
                    }
                    className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-white/25 focus:outline-none focus:border-blue-500/60 transition-colors resize-none" />
                </div>
              </div>

              <button type="button" onClick={() => setStep(2)}
                disabled={
                  !name.trim() || !email.trim() ||
                  (purpose === 'interview' && (
                    !recruiterName.trim() || !recruiterEmail.trim() || !company.trim() || !role.trim() ||
                    (recruiterEmailBlocked)
                  ))
                }
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors text-sm">
                {t('sc.next_pick')}
              </button>
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP 2 — Date & Time picker
              ════════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <motion.div key="step2" initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }} className="space-y-5">
              {availLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                </div>
              ) : (
                <>
                  {/* Availability note */}
                  <div className="flex items-start gap-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
                    <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong>{t('sc.avail_days')}</strong>
                      {availability.filter(a => a.is_active).map(a => DAYS[a.day_of_week]).join(', ')}
                      {availability[0]?.timezone && ` · ${availability[0].timezone}`}
                    </div>
                  </div>

                  {/* Calendar */}
                  <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
                    {/* Month nav */}
                    <div className="flex items-center justify-between mb-4">
                      <button type="button" onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-semibold text-white">
                        {calMonth.toLocaleDateString(intl, { month: 'long', year: 'numeric' })}
                      </span>
                      <button type="button" onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors">
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Day headers */}
                    <div className="grid grid-cols-7 mb-2">
                      {DAYS.map(d => (
                        <div key={d} className="text-center text-[10px] font-semibold text-white/30 py-1">{d}</div>
                      ))}
                    </div>

                    {/* Day cells */}
                    <div className="grid grid-cols-7 gap-0.5">
                      {calDays().map((date, i) => {
                        if (!date) return <div key={i} />
                        const dateStr  = date.toISOString().split('T')[0]
                        const avail    = isDayAvailable(date)
                        const selected = dateStr === selectedDate
                        const slots    = getAvailableSlots(dateStr)
                        const full     = avail && slots.length === 0
                        return (
                          <button key={i} type="button"
                            disabled={!avail || full}
                            onClick={() => { setSelectedDate(dateStr); setSelectedTime('') }}
                            className={`relative aspect-square flex items-center justify-center text-xs font-medium rounded-lg transition-all ${
                              selected     ? 'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 ring-offset-slate-900' :
                              full         ? 'bg-orange-500/10 text-orange-400/50 cursor-not-allowed' :
                              avail        ? 'bg-green-500/10 text-green-300 hover:bg-green-500/20 cursor-pointer' :
                              'text-white/20 cursor-not-allowed'
                            }`}
                          >
                            {date.getDate()}
                            {avail && !full && !selected && (
                              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-green-400" />
                            )}
                            {full && (
                              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-orange-400" />
                            )}
                          </button>
                        )
                      })}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-4 mt-3 text-[10px] text-white/40">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> {t('sc.available')}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> {t('sc.booked')}</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> {t('sc.selected')}</span>
                    </div>
                  </div>

                  {/* Time slots */}
                  <AnimatePresence>
                    {selectedDate && (
                      <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }} className="overflow-hidden">
                        <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
                          {t('sc.times_for', { date: new Date(selectedDate + 'T12:00').toLocaleDateString(intl, { weekday:'long', month:'short', day:'numeric' }) })}
                        </p>
                        {availableSlots.length === 0 ? (
                          <p className="text-sm text-orange-400 bg-orange-500/10 border border-orange-500/20 rounded-xl px-4 py-3">
                            {t('sc.all_booked')}
                          </p>
                        ) : (
                          <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                            {availableSlots.map(slot => (
                              <button key={slot} type="button" onClick={() => setSelectedTime(slot)}
                                className={`py-2 px-1 rounded-lg border text-xs font-semibold transition-all ${
                                  selectedTime === slot
                                    ? 'border-blue-500 bg-blue-600/30 text-blue-300'
                                    : 'border-white/10 bg-white/5 text-white/60 hover:border-blue-500/40 hover:text-white'
                                }`}>
                                {slot}
                              </button>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Timezone */}
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-1.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> {t('sc.timezone')}
                    </label>
                    <select value={timezone} onChange={e => setTimezone(e.target.value)}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500/60 transition-colors appearance-none">
                      {TIMEZONES.map(tz => <option key={tz} value={tz} className="bg-slate-900">{tz}</option>)}
                    </select>
                  </div>
                </>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-2.5 border border-white/10 text-white/60 hover:text-white hover:border-white/20 font-medium rounded-xl transition-colors text-sm">
                  {t('sc.back')}
                </button>
                <button type="button" onClick={() => setStep(3)}
                  disabled={!selectedDate || !selectedTime}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-semibold rounded-xl transition-colors text-sm">
                  {t('sc.review')}
                </button>
              </div>
            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP 3 — Review & Submit
              ════════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <motion.div key="step3" initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }} className="space-y-5">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5 space-y-3">
                <p className="text-xs font-semibold text-blue-400 uppercase tracking-widest">{t('sc.review_title')}</p>
                {[
                  { label: t('sc.r_purpose'), value: PURPOSES.find(p => p.value === purpose)?.icon + ' ' + pLabel(purpose) },
                  { label: t('sc.r_name'), value: name },
                  { label: t('sc.r_email'), value: email },
                  purpose === 'interview' && { label: t('sc.r_company'), value: company },
                  purpose === 'interview' && { label: t('sc.r_recruiter'), value: recruiterName + (role ? ` (${role})` : '') },
                  purpose === 'interview' && { label: t('sc.r_rec_email'), value: recruiterEmail },
                  { label: t('sc.r_date'), value: new Date(`${selectedDate}T${selectedTime}`).toLocaleString(intl, { weekday:'long', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' }) },
                  { label: t('sc.r_timezone'), value: timezone },
                  { label: t('sc.r_duration'), value: t('sc.minutes', { n: duration }) },
                  { label: t('sc.r_platform'),  value: PLATFORMS.find(p => p.value === platform)?.icon + ' ' + PLATFORMS.find(p => p.value === platform)?.label },
                  message && { label: t('sc.r_message'), value: message.slice(0, 120) + (message.length > 120 ? '…' : '') },
                ].filter(Boolean).map((row: any) => (
                  <div key={row.label} className="flex gap-3 text-sm">
                    <span className="text-white/40 w-20 flex-shrink-0 text-xs font-medium pt-0.5"><Tx>{row.label}</Tx></span>
                    <span className="text-white/80">{row.value}</span>
                  </div>
                ))}
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
                    className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
                    <X className="w-4 h-4 flex-shrink-0" /> <Tx>{error}</Tx>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)}
                  className="flex-1 py-2.5 border border-white/10 text-white/60 hover:text-white hover:border-white/20 font-medium rounded-xl transition-colors text-sm">
                  {t('sc.back')}
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-xl transition-colors text-sm">
                  {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('sc.submitting')}</> : t('sc.submit')}
                </button>
              </div>

              <p className="text-center text-[11px] text-white/25">
                {t('sc.confirm_note')}
              </p>
            </motion.div>
          )}

        </AnimatePresence>
      </form>
    </div>
  )
}
