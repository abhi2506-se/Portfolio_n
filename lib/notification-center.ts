/**
 * Notification center — in-app notifications for visitors and guests.
 *
 * Recipients
 *   v:<visitorId>   a signed-in visitor (follows them across devices)
 *   g:<deviceId>    a guest, identified by the signed device cookie (never created on read)
 * The recipient is ALWAYS derived on the server from cookies — never from request input.
 *
 * Privacy: realtime payloads are only {t:'changed'} on an unguessable per-recipient channel;
 * notification text lives in Neon and is returned only to its owner. Live-chat notifications
 * are generic ("New reply from Abhishek") and never contain message content.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { after } from 'next/server'
import type { NextRequest } from 'next/server'
import { lazySql } from '@/lib/neon-lazy'
import { readDeviceId } from '@/lib/device-id'
import { getVisitorForChat } from '@/lib/live-chat-identity'
import { broadcastToChat } from '@/lib/supabase-realtime'
import {
  NOTIFICATION_TYPES, safeRelativeUrl, type NotificationCategory, type NotificationItem, type NotificationType, CATEGORIES,
} from '@/lib/notification-types'

const sql: any = lazySql

let migrating: Promise<void> | null = null
export function ensureNotificationSchema(): Promise<void> {
  if (!migrating) {
    migrating = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS app_notifications (
        id TEXT PRIMARY KEY,
        recipient_key TEXT NOT NULL,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        url TEXT,
        data JSONB,
        dedupe_key TEXT,
        created_at BIGINT NOT NULL,
        read_at BIGINT
      )`
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_app_notif_dedupe ON app_notifications (recipient_key, dedupe_key) WHERE dedupe_key IS NOT NULL`
      await sql`CREATE INDEX IF NOT EXISTS idx_app_notif_list ON app_notifications (recipient_key, created_at DESC, id DESC)`
      await sql`CREATE TABLE IF NOT EXISTS notification_push_subscriptions (
        id TEXT PRIMARY KEY,
        recipient_key TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        categories TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        last_success_at BIGINT,
        failure_count INT NOT NULL DEFAULT 0
      )`
      await sql`ALTER TABLE notification_push_subscriptions ADD COLUMN IF NOT EXISTS locale TEXT`.catch(() => {})
      await sql`CREATE INDEX IF NOT EXISTS idx_notif_push_recipient ON notification_push_subscriptions (recipient_key)`
    })().catch(err => { migrating = null; throw err })
  }
  return migrating
}

export const newNotificationId = () => `n_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`

// ── Recipient resolution ─────────────────────────────────────────────────────
export interface Recipient { key: string; kind: 'visitor' | 'guest' }

/** Who is asking? Never creates a cookie; returns null for an anonymous first-time browser. */
export async function resolveRecipient(req: NextRequest): Promise<Recipient | null> {
  const v = await getVisitorForChat(req)
  if (v) return { key: `v:${v.visitorId}`, kind: 'visitor' }
  const dev = readDeviceId(req)
  return dev ? { key: `g:${dev}`, kind: 'guest' } : null
}

const SECRET = () => process.env.SESSION_SECRET || 'portfolio-admin-session-secret-2024'
/** Unguessable realtime channel id for a recipient (the key itself is never published). */
export function recipientChannel(key: string): string {
  return 'n_' + createHmac('sha256', SECRET()).update('notif:' + key).digest('hex').slice(0, 32)
}

// ── Create ───────────────────────────────────────────────────────────────────
export interface NewNotification {
  type: NotificationType
  title: string
  body?: string
  url?: string | null
  data?: Record<string, unknown>
  /** Same (recipient, dedupeKey) is stored/pushed once. */
  dedupeKey?: string
  /** Send a Web Push if the recipient has a subscription. Default true. */
  push?: boolean
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

function deferred(fn: () => Promise<unknown>) {
  const run = () => fn().catch(e => console.error('[notifications] background task failed:', e))
  try { after(run) } catch { void run() } // outside a request scope (cron/scripts)
}

/** Returns the created notification, or null if it was a duplicate / invalid. Never throws. */
export async function createNotification(recipientKey: string, n: NewNotification): Promise<NotificationItem | null> {
  try {
    const category = NOTIFICATION_TYPES[n.type]
    if (!category || !recipientKey) return null
    await ensureNotificationSchema()
    const id = newNotificationId()
    const now = Date.now()
    const url = safeRelativeUrl(n.url ?? null)
    const rows = await sql`
      INSERT INTO app_notifications (id, recipient_key, category, type, title, body, url, data, dedupe_key, created_at)
      VALUES (${id}, ${recipientKey}, ${category}, ${n.type}, ${clip(n.title, 140)}, ${clip(n.body || '', 400)}, ${url},
              ${n.data ? JSON.stringify(n.data) : null}::jsonb, ${n.dedupeKey ?? null}, ${now})
      ON CONFLICT DO NOTHING
      RETURNING id`
    if (!rows[0]) return null
    const item: NotificationItem = { id, category, type: n.type, title: clip(n.title, 140), body: clip(n.body || '', 400), url, createdAt: now, readAt: null, data: (n.data as any) ?? null }
    deferred(async () => {
      await broadcastToChat(recipientChannel(recipientKey), 'notif', { t: 'changed' })
      if (n.push !== false) {
        const { sendPushToRecipients } = await import('@/lib/notification-push')
        await sendPushToRecipients([recipientKey], { title: item.title, body: item.body, url: item.url || '/', tag: n.dedupeKey || item.id, category, type: n.type, data: n.data as any })
      }
    })
    if (Math.random() < 0.02) deferred(pruneOldRead)
    return item
  } catch (err) {
    console.error('[notifications] create failed:', err)
    return null
  }
}

/** Fan out one notification to several recipients (deduplicated). */
export async function notifyRecipients(keys: string[], n: NewNotification) {
  const out: (NotificationItem | null)[] = []
  for (const k of Array.from(new Set(keys))) out.push(await createNotification(k, n))
  return out
}

/** Site-wide announcement → every signed-in visitor + every push-subscribed device. Never throws. */
export async function broadcastNotification(n: NewNotification): Promise<number> {
  try {
    await ensureNotificationSchema()
    const keys: string[] = []
    try {
      const vs = await sql`SELECT id FROM visitors WHERE status = 'active' AND expires_at > now() LIMIT 5000`
      for (const v of vs) keys.push(`v:${v.id}`)
    } catch { /* visitor tables may not exist */ }
    const subs = await sql`SELECT DISTINCT recipient_key FROM notification_push_subscriptions LIMIT 5000`
    for (const s of subs) keys.push(s.recipient_key)
    const uniq = Array.from(new Set(keys))
    const base = n.dedupeKey || `bc_${Date.now().toString(36)}`
    let created = 0
    for (const k of uniq) if (await createNotification(k, { ...n, dedupeKey: base })) created++
    return created
  } catch (err) {
    console.error('[notifications] broadcast failed:', err)
    return 0
  }
}

// ── Read / update ────────────────────────────────────────────────────────────
const mapRow = (r: any): NotificationItem => ({
  id: r.id, category: r.category, type: r.type, title: r.title, body: r.body, url: r.url,
  createdAt: Number(r.created_at), readAt: r.read_at == null ? null : Number(r.read_at),
  data: r.data && typeof r.data === 'object' ? r.data : null,
})

export async function listNotifications(key: string, opts: { limit?: number; cursor?: string | null; category?: string | null; unreadOnly?: boolean } = {}) {
  await ensureNotificationSchema()
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50)
  const category = opts.category && (CATEGORIES as readonly string[]).includes(opts.category) ? opts.category : null
  let curT = Number.MAX_SAFE_INTEGER, curId = '￿'
  if (opts.cursor) {
    const [t, ...rest] = opts.cursor.split('_')
    if (/^\d+$/.test(t) && rest.length) { curT = Number(t); curId = rest.join('_') }
  }
  const rows = await sql`
    SELECT * FROM app_notifications
    WHERE recipient_key = ${key}
      AND (created_at, id) < (${curT}, ${curId})
      AND (${category}::text IS NULL OR category = ${category})
      AND (${!!opts.unreadOnly}::boolean = FALSE OR read_at IS NULL)
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit + 1}`
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const unread = Number((await sql`SELECT COUNT(*)::int AS n FROM app_notifications WHERE recipient_key = ${key} AND read_at IS NULL`)[0].n)
  return {
    items: page.map(mapRow),
    nextCursor: rows.length > limit && last ? `${last.created_at}_${last.id}` : null,
    unread,
  }
}

export async function markRead(key: string, ids: string[]) {
  if (!ids.length) return
  await sql`UPDATE app_notifications SET read_at = ${Date.now()} WHERE recipient_key = ${key} AND id = ANY(${ids.slice(0, 100)}) AND read_at IS NULL`
}
export async function markAllRead(key: string) {
  await sql`UPDATE app_notifications SET read_at = ${Date.now()} WHERE recipient_key = ${key} AND read_at IS NULL`
}
export async function deleteNotification(key: string, id: string) {
  await sql`DELETE FROM app_notifications WHERE recipient_key = ${key} AND id = ${id}`
}
export async function clearRead(key: string) {
  await sql`DELETE FROM app_notifications WHERE recipient_key = ${key} AND read_at IS NOT NULL`
}
/** Housekeeping: read items older than 90 days, anything older than 1 year. */
async function pruneOldRead() {
  const now = Date.now()
  await sql`DELETE FROM app_notifications WHERE (read_at IS NOT NULL AND created_at < ${now - 90 * 864e5}) OR created_at < ${now - 365 * 864e5}`
}
