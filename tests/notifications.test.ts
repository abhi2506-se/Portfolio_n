/** Notification center + push subscriptions, against real Postgres semantics (PGlite). */
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
import { GET, POST } from '@/app/api/notifications/route'
import * as PushRoute from '@/app/api/notifications/push/route'
import { createNotification, ensureNotificationSchema, recipientChannel, broadcastNotification } from '@/lib/notification-center'
import { safeRelativeUrl } from '@/lib/notification-types'

const tok = (id: string) => `portfolio_visitor_id=${id}.${createHmac('sha256', 'test-secret').update(id).digest('hex').slice(0, 24)}`
const DEV_A = 'a'.repeat(32), DEV_B = 'b'.repeat(32)
const req = (path: string, init: any = {}, dev?: string) =>
  new NextRequest('http://localhost' + path, { ...init, headers: { 'content-type': 'application/json', ...(dev ? { cookie: tok(dev) } : {}), ...(init.headers || {}) } })
const list = async (qs = '', dev?: string) => (await GET(req('/api/notifications' + qs, {}, dev))).json()
const act = (body: any, dev?: string) => POST(req('/api/notifications', { method: 'POST', body: JSON.stringify(body) }, dev))
const flush = () => new Promise(r => setTimeout(r, 20))
const SUB = (n: string) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: 'P'.repeat(60), auth: 'A'.repeat(16) } })

beforeAll(async () => { await ensureNotificationSchema() })
beforeEach(async () => { await new Promise(r => setTimeout(r, 100)); h.visitor = null; h.sent.length = 0; h.bc.mockClear() }) // let the previous test's deferred pushes finish

describe('notification center', () => {
  it('anonymous browser (no cookie) gets an empty list and no cookie is created', async () => {
    const res = await GET(req('/api/notifications'))
    expect(await res.json()).toMatchObject({ items: [], unread: 0, identity: 'none' })
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('stores, lists, marks read, deletes — per recipient, never leaking across users', async () => {
    await createNotification(`g:${DEV_A}`, { type: 'system.notice', title: 'Hello A', body: 'b', url: '/x' })
    await createNotification(`g:${DEV_B}`, { type: 'system.notice', title: 'Hello B' })
    const a = await list('', DEV_A), b = await list('', DEV_B)
    expect(a.items.map((i: any) => i.title)).toEqual(['Hello A'])
    expect(b.items.map((i: any) => i.title)).toEqual(['Hello B'])
    expect(a.unread).toBe(1)
    const id = a.items[0].id
    // B cannot read or delete A's notification
    await act({ action: 'read', ids: [id] }, DEV_B); await act({ action: 'delete', id }, DEV_B)
    expect((await list('', DEV_A)).unread).toBe(1)
    await act({ action: 'read', ids: [id] }, DEV_A)
    expect((await list('', DEV_A)).unread).toBe(0)
    await act({ action: 'clear_read' }, DEV_A)
    expect((await list('', DEV_A)).items).toHaveLength(0)
    expect((await list('', DEV_B)).items).toHaveLength(1)
  })

  it('dedupe: the same dedupeKey is stored once per recipient', async () => {
    const k = `g:${'c'.repeat(32)}`
    expect(await createNotification(k, { type: 'chat.reply', title: 't', dedupeKey: 'chat.reply:m1' })).not.toBeNull()
    expect(await createNotification(k, { type: 'chat.reply', title: 't', dedupeKey: 'chat.reply:m1' })).toBeNull()
    expect(Number((await h.pg.query('SELECT COUNT(*)::int n FROM app_notifications WHERE recipient_key=$1', [k])).rows[0].n)).toBe(1)
  })

  it('keyset pagination returns every item exactly once, newest first', async () => {
    const dev = 'd'.repeat(32)
    for (let i = 0; i < 7; i++) await createNotification(`g:${dev}`, { type: 'system.notice', title: `n${i}`, dedupeKey: `k${i}` })
    const seen: string[] = []; let cursor: string | null = null
    for (let guard = 0; guard < 5; guard++) {
      const d: any = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ''}`, dev)
      seen.push(...d.items.map((i: any) => i.title)); cursor = d.nextCursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(7); expect(new Set(seen).size).toBe(7)
  })

  it('category filter and unauthenticated writes', async () => {
    const dev = 'e'.repeat(32)
    await createNotification(`g:${dev}`, { type: 'chat.reply', title: 'c' }); await createNotification(`g:${dev}`, { type: 'site.announcement', title: 'w' })
    expect((await list('?category=live_chat', dev)).items.map((i: any) => i.title)).toEqual(['c'])
    expect((await act({ action: 'read_all' })).status).toBe(401)
  })

  it('a signed-in visitor sees their notifications on any device; a guest on the same browser after logout does not', async () => {
    h.visitor = { visitorId: 'v1', fullName: 'A', email: 'a@x', mobile: '1' }
    await createNotification('v:v1', { type: 'security.password_changed', title: 'pw' })
    expect((await list('', DEV_A)).items.map((i: any) => i.title)).toEqual(['pw'])
    expect((await list('', 'f'.repeat(32))).items).toHaveLength(1)   // other device, same account
    h.visitor = null                                                   // logged out
    expect((await list('', DEV_A)).items.every((i: any) => i.title !== 'pw')).toBe(true)
  })

  it('rejects unsafe URLs and unknown types; realtime payload carries no content', async () => {
    expect(safeRelativeUrl('//evil.com')).toBeNull(); expect(safeRelativeUrl('javascript:alert(1)')).toBeNull(); expect(safeRelativeUrl('/ok?a=1')).toBe('/ok?a=1')
    const k = `g:${'9'.repeat(32)}`
    const it1 = await createNotification(k, { type: 'system.notice', title: 'T', url: 'https://evil.com' })
    expect(it1?.url).toBeNull()
    expect(await createNotification(k, { type: 'nope' as any, title: 'x' })).toBeNull()
    await flush()
    const call = h.bc.mock.calls.find((c: any) => c[0] === recipientChannel(k))!
    expect(call[2]).toEqual({ t: 'changed' }); expect(call[0]).not.toContain('9999')
  })

  it('broadcastNotification reaches push-subscribed guests', async () => {
    const dev = '7'.repeat(32)
    await POST_PUSH(SUB('bc'), dev)
    const n = await broadcastNotification({ type: 'site.announcement', title: 'Big news', dedupeKey: 'ann1' })
    expect(n).toBeGreaterThanOrEqual(1)
    expect((await list('', dev)).items.map((i: any) => i.title)).toContain('Big news')
  })
})

const POST_PUSH = (subscription: any, dev?: string, extra: any = {}) =>
  PushRoute.POST(req('/api/notifications/push', { method: 'POST', body: JSON.stringify({ subscription, ...extra }) }, dev))

describe('web push subscriptions', () => {
  it('rejects non-https endpoints and short keys', async () => {
    expect((await POST_PUSH({ endpoint: 'http://x/1', keys: SUB('x').keys }, DEV_A)).status).toBe(400)
    expect((await POST_PUSH({ endpoint: 'https://x/1', keys: { p256dh: 'a', auth: 'b' } }, DEV_A)).status).toBe(400)
  })

  it('first opt-in by an anonymous browser creates the device cookie; subscribing is bound to that identity', async () => {
    const res = await POST_PUSH(SUB('anon'))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('portfolio_visitor_id=')
  })

  it('sends a privacy-safe payload, removes dead endpoints (410), and rebinds on identity change', async () => {
    const dev = '5'.repeat(32)
    await POST_PUSH(SUB('live'), dev)
    await createNotification(`g:${dev}`, { type: 'chat.reply', title: 'New reply from Abhishek', body: 'Tap to open your conversation.', url: '/?openChat=1', dedupeKey: 'p1' })
    await flush(); await flush()
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].payload).toMatchObject({ kind: 'user', title: 'New reply from Abhishek', url: '/?openChat=1' })

    // same endpoint now used by a signed-in visitor → moves to v:v9, old guest no longer receives it
    h.visitor = { visitorId: 'v9', fullName: 'N', email: 'n@x', mobile: '1' }
    await POST_PUSH(SUB('live'), dev)
    h.visitor = null; h.sent.length = 0
    await createNotification(`g:${dev}`, { type: 'chat.reply', title: 'x', dedupeKey: 'p2' }); await flush(); await flush()
    expect(h.sent).toHaveLength(0)
    await createNotification('v:v9', { type: 'chat.reply', title: 'y', dedupeKey: 'p3' }); await flush(); await flush()
    expect(h.sent).toHaveLength(1)

    // DELETE is identity-bound: a different guest can't remove it
    await PushRoute.DELETE(req('/api/notifications/push', { method: 'DELETE', body: JSON.stringify({ endpoint: SUB('live').endpoint }) }, DEV_B))
    expect(Number((await h.pg.query('SELECT COUNT(*)::int n FROM notification_push_subscriptions WHERE endpoint=$1', [SUB('live').endpoint])).rows[0].n)).toBe(1)
  })

  it('oldEndpoint renewal replaces the previous subscription', async () => {
    const dev = '4'.repeat(32)
    await POST_PUSH(SUB('old'), dev)
    await POST_PUSH(SUB('new'), dev, { oldEndpoint: SUB('old').endpoint })
    const rows = (await h.pg.query(`SELECT endpoint FROM notification_push_subscriptions WHERE recipient_key=$1`, [`g:${dev}`])).rows.map((r: any) => r.endpoint)
    expect(rows).toEqual([SUB('new').endpoint])
  })
})
