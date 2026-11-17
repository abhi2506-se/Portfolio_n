import { describe, it, expect, vi } from 'vitest'
import { sendWithRetry } from '@/lib/live-chat-send'

const payload = { action: 'message', chatId: 'chat_1', clientId: 'c_abc', content: 'hello' }
const saved = { id: 'msg_1', client_id: 'c_abc', content: 'hello', status: 'sent' }
const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const opts = (fetchImpl: any, extra = {}) => ({ fetchImpl, sleep: async () => {}, isOnline: () => true, ...extra })

describe('sendWithRetry – idempotent message submission', () => {
  it('succeeds on the first attempt and returns the saved row', async () => {
    const f = vi.fn(() => json(200, { ok: true, message: saved }))
    const r = await sendWithRetry(payload, opts(f))
    expect(r).toMatchObject({ ok: true, message: saved, attempts: 1 })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('re-sends the IDENTICAL body (same clientId) on every retry', async () => {
    const bodies: string[] = []
    const f = vi.fn((_u: string, init: RequestInit) => {
      bodies.push(String(init.body))
      return bodies.length < 3 ? json(503, { error: 'Internal error' }) : json(200, { ok: true, message: saved })
    })
    const r = await sendWithRetry(payload, opts(f))
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(3)
    expect(new Set(bodies).size).toBe(1)
    expect(JSON.parse(bodies[0]).clientId).toBe('c_abc')
  })

  it('a timed-out attempt (response lost, message already saved) is recovered by the retry — not reported as failed', async () => {
    let n = 0
    const f = vi.fn((_u: string, init: RequestInit) => {
      n++
      if (n === 1) return new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      return json(200, { ok: true, message: saved }) // server: duplicate -> returns the stored row
    })
    const r = await sendWithRetry(payload, opts(f, { timeoutMs: 20 }))
    expect(r).toMatchObject({ ok: true, message: saved, attempts: 2 })
  })

  it('does NOT retry definitive refusals (403 / 409 / 400) and flags a block', async () => {
    for (const status of [400, 401, 403, 404, 409]) {
      const f = vi.fn(() => json(status, { error: 'nope' }))
      const r = await sendWithRetry(payload, opts(f))
      expect(r).toMatchObject({ ok: false, retryable: false, status, attempts: 1 })
      expect(f).toHaveBeenCalledTimes(1)
    }
    const blocked = await sendWithRetry(payload, opts(() => json(403, { blocked: true })))
    expect(blocked.blocked).toBe(true)
    const expired = await sendWithRetry(payload, opts(() => json(401, { code: 'session_expired' })))
    expect(expired).toMatchObject({ ok: false, retryable: false, sessionExpired: true, reason: 'session-expired', attempts: 1 })
  })

  it('retries 429 and 5xx, and reports a retryable failure when every attempt fails', async () => {
    const f = vi.fn(() => json(500, { error: 'Internal error' }))
    const r = await sendWithRetry(payload, opts(f))
    expect(r).toMatchObject({ ok: false, retryable: true, status: 500, attempts: 3 })
    const g = vi.fn(() => json(429, {}))
    expect((await sendWithRetry(payload, opts(g))).attempts).toBe(3)
  })

  it('network errors are retried, then reported as retryable', async () => {
    const f = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    const r = await sendWithRetry(payload, opts(f))
    expect(r).toMatchObject({ ok: false, retryable: true, reason: 'network', attempts: 3 })
  })

  it('offline: does not burn attempts; caller resumes on the "online" event', async () => {
    const f = vi.fn()
    const r = await sendWithRetry(payload, opts(f, { isOnline: () => false }))
    expect(r).toMatchObject({ ok: false, retryable: true, reason: 'offline', attempts: 0 })
    expect(f).not.toHaveBeenCalled()
  })

  it('a 2xx without a message body is retried (safe, idempotent) rather than trusted', async () => {
    let n = 0
    const f = vi.fn(() => (++n === 1 ? json(200, { ok: true }) : json(200, { ok: true, message: saved })))
    const r = await sendWithRetry(payload, opts(f))
    expect(r).toMatchObject({ ok: true, message: saved, attempts: 2 })
  })

  it('passes through fetch init (e.g. credentials for the admin panel)', async () => {
    const f = vi.fn((_u: string, init: RequestInit) => { expect(init.credentials).toBe('include'); return json(200, { ok: true, message: saved }) })
    await sendWithRetry(payload, opts(f, { init: { credentials: 'include' } }))
    expect(f).toHaveBeenCalledTimes(1)
  })
})
