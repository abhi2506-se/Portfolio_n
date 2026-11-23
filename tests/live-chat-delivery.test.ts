/**
 * End-to-end check of the "Send again on a message that WAS saved" bug, against
 * the REAL /api/live-chat route and real Postgres semantics (PGlite).
 *
 * Only the third-party edges are faked: Supabase Realtime (made to hang / throw),
 * web-push, the AI model, and mail.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const h = vi.hoisted(() => ({
  afterJobs: [] as Promise<unknown>[],
  broadcast: null as any,
  push: null as any,
  pg: null as any,
}))
h.broadcast = vi.fn()
h.push = vi.fn(async () => {})

vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: async () => ({}) }) } }))
vi.mock('@/lib/supabase-realtime', () => ({ broadcastToChat: (c: string, e: string, p: any) => h.broadcast(c, e, p), chatChannelName: (id: string) => `chat:${id}` }))
vi.mock('@/lib/notifications', () => ({ sendPushToAdmin: (...a: any[]) => h.push(...a) }))
vi.mock('@/lib/live-chat-ai', () => ({ generateAiReply: async () => null }))
vi.mock('@/lib/link-preview', () => ({ extractFirstUrl: () => null, fetchLinkPreview: async () => null }))
// next/server's after() only works inside a real request scope — run the job and let the test await it.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => any) => { h.afterJobs.push(Promise.resolve().then(fn).catch(() => {})) } }))
vi.mock('@neondatabase/serverless', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  h.pg = new PGlite()
  const run = async (text: string, values: any[]) => (await h.pg.query(text, values)).rows as any[]
  const sql: any = async (strings: any, ...values: any[]) => {
    if (typeof strings === 'string') return run(strings, values[0] || [])   // sql('ALTER …', [])
    let text = strings[0]; for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1]
    return run(text, values)
  }
  return { neon: () => sql }
})

process.env.SESSION_SECRET = 'test-secret'
process.env.DATABASE_URL = 'postgres://test:test@localhost/test'   // the Neon client itself is mocked with PGlite
import { POST } from '@/app/api/live-chat/route'
import { NextRequest } from 'next/server'
import { ensureLiveChatSchema } from '@/lib/live-chat-db'

const DEVICE = 'dev0123456789abcdef0123456789abcd'
const cookie = `portfolio_visitor_id=${DEVICE}.${createHmac('sha256', 'test-secret').update(DEVICE).digest('hex').slice(0, 24)}`
const CHAT = 'chat_test_1'

const post = (body: any) => POST(new NextRequest('http://localhost/api/live-chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }))
const count = async (clientId: string) => Number((await h.pg.query('SELECT COUNT(*)::int AS n FROM live_chat_messages WHERE client_id = $1', [clientId])).rows[0].n)
const flush = () => Promise.all(h.afterJobs.splice(0))

beforeAll(async () => {
  await ensureLiveChatSchema()
  const now = Date.now()
  await h.pg.query(`INSERT INTO live_chats (id, session_id, user_name, user_email, status, created_at, updated_at, device_id, approved)
                  VALUES ($1,'s','Asha','a@x.com','active',$2,$2,$3,TRUE)`, [CHAT, now, DEVICE])
})
beforeEach(() => { h.broadcast.mockReset(); h.broadcast.mockResolvedValue(undefined); h.push.mockClear() })

describe('live chat – visitor message delivery', () => {
  it('replies with the saved message even if the realtime broadcast HANGS (previously the request stalled/failed)', async () => {
    h.broadcast.mockImplementation(() => new Promise(() => {}))          // never resolves
    const t0 = Date.now()
    const res = await post({ action: 'message', chatId: CHAT, clientId: 'c_hang', content: 'hello' })
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.message).toMatchObject({ client_id: 'c_hang', content: 'hello', status: 'sent' })
    expect(Date.now() - t0).toBeLessThan(3000)                          // did not wait for the hung broadcast
    expect(await count('c_hang')).toBe(1)
    h.afterJobs.splice(0)                                               // drop the deliberately-hung background job
  })

  it('replies 200 even if the realtime broadcast THROWS', async () => {
    h.broadcast.mockRejectedValue(new Error('supabase down'))
    const res = await post({ action: 'message', chatId: CHAT, clientId: 'c_throw', content: 'hi again' })
    expect(res.status).toBe(200)
    expect((await res.json()).message.client_id).toBe('c_throw')
    await flush()                                                       // after() job must not blow up either
  })

  it('broadcasts and notifies AFTER responding, exactly once', async () => {
    const res = await post({ action: 'message', chatId: CHAT, clientId: 'c_once', content: 'ping' })
    expect(res.status).toBe(200)
    await flush()
    const events = h.broadcast.mock.calls.filter((c: any[]) => c[1] === 'new_message')
    expect(events).toHaveLength(1)
    expect(events[0][2].message.client_id).toBe('c_once')
    expect(h.push).toHaveBeenCalledTimes(1)
  })

  it('retrying the SAME clientId (response was lost) stores ONE row and returns the stored message', async () => {
    const first = await (await post({ action: 'message', chatId: CHAT, clientId: 'c_retry', content: 'only once' })).json()
    await flush()
    const retry = await post({ action: 'message', chatId: CHAT, clientId: 'c_retry', content: 'only once' })
    const second = await retry.json()
    expect(retry.status).toBe(200)
    expect(second.message.id).toBe(first.message.id)                    // same row, not a new one
    expect(await count('c_retry')).toBe(1)
    h.broadcast.mockClear(); await flush()
  })

  it('a retry re-broadcasts (so the admin still gets it) but does not push or AI-reply twice', async () => {
    await post({ action: 'message', chatId: CHAT, clientId: 'c_rb', content: 'x' }); await flush()
    h.broadcast.mockClear(); h.push.mockClear()
    await post({ action: 'message', chatId: CHAT, clientId: 'c_rb', content: 'x' }); await flush()
    expect(h.broadcast.mock.calls.filter((c: any[]) => c[1] === 'new_message')).toHaveLength(1)
    expect(h.push).not.toHaveBeenCalled()
    expect(await count('c_rb')).toBe(1)
  })

  it('five rapid double-submits of one clientId create one message', async () => {
    const rs = await Promise.all(Array.from({ length: 5 }, () => post({ action: 'message', chatId: CHAT, clientId: 'c_burst', content: 'spam click' })))
    expect(rs.every(r => r.status === 200)).toBe(true)
    expect(await count('c_burst')).toBe(1)
    await flush()
  })

  it('a different device cannot post into this chat (identity is the signed cookie)', async () => {
    const other = `ffff0123456789abcdef0123456789ab`
    const c2 = `portfolio_visitor_id=${other}.${createHmac('sha256', 'test-secret').update(other).digest('hex').slice(0, 24)}`
    const res = await POST(new NextRequest('http://localhost/api/live-chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie: c2 }, body: JSON.stringify({ action: 'message', chatId: CHAT, clientId: 'c_evil', content: 'hi' }) }))
    expect(res.status).toBe(403)
    expect(await count('c_evil')).toBe(0)
  })

  it('does not leak internals on a server error', async () => {
    const res = await post({ action: 'message', chatId: CHAT, clientId: 'c_x' })   // missing content
    expect(res.status).toBe(400)
    const txt = JSON.stringify(await res.json())
    expect(txt).not.toMatch(/stack|neon|postgres|DATABASE_URL/i)
  })
})
