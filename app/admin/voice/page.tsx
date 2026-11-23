'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Mic, MicOff, Send } from 'lucide-react'
import { useVoiceRecognition } from '@/hooks/use-voice-recognition'

interface CommandInfo {
  id: string
  label: string
  category: string
  sensitivity: 'read' | 'navigate' | 'sensitive'
  requiresConfirmation: boolean
  args: string[]
}

interface Pending { command: CommandInfo; args: Record<string, string>; token: string; prompt: string }

/**
 * Voice Command Center (admin). Voice fills the text box; nothing runs from a transcript on its own.
 * You pick a command, check the arguments, and press Run. Sensitive commands need the typed phrase.
 */
export default function VoiceCommandCenterPage() {
  const router = useRouter()
  const [commands, setCommands] = useState<CommandInfo[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [pending, setPending] = useState<Pending | null>(null)
  const [typedPhrase, setTypedPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [history, setHistory] = useState<{ at: string; command: string; text: string; ok: boolean }[]>([])

  useEffect(() => {
    fetch('/api/admin/voice/commands', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => setCommands(d.commands || []))
      .catch(() => setLoadError('Could not load commands. Are you signed in as admin?'))
  }, [])

  const cmd = useMemo(() => commands.find(c => c.id === selected) || null, [commands, selected])

  const voice = useVoiceRecognition({
    onInterim: t => setArgValues(v => ({ ...v, __voice: t })),
    onFinal: t => setArgValues(v => ({ ...v, __voice: t })),
    onError: m => setResult({ ok: false, text: m }),
  })

  const speak = (text: string) => {
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))
      }
    } catch {}
  }

  const record = (command: string, text: string, ok: boolean) => {
    setResult({ ok, text })
    setHistory(h => [{ at: new Date().toLocaleTimeString(), command, text, ok }, ...h].slice(0, 20))
    speak(text)
  }

  // Use the voice transcript as the value of the first argument, if the command takes one.
  const useVoiceForArg = () => {
    if (!cmd || cmd.args.length === 0) return
    setArgValues(v => ({ ...v, [cmd.args[0]]: (v.__voice || '').trim() }))
  }

  const run = async () => {
    if (!cmd || busy) return
    setBusy(true)
    setResult(null)
    const args = Object.fromEntries(cmd.args.map(k => [k, (argValues[k] || '').trim()]))
    try {
      const res = await fetch('/api/admin/voice/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd.id, args }),
      })
      const d = await res.json().catch(() => ({}))
      if (d.status === 'confirmation_required') {
        setPending({ command: cmd, args, token: d.confirmToken, prompt: d.prompt })
        setTypedPhrase('')
        record(cmd.label, d.speech, true)
      } else if (d.status === 'ok') {
        record(cmd.label, d.speech, true)
        if (d.navigate) router.push(d.navigate)
      } else {
        record(cmd.label, d.speech || 'The command failed.', false)
      }
    } catch {
      record(cmd.label, 'Network error. Nothing was changed.', false)
    }
    setBusy(false)
  }

  const confirm = async () => {
    if (!pending || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/voice/command', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: pending.command.id, args: pending.args, confirm: { token: pending.token, phrase: typedPhrase } }),
      })
      const d = await res.json().catch(() => ({}))
      record(pending.command.label, d.speech || 'The command failed.', d.status === 'ok')
    } catch {
      record(pending.command.label, 'Network error. Nothing was changed.', false)
    }
    setPending(null)
    setTypedPhrase('')
    setBusy(false)
  }

  const groups = useMemo(() => {
    const g: Record<string, CommandInfo[]> = {}
    for (const c of commands) (g[c.category] ||= []).push(c)
    return g
  }, [commands])

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Voice Command Center</h1>
          <p className="text-xs opacity-70">Voice fills the box. Nothing runs until you press Run. Sensitive actions need the typed phrase.</p>
        </div>
        <button
          onClick={() => (voice.listening ? voice.stop() : voice.start())}
          disabled={!voice.supported}
          className={`rounded-full p-3 ${voice.listening ? 'bg-red-500 text-white animate-pulse' : 'bg-secondary'} disabled:opacity-40`}
          aria-label={voice.listening ? 'Stop listening' : 'Start listening'}
          title={voice.supported ? '' : 'Voice input is not supported in this browser'}
        >
          {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      </header>

      {loadError && <p className="text-sm text-red-500">{loadError}</p>}

      <section className="space-y-3 rounded-xl border p-4">
        <label className="block text-sm font-medium">Command</label>
        <select value={selected} onChange={e => { setSelected(e.target.value); setArgValues({}); setPending(null); setResult(null) }}
          className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm">
          <option value="">Choose a command…</option>
          {Object.entries(groups).map(([cat, list]) => (
            <optgroup key={cat} label={cat.replace('_', ' ')}>
              {list.map(c => <option key={c.id} value={c.id}>{c.label}{c.requiresConfirmation ? ' (confirm)' : ''}</option>)}
            </optgroup>
          ))}
        </select>

        {cmd && cmd.args.map(k => (
          <div key={k} className="flex gap-2">
            <input value={argValues[k] || ''} onChange={e => setArgValues(v => ({ ...v, [k]: e.target.value }))}
              placeholder={k === 'username' ? 'Team member username' : 'Visitor name'}
              className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm" />
            <button onClick={useVoiceForArg} disabled={!argValues.__voice} className="rounded-lg border px-3 text-xs disabled:opacity-40">
              Use voice
            </button>
          </div>
        ))}
        {cmd && argValues.__voice && (
          <p className="text-xs opacity-70">Heard: “{argValues.__voice}”</p>
        )}

        <button onClick={run} disabled={!cmd || busy || !!pending}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40">
          <Send className="h-4 w-4" /> {busy ? 'Working…' : 'Run'}
        </button>
      </section>

      {pending && (
        <section className="space-y-3 rounded-xl border border-amber-500/40 p-4">
          <p className="text-sm">This is a sensitive action: <strong>{pending.command.label}</strong>.</p>
          <p className="text-sm">Type exactly: <code className="font-mono">{pending.prompt}</code></p>
          <div className="flex gap-2">
            <input value={typedPhrase} onChange={e => setTypedPhrase(e.target.value)} autoComplete="off"
              className="flex-1 rounded-lg border bg-transparent px-3 py-2 text-sm font-mono" />
            <button onClick={confirm} disabled={busy || !typedPhrase.trim()} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-40">Confirm</button>
            <button onClick={() => { setPending(null); setTypedPhrase('') }} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
          </div>
          <p className="text-xs opacity-60">The confirmation expires in 2 minutes.</p>
        </section>
      )}

      {result && (
        <p role="status" className={`text-sm ${result.ok ? 'text-emerald-500' : 'text-red-500'}`}>{result.text}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Recent (this session only)</h2>
        {history.length === 0 && <p className="text-xs opacity-60">Nothing yet.</p>}
        {history.map((h, i) => (
          <div key={i} className="flex justify-between gap-3 rounded-lg border p-2 text-xs">
            <span>{h.at} · {h.command}</span>
            <span className={h.ok ? 'text-emerald-500' : 'text-red-500'}>{h.text}</span>
          </div>
        ))}
      </section>
    </div>
  )
}
