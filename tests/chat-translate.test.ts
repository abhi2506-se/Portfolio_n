/** Live-chat message translation: ownership, only admin text, original untouched, privacy payload, provider-less behaviour. (PGlite) */
import { describe, it, expect, vi, beforeAll } from 'vitest'

const h = vi.hoisted(() => ({ pg: null as any }))
vi.mock('@neondatabase/serverless', async () => {
  const { PGlite } = await import('@electric-sql/pglite'); h.pg = new PGlite()
  const run = async (t: string, v: any[]) => (await h.pg.query(t, v)).rows as any[]
  const sql: any = async (s: any, ...v: any[]) => { if (typeof s === 'string') return run(s, v[0] || []); let t = s[0]; for (let i = 0; i < v.length; i++) t += `$${i + 1}` + s[i + 1]; return run(t, v) }
  return { neon: () => sql }
})
vi.mock('@/lib/live-chat-db', () => ({ ensureLiveChatSchema: async () => {} }))
process.env.SESSION_SECRET = 'test-secret'; process.env.DATABASE_URL = 'postgres://x'
delete process.env.ANTHROPIC_API_KEY; delete process.env.GOOGLE_TRANSLATE_API_KEY

import { NextRequest } from 'next/server'
import { createHmac } from 'crypto'
import * as T from '@/app/api/live-chat/translate/route'

const tok = (id: string) => `${id}.${createHmac('sha256', 'test-secret').update(id).digest('hex').slice(0, 24)}`
const call = (body: any, device = 'dev1') => T.POST(new NextRequest('http://l/api/live-chat/translate', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', cookie: `portfolio_visitor_id=${tok(device)}` } }))

beforeAll(async () => {
  await h.pg.query(`CREATE TABLE live_chats (id TEXT PRIMARY KEY, device_id TEXT, visitor_id TEXT)`)
  await h.pg.query(`CREATE TABLE live_chat_messages (id TEXT PRIMARY KEY, chat_id TEXT, role TEXT, content TEXT, unsent_at BIGINT, media_type TEXT)`)
  await h.pg.query(`INSERT INTO live_chats VALUES ('c1','dev1',NULL)`)
  await h.pg.query(`INSERT INTO live_chat_messages VALUES ('m-admin','c1','admin','Hello there',NULL,NULL),('m-user','c1','user','mine',NULL,NULL),('m-unsent','c1','admin','gone',1,NULL)`)
})

describe('POST /api/live-chat/translate', () => {
  it('validates input and blocks English target', async () => {
    expect((await call({ chatId: 'c1', messageId: 'm-admin', locale: 'en' })).status).toBe(400)
    expect((await call({ chatId: 'c1', messageId: 'm-admin', locale: 'xx' })).status).toBe(400)
  })
  it('hides other people’s chats', async () => {
    expect((await call({ chatId: 'c1', messageId: 'm-admin', locale: 'hi' }, 'someone-else')).status).toBe(404)
  })
  it('only admin, non-unsent text messages are translatable', async () => {
    expect((await call({ chatId: 'c1', messageId: 'm-user', locale: 'hi' })).status).toBe(400)
    expect((await call({ chatId: 'c1', messageId: 'm-unsent', locale: 'hi' })).status).toBe(400)
  })
  it('returns 501 without a provider and never alters the original', async () => {
    expect((await call({ chatId: 'c1', messageId: 'm-admin', locale: 'hi' })).status).toBe(501)
    expect((await h.pg.query(`SELECT content FROM live_chat_messages WHERE id='m-admin'`)).rows[0].content).toBe('Hello there')
  })
  it('translates only the single message text, caches it, leaves the original', async () => {
    process.env.ANTHROPIC_API_KEY = 'k'
    const bodies: string[] = []
    const orig = globalThis.fetch
    globalThis.fetch = (async (_u: any, init: any) => { bodies.push(String(init?.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ text: 'नमस्ते' }) }] }), { status: 200 }) }) as any
    try {
      const r = await call({ chatId: 'c1', messageId: 'm-admin', locale: 'hi' })
      expect(r.status).toBe(200); expect((await r.json()).text).toBe('नमस्ते')
      expect(bodies.length).toBe(1); expect(bodies[0]).toContain('Hello there'); expect(bodies[0]).not.toContain('dev1')
      const r2 = await call({ chatId: 'c1', messageId: 'm-admin', locale: 'hi' })
      expect((await r2.json()).cached).toBe(true); expect(bodies.length).toBe(1)
    } finally { globalThis.fetch = orig; delete process.env.ANTHROPIC_API_KEY }
    expect((await h.pg.query(`SELECT content FROM live_chat_messages WHERE id='m-admin'`)).rows[0].content).toBe('Hello there')
  })
})
