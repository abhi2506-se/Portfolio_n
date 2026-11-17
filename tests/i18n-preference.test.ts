/** Language preference API + localized push payloads (PGlite). */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

const h = vi.hoisted(() => ({ pg: null as any, visitor: null as any, bc: null as any, sent: [] as any[] }))
h.bc = vi.fn(async () => {})

vi.mock('@/lib/supabase-realtime', () => ({ broadcastToChat: (...a: any[]) => h.bc(...a), chatChannelName: (id: string) => `chat:${id}` }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => any) => { Promise.resolve().then(fn).catch(() => {}) } }))
vi.mock('@/lib/live-chat-identity', () => ({ getVisitorForChat: async () => h.visitor }))
vi.mock('web-push', () => ({ default: { setVapidDetails: () => {}, sendNotification: async (sub: any, payload: string) => { h.sent.push({ sub, payload: JSON.parse(payload) }) } } }))
vi.mock('@neondatabase/serverless', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  h.pg = new PGlite()
  const run = async (text: string, values: any[]) => (await h.pg.query(text, values)).rows as any[]
  const sql: any = async (strings: any, ...values: any[]) => {
    if (typeof strings === 'string') return run(strings, values[0] || [])
    let text = strings[0]; for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1]
    return run(text, values)
  }
  return { neon: () => sql }
})

process.env.SESSION_SECRET = 'test-secret'
process.env.DATABASE_URL = 'postgres://x'
process.env.VAPID_PUBLIC_KEY = 'BPubKeyBPubKeyBPubKeyBPubKeyBPubKeyBPubKeyBPubKeyBPubKey'
process.env.VAPID_PRIVATE_KEY = 'priv'
import { NextRequest } from 'next/server'
import * as Pref from '@/app/api/i18n/preference/route'
import * as PushRoute from '@/app/api/notifications/push/route'
import { createNotification, ensureNotificationSchema } from '@/lib/notification-center'

const tok = (id: string) => `portfolio_visitor_id=${id}.${createHmac('sha256', 'test-secret').update(id).digest('hex').slice(0, 24)}`
const r = (path: string, init: any = {}, cookie = '') => new NextRequest('http://localhost' + path, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } })
const flush = () => new Promise(res => setTimeout(res, 30))
const SUB = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'P'.repeat(60), auth: 'A'.repeat(16) } })
beforeAll(async () => { await ensureNotificationSchema() })
beforeEach(() => { h.visitor = null; h.sent.length = 0 })

describe('language preference API', () => {
  it('guest: GET unauthenticated, POST not saved (cookie-only), invalid locale rejected', async () => {
    expect(await (await Pref.GET(r('/api/i18n/preference'))).json()).toEqual({ authenticated: false })
    expect(await (await Pref.POST(r('/api/i18n/preference', { method: 'POST', body: JSON.stringify({ locale: 'de' }) }))).json()).toEqual({ saved: false })
    expect((await Pref.POST(r('/api/i18n/preference', { method: 'POST', body: JSON.stringify({ locale: 'xx' }) }))).status).toBe(400)
  })
  it('visitor: saved to the account, restored on another device, one visitor never changes another', async () => {
    h.visitor = { visitorId: 'v1', fullName: 'A', email: 'a@x', mobile: '1' }
    await Pref.POST(r('/api/i18n/preference', { method: 'POST', body: JSON.stringify({ locale: 'fr' }) }, tok('a'.repeat(32))))
    const other = await (await Pref.GET(r('/api/i18n/preference', {}, tok('b'.repeat(32))))).json()   // different device, same account
    expect(other).toMatchObject({ authenticated: true, locale: 'fr' }); expect(other.updatedAt).toBeGreaterThan(0)
    h.visitor = { visitorId: 'v2', fullName: 'B', email: 'b@x', mobile: '1' }
    expect(await (await Pref.GET(r('/api/i18n/preference'))).json()).toMatchObject({ authenticated: true, locale: null })
  })
})

describe('localized push', () => {
  it('delivers the notification text in the recipient language (visitor account pref, guest cookie)', async () => {
    // visitor v1 prefers French (saved above); subscribe a device for them
    h.visitor = { visitorId: 'v1', fullName: 'A', email: 'a@x', mobile: '1' }
    await PushRoute.POST(r('/api/notifications/push', { method: 'POST', body: JSON.stringify({ subscription: SUB('v1dev') }) }, tok('c'.repeat(32))))
    h.visitor = null
    // guest with German cookie
    await PushRoute.POST(r('/api/notifications/push', { method: 'POST', body: JSON.stringify({ subscription: SUB('gdev') }) }, `${tok('d'.repeat(32))}; portfolio_lang=de`))
    await createNotification('v:v1', { type: 'chat.reply', title: 'New reply from Abhishek', body: 'Tap to open your conversation.', url: '/?openChat=1', dedupeKey: 'lp1' })
    await createNotification(`g:${'d'.repeat(32)}`, { type: 'chat.reply', title: 'New reply from Abhishek', body: 'Tap to open your conversation.', url: '/?openChat=1', dedupeKey: 'lp2' })
    await flush(); await flush()
    const byEndpoint = (e: string) => h.sent.find(x => x.sub.endpoint === e)?.payload
    expect(byEndpoint('https://push.example/v1dev')).toMatchObject({ title: 'Nouvelle réponse d’Abhishek' })
    expect(byEndpoint('https://push.example/gdev')).toMatchObject({ title: 'Neue Antwort von Abhishek' })
  })
  it('unknown notification types keep their stored text', async () => {
    await createNotification('v:v1', { type: 'site.announcement', title: 'Custom announcement', body: 'Hello', dedupeKey: 'lp3' })
    await flush(); await flush()
    expect(h.sent.find(x => x.payload.title === 'Custom announcement')).toBeTruthy()
  })
})
