'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Sparkles, Save, Send, Eye, Rocket, Undo2, History } from 'lucide-react'

type Status = 'missing' | 'draft' | 'in_review' | 'published' | 'outdated'
interface Cov { published: number; draft: number; inReview: number; outdated: number; missing: number; total: number }
interface Lang { code: string; native: string; english: string; enabled: boolean; coverage: Cov }
interface Entry { type: string; id: string; label: string; status: Status; updatedAt: number | null; updatedBy: string | null; fieldCount: number; translatedCount: number }
interface Detail {
  item: { type: string; id: string; label: string; fields: Record<string, string> }
  translation: { fields: Record<string, string>; status: string; reviewerNote: string | null } | null
  effectiveStatus: Status
  versions: { id: string; action: string; status: string; savedBy: string | null; savedAt: number }[]
}

const BADGE: Record<Status, string> = {
  missing: 'bg-red-500/10 text-red-500', draft: 'bg-amber-500/10 text-amber-600', in_review: 'bg-blue-500/10 text-blue-500',
  published: 'bg-emerald-500/10 text-emerald-600', outdated: 'bg-orange-500/10 text-orange-600',
}
const LABEL: Record<Status, string> = { missing: 'Missing', draft: 'Draft', in_review: 'In review', published: 'Published', outdated: 'Outdated' }
const Badge = ({ s }: { s: Status }) => <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE[s]}`}>{LABEL[s]}</span>

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(d.error || 'Request failed'), { status: r.status })
  return d
}

export default function TranslationsAdminPage() {
  const [langs, setLangs] = useState<Lang[]>([])
  const [provider, setProvider] = useState('none')
  const [locale, setLocale] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [open, setOpen] = useState<{ type: string; id: string } | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [unauth, setUnauth] = useState(false)

  const fail = (e: any) => { if (e?.status === 401) setUnauth(true); setMsg({ ok: false, text: e?.message || 'Something went wrong' }) }

  const loadLangs = useCallback(() => api('/api/admin/translations').then(d => { setLangs(d.languages); setProvider(d.provider) }).catch(fail), [])
  const loadEntries = useCallback((l: string) => api(`/api/admin/translations?locale=${l}`).then(d => setEntries(d.entries)).catch(fail), [])
  const loadDetail = useCallback((l: string, type: string, id: string) =>
    api(`/api/admin/translations?locale=${l}&type=${type}&id=${encodeURIComponent(id)}`).then((d: Detail) => { setDetail(d); setDraft({ ...(d.translation?.fields || {}) }); setPreview(false) }).catch(fail), [])

  useEffect(() => { loadLangs() }, [loadLangs])
  useEffect(() => { if (locale) { setOpen(null); setDetail(null); loadEntries(locale) } }, [locale, loadEntries])
  useEffect(() => { if (locale && open) loadDetail(locale, open.type, open.id) }, [locale, open, loadDetail])

  const run = async (name: string, fn: () => Promise<any>, ok: string) => {
    setBusy(name); setMsg(null)
    try { await fn(); setMsg({ ok: true, text: ok }); if (locale) { await loadEntries(locale); if (open) await loadDetail(locale, open.type, open.id) } loadLangs() }
    catch (e) { fail(e) } finally { setBusy(null) }
  }
  const post = (body: object) => api('/api/admin/translations', { method: 'POST', body: JSON.stringify({ locale, ...open, ...body }) })

  const shown = useMemo(() => entries.filter(e => filter === 'all' || e.status === filter), [entries, filter])
  const cur = langs.find(l => l.code === locale)

  if (unauth) return (
    <main className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-bold">Admin sign-in required</h1>
      <p className="mt-2 text-sm text-muted-foreground">Sign in as the main admin to manage translations.</p>
      <Link href="/admin" className="mt-4 inline-block text-blue-500 underline">Go to admin login</Link>
    </main>
  )

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/admin/dashboard" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Admin dashboard</Link>
      <h1 className="text-2xl font-bold">Translation management</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        English stays the source of truth and is never changed here. Only <b>published</b> translations appear on the website; everything else falls back to English.
        AI suggestions ({provider === 'none' ? 'not configured — manual translation works fully' : `provider: ${provider}`}) are never saved or published automatically.
      </p>
      {msg && <p role="status" className={`mt-3 rounded-md px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-500'}`}>{msg.text}</p>}

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {langs.map(l => (
          <div key={l.code} className={`rounded-xl border p-4 ${locale === l.code ? 'border-blue-500' : 'border-border'} bg-card`}>
            <div className="flex items-center justify-between">
              <button className="text-left" onClick={() => setLocale(l.code)}>
                <p className="font-semibold">{l.native} <span className="text-xs text-muted-foreground">({l.english})</span></p>
              </button>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" checked={l.enabled} onChange={e => run('lang-' + l.code, () => api('/api/admin/translations/locales', { method: 'PUT', body: JSON.stringify({ locale: l.code, enabled: e.target.checked }) }), `${l.english} ${e.target.checked ? 'enabled' : 'disabled'}.`)} />
                Enabled
              </label>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-secondary"><div className="h-full bg-emerald-500" style={{ width: `${l.coverage.total ? (l.coverage.published / l.coverage.total) * 100 : 0}%` }} /></div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {l.coverage.published}/{l.coverage.total} published · {l.coverage.draft + l.coverage.inReview} in progress · {l.coverage.outdated} outdated · {l.coverage.missing} missing
            </p>
          </div>
        ))}
      </section>

      {locale && (
        <section className="mt-8 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(['all', 'missing', 'draft', 'in_review', 'published', 'outdated'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-2.5 py-1 text-xs ${filter === f ? 'border-blue-500 bg-blue-500/10 text-blue-500' : 'border-border text-muted-foreground'}`}>{f === 'all' ? 'All' : LABEL[f]}</button>
              ))}
            </div>
            <ul className="max-h-[70vh] divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
              {shown.map(e => (
                <li key={e.type + e.id}>
                  <button onClick={() => setOpen({ type: e.type, id: e.id })} className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm hover:bg-secondary/60 ${open?.id === e.id && open?.type === e.type ? 'bg-secondary/60' : ''}`}>
                    <span className="truncate">{e.label}</span><Badge s={e.status} />
                  </button>
                </li>
              ))}
              {!shown.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing here.</li>}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            {!detail ? <p className="py-16 text-center text-sm text-muted-foreground">{open ? 'Loading…' : 'Select an item to translate.'}</p> : (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div><h2 className="font-semibold">{detail.item.label}</h2><p className="text-xs text-muted-foreground">Into {cur?.english}</p></div>
                  <Badge s={detail.effectiveStatus} />
                </div>
                {detail.effectiveStatus === 'outdated' && <p className="mb-3 rounded-md bg-orange-500/10 px-3 py-2 text-xs text-orange-600">The English text changed after this was translated. It is hidden on the website until you update and publish it again.</p>}
                {detail.item.type === 'legal' && <p className="mb-3 rounded-md bg-blue-500/10 px-3 py-2 text-xs text-blue-600">Legal documents must be translated and reviewed by a person — AI suggestions are disabled here. The English original stays authoritative.</p>}
                <div className="space-y-4">
                  {Object.entries(detail.item.fields).map(([k, en]) => (
                    <div key={k}>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{k}</p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <p className="whitespace-pre-wrap rounded-md bg-secondary/50 p-2 text-sm">{en}</p>
                        {preview
                          ? <p className="whitespace-pre-wrap rounded-md border border-border p-2 text-sm">{draft[k] || <em className="text-muted-foreground">— falls back to English —</em>}</p>
                          : <textarea value={draft[k] || ''} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} rows={Math.min(12, Math.max(2, Math.ceil(en.length / 60)))} className="w-full rounded-md border border-border bg-background p-2 text-sm" />}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {detail.item.type !== 'legal' && provider !== 'none' && (
                    <button disabled={!!busy} onClick={() => run('ai', async () => { const d = await post({ action: 'suggest' }); setDraft(cur => ({ ...cur, ...d.suggestion })) }, 'AI suggestion filled in — review and edit before saving.')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary">{busy === 'ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI suggest</button>
                  )}
                  <button disabled={!!busy} onClick={() => setPreview(p => !p)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Eye className="h-4 w-4" /> {preview ? 'Edit' : 'Preview'}</button>
                  <button disabled={!!busy} onClick={() => run('save', () => post({ action: 'save', fields: draft, status: 'draft' }), 'Draft saved.')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Save className="h-4 w-4" /> Save draft</button>
                  <button disabled={!!busy} onClick={() => run('review', () => post({ action: 'save', fields: draft, status: 'in_review' }), 'Marked as in review.')} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary"><Send className="h-4 w-4" /> Send to review</button>
                  <button disabled={!!busy || !detail.translation} onClick={() => run('publish', async () => { await post({ action: 'save', fields: draft, status: 'in_review' }); await post({ action: 'publish' }) }, 'Published — live within about a minute.')} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"><Rocket className="h-4 w-4" /> Save & publish</button>
                  {detail.effectiveStatus === 'published' && <button disabled={!!busy} onClick={() => run('unpub', () => post({ action: 'unpublish' }), 'Unpublished — the website shows English again.')} className="rounded-md px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10">Unpublish</button>}
                </div>
                {detail.versions.length > 0 && (
                  <details className="mt-5">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium"><History className="h-4 w-4" /> Version history ({detail.versions.length})</summary>
                    <ul className="mt-2 divide-y divide-border text-sm">
                      {detail.versions.map(v => (
                        <li key={v.id} className="flex items-center justify-between py-1.5">
                          <span className="text-muted-foreground">{new Date(v.savedAt).toLocaleString()} · {v.action.replace('_', ' ')}{v.savedBy ? ` · ${v.savedBy}` : ''}</span>
                          <button onClick={() => run('rev', () => post({ action: 'revert', versionId: v.id }), 'Restored as a new draft.')} className="inline-flex items-center gap-1 text-blue-500 hover:underline"><Undo2 className="h-3.5 w-3.5" /> Restore</button>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
