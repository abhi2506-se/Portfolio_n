'use client'

import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Tx, useTx } from '@/components/tx'

interface Update { id: string; title: string; body: string; created_at: number }

/** Admin: add and remove "What's new" entries. The public list is read live from the database. */
export default function WhatsNewAdminPage() {
  const __tx = useTx();
  const [items, setItems] = useState<Update[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () =>
    fetch(`/api/whats-new?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setMessage(__tx("Could not load entries.")))

  useEffect(() => { load() }, [])

  const add = async () => {
    if (!title.trim()) return setMessage(__tx("Please add a title."))
    setBusy(true)
    setMessage(null)
    const res = await fetch('/api/whats-new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body }),
    })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMessage(d.error || __tx("Could not save. Are you logged in as admin?"))
    setTitle('')
    setBody('')
    setMessage(__tx("Added. It is live now."))
    load()
  }

  const remove = async (id: string) => {
    if (!confirm(__tx("Delete this entry?"))) return
    const res = await fetch(`/api/whats-new?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) return setMessage(__tx("Could not delete."))
    load()
  }

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-xl font-semibold"><Tx>{"What's new (admin)"}</Tx></h1>

      <section className="space-y-2 rounded-xl border border-white/10 p-4">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder={__tx("Title, e.g. Live chat now supports video")} maxLength={120} className="w-full rounded-lg border px-3 py-2 text-sm bg-transparent" />
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder={__tx("Details (optional)")} rows={4} maxLength={2000} className="w-full rounded-lg border px-3 py-2 text-sm bg-transparent" />
        <button onClick={add} disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? <Tx>{"Saving…"}</Tx> : <Tx>{"Add entry"}</Tx>}
        </button>
        {message && <p className="text-xs opacity-80"><Tx>{message}</Tx></p>}
      </section>

      <section className="space-y-2">
        {items.length === 0 && <p className="text-sm opacity-60"><Tx>{"No entries yet."}</Tx></p>}
        {items.map(item => (
          <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-white/10 p-3">
            <div className="min-w-0">
              <p className="text-xs opacity-60">{new Date(item.created_at).toLocaleString()}</p>
              <p className="font-medium text-sm"><Tx>{item.title}</Tx></p>
              {item.body && <p className="text-sm opacity-80 whitespace-pre-wrap">{item.body}</p>}
            </div>
            <button onClick={() => remove(item.id)} className="shrink-0 opacity-60 hover:opacity-100" aria-label={__tx("Delete")}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </section>
    </div>
  )
}
