'use client'
import { useLanguage } from '@/lib/language-context'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { AuthShell, Field, Notice, fieldCls, primaryBtn, postJson } from '@/components/visitor/shell'

function Inner() {
  const { t } = useLanguage()
  const token = useSearchParams().get('token') || ''
  const [state, setState] = useState<'checking' | 'valid' | 'invalid' | 'done'>('checking')
  const [type, setType] = useState('activation')
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('')

  useEffect(() => {
    if (!token) { setState('invalid'); return }
    fetch(`/api/visitor/activate?token=${encodeURIComponent(token)}`).then(r => r.json()).then(d => {
      if (d.valid) { setType(d.type); setState('valid') } else setState('invalid')
    }).catch(() => setState('invalid'))
  }, [token])

  const isReset = type === 'password_reset'
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    if (pw !== pw2) { setErr(t('act.mismatch')); return }
    setBusy(true)
    const r = await postJson('/api/visitor/activate', { token, password: pw })
    setBusy(false)
    if (r.ok) setState('done'); else setErr(r.data.error || t('act.save_failed'))
  }

  return (
    <AuthShell title={isReset ? t('act.reset_title') : t('act.title')} subtitle={isReset ? t('act.reset_sub') : t('act.sub')}>
      {state === 'checking' && <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>}
      {state === 'invalid' && <div className="space-y-3"><Notice kind="error">{t('act.invalid')}</Notice><p className="text-sm text-muted-foreground">{t('act.ask_new')}</p></div>}
      {state === 'done' && (
        <div className="text-center space-y-4"><CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
          <p className="text-sm">{t('act.done')}</p>
          <Link href="/visitor/login" className={primaryBtn}>{t('act.go_login')}</Link></div>
      )}
      {state === 'valid' && (
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('act.new_pw')} hint={t('act.pw_hint')}><input type="password" className={fieldCls} value={pw} onChange={e => setPw(e.target.value)} required minLength={10} maxLength={128} autoComplete="new-password" /></Field>
          <Field label={t('act.confirm')}><input type="password" className={fieldCls} value={pw2} onChange={e => setPw2(e.target.value)} required autoComplete="new-password" /></Field>
          {err && <Notice kind="error">{err}</Notice>}
          <button className={primaryBtn} disabled={busy}>{busy ? <><Loader2 className="w-4 h-4 animate-spin" /> {t('vd.saving')}</> : isReset ? t('act.reset_btn') : t('act.activate_btn')}</button>
        </form>
      )}
    </AuthShell>
  )
}
export default function ActivatePage() { return <Suspense fallback={null}><Inner /></Suspense> }
