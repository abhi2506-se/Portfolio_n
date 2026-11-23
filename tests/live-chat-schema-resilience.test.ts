/** A bootstrap statement that fails in production must NOT take live chat down (regression: "Internal error" on start). */
import { it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ pg: null as any, failOn: [] as string[], calls: 0 }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: async () => ({}) }) } }))
vi.mock('@/lib/supabase-realtime', () => ({ broadcastToChat: async () => {}, chatChannelName: (i: string) => i }))
vi.mock('@/lib/notifications', () => ({ sendPushToAdmin: async () => {} }))
vi.mock('next/server', async (o) => ({ ...(await o<any>()), after: (f: any) => { Promise.resolve().then(f).catch(() => {}) } }))
vi.mock('@neondatabase/serverless', async () => {
  const { PGlite } = await import('@electric-sql/pglite'); h.pg = new PGlite()
  const run = async (t: string, v: any[]) => {
    h.calls++
    if (h.failOn.some(f => t.includes(f))) throw new Error('simulated prod failure: ' + t.slice(0, 40))
    return (await h.pg.query(t, v)).rows
  }
  const sql: any = async (s: any, ...v: any[]) => { if (typeof s === 'string') return run(s, v[0] || []); let t = s[0]; for (let i = 0; i < v.length; i++) t += `$${i + 1}` + s[i + 1]; return run(t, v) }
  return { neon: () => sql }
})
process.env.SESSION_SECRET = 's'; process.env.DATABASE_URL = 'x'
import { POST, GET } from '@/app/api/live-chat/route'
import { NextRequest } from 'next/server'

it('chat start and whoami still work when schema statements fail', async () => {
  h.failOn = ['idx_live_chats_device', 'live_chat_wallpaper_prefs', 'idx_live_chats_visitor', 'idx_live_chat_messages_chat']
  const who = await GET(new NextRequest('http://l/api/live-chat?whoami=1'))
  expect(who.status).toBe(200)
  const res = await POST(new NextRequest('http://l/api/live-chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start', userName: 'Asha', userEmail: 'a@x.com', userPhone: '+919876543210', sessionId: 's', initialMessage: 'hi', fingerprint: 'f' }) }))
  expect(res.status).toBe(200)
  expect((await res.json()).chatId).toBeTruthy()
})

it('a failing bootstrap is retried only a few times, not on every request', async () => {
  h.failOn = ['ADD COLUMN IF NOT EXISTS visitor_id']   // permanent column failure
  const hit = () => GET(new NextRequest('http://l/api/live-chat?whoami=1'))
  for (let i = 0; i < 3; i++) await hit()
  const before = h.calls
  await hit(); await hit()
  expect(h.calls - before).toBeLessThan(10)             // no more 100-statement re-runs
})
