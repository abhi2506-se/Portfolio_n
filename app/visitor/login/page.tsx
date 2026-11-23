'use client'
import { useLanguage } from '@/lib/language-context'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { AuthShell, Field, Notice, fieldCls, primaryBtn, postJson } from '@/components/visitor/shell'

export default function VisitorLoginPage() {
  const router = useRouter()
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { fetch('/api/visitor/me', { credentials: 'same-origin' }).then(r => { if (r.ok) router.replace('/visitor/dashboard') }).catch(() => {}) }, [router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const r = await postJson('/api/visitor/login', { email, password })
    if (r.ok) { router.replace('/visitor/dashboard'); return }
    setBusy(false); setErr(r.data.error || t('va.sign_in_failed'))
  }

  return (
    <AuthShell title={t('va.login_title')} subtitle={t('va.login_sub')}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('va.email')}><input type="email" className={fieldCls} value={email} onChange={e => setEmail(e.target.value)} required autoComplete="username" /></Field>
        <Field label={t('va.password')}><input type="password" className={fieldCls} value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
        {err && <Notice kind="error">{err}</Notice>}
        <button className={primaryBtn} disabled={busy}>{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('va.signing_in')}</> : t('va.sign_in')}</button>
        <p className="text-center text-xs text-muted-foreground">{t('va.no_account')} <Link href="/visitor/request-access" className="text-blue-500 hover:underline">{t('va.request_access')}</Link></p>
        <p className="text-center text-[11px] text-muted-foreground">{t('va.forgot')}</p>
      </form>
    </AuthShell>
  )
}
