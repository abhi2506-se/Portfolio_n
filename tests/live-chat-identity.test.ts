/**
 * Phase 2: server-verified visitor identity & chat isolation. Against
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
  visitor: null as any,
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

vi.mock('@/lib/live-chat-identity', async (orig) => ({ ...(await orig<typeof import('@/lib/live-chat-identity')>()), getVisitorForChat: async () => h.visitor }))
process.env.SESSION_SECRET = 'test-secret'
process.env.DATABASE_URL = 'postgres://test:test@localhost/test'
import { POST, GET } from '@/app/api/live-chat/route'
import { NextRequest } from 'next/server'
import { ensureLiveChatSchema } from '@/lib/live-chat-db'
import { ownsChat } from '@/lib/live-chat-identity'

const mk = (dev: string) => `portfolio_visitor_id=${dev}.${createHmac('sha256', 'test-secret').update(dev).digest('hex').slice(0, 24)}`
const DEV = 'dev0123456789abcdef0123456789abcd'
const ASHA = { visitorId: 'v_asha', fullName: 'Asha Rao', email: 'asha@x.com', mobile: '+911111111111' }
const BOB = { visitorId: 'v_bob', fullName: 'Bob', email: 'bob@x.com', mobile: '+912222222222' }
const post = (body: any, dev = DEV) => POST(new NextRequest('http://localhost/api/live-chat', { method: 'POST', headers: { 'content-type': 'application/json', cookie: mk(dev) }, body: JSON.stringify(body) }))
const get = (qs: string, dev = DEV) => GET(new NextRequest('http://localhost/api/live-chat?' + qs, { headers: { cookie: mk(dev) } }))
const flush = () => Promise.all(h.afterJobs.splice(0))

beforeAll(async () => { await ensureLiveChatSchema() })
beforeEach(() => { h.visitor = null; h.broadcast.mockReset(); h.broadcast.mockResolvedValue(undefined) })

describe('ownsChat', () => {
  it('visitor chat requires that visitor, never just the device', () => {
    const row = { device_id: DEV, visitor_id: 'v_asha' }
    expect(ownsChat(row, DEV, 'v_asha', true)).toBe(true)
    expect(ownsChat(row, DEV, null, true)).toBe(false)       // logged out, same browser
    expect(ownsChat(row, DEV, 'v_bob', true)).toBe(false)    // different account, same browser
  })
  it('guest chat keeps the device-cookie rule', () => {
    expect(ownsChat({ device_id: DEV }, DEV, null, true)).toBe(true)
    expect(ownsChat({ device_id: DEV }, 'other', null, true)).toBe(false)
    expect(ownsChat(null, DEV, null)).toBe(false)
  })
})

describe('live chat identity', () => {
  it('whoami: guest -> unauthenticated; visitor -> identity + last chat', async () => {
    expect(await (await get('whoami=1')).json()).toEqual({ authenticated: false })
    h.visitor = ASHA
    const r = await (await post({ action: 'start', sessionId: 's1', initialMessage: 'Hi there' })).json()
    expect(r.chatId).toBeTruthy()
    const w = await (await get('whoami=1')).json()
    expect(w).toMatchObject({ authenticated: true, name: 'Asha Rao', email: 'asha@x.com', chat: { id: r.chatId } })
  })

  it('start for a visitor ignores browser-supplied identity and stores the session identity', async () => {
    h.visitor = BOB
    const r = await (await post({ action: 'start', sessionId: 's2', userName: 'Evil', userEmail: 'evil@x.com', userPhone: '999', initialMessage: 'hello' }, 'devBOB0123456789abcdef0123456789ab')).json()
    const row = (await h.pg.query('SELECT user_name,user_email,visitor_id FROM live_chats WHERE id=$1', [r.chatId])).rows[0]
    expect(row).toMatchObject({ user_name: 'Bob', user_email: 'bob@x.com', visitor_id: 'v_bob' })
  })

  it('start resumes the same visitor thread instead of creating a second one', async () => {
    h.visitor = ASHA
    const a = await (await post({ action: 'start', sessionId: 's1', initialMessage: 'again' })).json()
    const n = Number((await h.pg.query(`SELECT COUNT(*)::int n FROM live_chats WHERE visitor_id='v_asha'`)).rows[0].n)
    expect(n).toBe(1)
    expect(a.chatId).toBeTruthy()
  })

  it('after logout the same browser cannot read or write the visitor chat', async () => {
    h.visitor = ASHA
    const { chatId } = await (await post({ action: 'start', sessionId: 's1', initialMessage: 'secret' })).json()
    h.visitor = null                                         // logged out, same device cookie
    const w = await post({ action: 'message', chatId, clientId: 'c_x', content: 'intruder' })
    expect([401, 403, 404]).toContain(w.status)
    const rd = await get(`chatId=${chatId}`)
    const body = await rd.json().catch(() => ({}))
    expect(JSON.stringify(body)).not.toContain('secret')
    h.visitor = BOB                                          // a different account
    const w2 = await post({ action: 'message', chatId, clientId: 'c_y', content: 'bob?' })
    expect([401, 403, 404]).toContain(w2.status)
    expect(Number((await h.pg.query(`SELECT COUNT(*)::int n FROM live_chat_messages WHERE chat_id=$1 AND content IN ('intruder','bob?')`, [chatId])).rows[0].n)).toBe(0)
    await flush()
  })

  it('the owner can still send after re-login', async () => {
    h.visitor = ASHA
    const { chatId } = await (await post({ action: 'start', sessionId: 's1', initialMessage: 'x' })).json()
    const w = await post({ action: 'message', chatId, clientId: 'c_ok', content: 'back' }, 'devNEW0123456789abcdef0123456789ab')
    expect(w.status).toBe(200)
    await flush()
  })
})
