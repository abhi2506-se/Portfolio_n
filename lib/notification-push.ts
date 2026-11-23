/**
 * Web Push for visitors/guests (separate from the admin push tables).
 * Subscriptions are bound to a recipient key (v:<visitorId> | g:<deviceId>).
 * Payloads are privacy-safe: title/body written by the producer, no chat content.
 */
import webpush from 'web-push'
import { lazySql } from '@/lib/neon-lazy'
import { ensureNotificationSchema } from '@/lib/notification-center'
import { loadMessages } from '@/lib/i18n/messages'
import { createTOr } from '@/lib/i18n/translate'
import { parseLocale, type Locale } from '@/lib/i18n/config'

const sql: any = lazySql
const MAX_PER_RECIPIENT = 10
const MAX_FAILURES = 5

let vapidReady = false
function ensureVapid(): boolean {
  if (vapidReady) return true
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return false
  const mail = process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'admin@example.com'
  webpush.setVapidDetails(mail.startsWith('mailto:') ? mail : `mailto:${mail}`, pub, priv)
  vapidReady = true
  return true
}
export const pushConfigured = () => !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

export interface PushInput { endpoint: string; p256dh: string; auth: string }

/** Validates a browser PushSubscription JSON. Returns null if unacceptable. */
export function parseSubscription(sub: any): PushInput | null {
  const endpoint = sub?.endpoint, p256dh = sub?.keys?.p256dh, auth = sub?.keys?.auth
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return null
  try { if (new URL(endpoint).protocol !== 'https:') return null } catch { return null }
  if (typeof p256dh !== 'string' || p256dh.length < 40 || p256dh.length > 200) return null
  if (typeof auth !== 'string' || auth.length < 8 || auth.length > 100) return null
  return { endpoint, p256dh, auth }
}

/** Upsert by endpoint: re-binds the device to the CURRENT identity (so a logout/login switch can't leak). */
export async function savePushSubscription(recipientKey: string, sub: PushInput, userAgent: string, oldEndpoint?: string | null, locale?: string | null) {
  await ensureNotificationSchema()
  const now = Date.now()
  if (oldEndpoint && oldEndpoint !== sub.endpoint) {
    await sql`DELETE FROM notification_push_subscriptions WHERE endpoint = ${oldEndpoint} AND recipient_key = ${recipientKey}`
  }
  await sql`
    INSERT INTO notification_push_subscriptions (id, recipient_key, endpoint, p256dh, auth, user_agent, created_at, updated_at, locale)
    VALUES (${'ps_' + now.toString(36) + Math.random().toString(36).slice(2, 8)}, ${recipientKey}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${userAgent.slice(0, 200)}, ${now}, ${now}, ${locale ?? null})
    ON CONFLICT (endpoint) DO UPDATE SET recipient_key = EXCLUDED.recipient_key, p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth, updated_at = EXCLUDED.updated_at, failure_count = 0, locale = COALESCE(EXCLUDED.locale, notification_push_subscriptions.locale)`
  // cap: keep the newest MAX_PER_RECIPIENT
  await sql`
    DELETE FROM notification_push_subscriptions WHERE recipient_key = ${recipientKey} AND id NOT IN (
      SELECT id FROM notification_push_subscriptions WHERE recipient_key = ${recipientKey} ORDER BY updated_at DESC LIMIT ${MAX_PER_RECIPIENT})`
}

export async function removePushSubscription(recipientKey: string, endpoint: string) {
  await ensureNotificationSchema()
  await sql`DELETE FROM notification_push_subscriptions WHERE recipient_key = ${recipientKey} AND endpoint = ${endpoint}`
}
export async function hasPushSubscription(recipientKey: string, endpoint?: string | null): Promise<boolean> {
  await ensureNotificationSchema()
  const r = endpoint
    ? await sql`SELECT 1 FROM notification_push_subscriptions WHERE recipient_key = ${recipientKey} AND endpoint = ${endpoint} LIMIT 1`
    : await sql`SELECT 1 FROM notification_push_subscriptions WHERE recipient_key = ${recipientKey} LIMIT 1`
  return !!r[0]
}
/** Detach every device from a recipient (used on logout for a visitor's browser). */
export async function removePushForEndpoint(endpoint: string) {
  await ensureNotificationSchema()
  await sql`DELETE FROM notification_push_subscriptions WHERE endpoint = ${endpoint}`
}

export interface UserPush { title: string; body: string; url: string; tag?: string; category?: string; type?: string; data?: Record<string, string | number> }

/** Sends to every device of the given recipients. Dead endpoints are removed; repeated failures too. Never throws. */
export async function sendPushToRecipients(keys: string[], p: UserPush): Promise<number> {
  try {
    if (!ensureVapid() || !keys.length) return 0
    await ensureNotificationSchema()
    let subs = await sql`SELECT * FROM notification_push_subscriptions WHERE recipient_key = ANY(${keys})`
    if (p.category === 'website' && subs.length) {
      // Site-wide posts are already pushed to legacy subscribers by lib/notifications.ts — skip those endpoints.
      try {
        const legacy = new Set((await sql`SELECT endpoint FROM visitor_push_subscriptions`).map((r: any) => r.endpoint))
        subs = subs.filter((s: any) => !legacy.has(s.endpoint))
      } catch { /* legacy table absent */ }
    }
    // Visitors: their account language; guests: the language their browser last reported.
    const prefs = new Map<string, string>()
    try {
      const vk = keys.filter(k => k.startsWith('v:'))
      if (vk.length) for (const r of await sql`SELECT recipient_key, locale FROM user_language_prefs WHERE recipient_key = ANY(${vk})`) prefs.set(r.recipient_key, r.locale)
    } catch { /* prefs table may not exist yet */ }
    const localized = new Map<Locale, { title: string; body: string }>()
    const forLocale = async (loc: Locale) => {
      let v = localized.get(loc)
      if (!v) {
        if (p.type) {
          const tOr = createTOr(await loadMessages(loc, ['user']))
          v = { title: tOr(`notif.${p.type}.title`, p.title, p.data), body: tOr(`notif.${p.type}.body`, p.body, p.data) }
        } else v = { title: p.title, body: p.body }
        localized.set(loc, v)
      }
      return v
    }
    const payloadFor = async (s: any) => {
      const loc = parseLocale(prefs.get(s.recipient_key) || s.locale)
      const m = await forLocale(loc)
      return JSON.stringify({
        kind: 'user', title: m.title, body: m.body, url: p.url, tag: p.tag || 'portfolio',
        icon: '/icons/icon-192x192.png', badge: '/icons/icon-192x192.png', data: { category: p.category || '' },
      })
    }
    let ok = 0
    await Promise.allSettled(subs.map(async (s: any) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, await payloadFor(s), { TTL: 86400, urgency: 'normal' })
        ok++
        await sql`UPDATE notification_push_subscriptions SET last_success_at = ${Date.now()}, failure_count = 0 WHERE id = ${s.id}`
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await sql`DELETE FROM notification_push_subscriptions WHERE id = ${s.id}`
        } else {
          await sql`UPDATE notification_push_subscriptions SET failure_count = failure_count + 1 WHERE id = ${s.id}`
          await sql`DELETE FROM notification_push_subscriptions WHERE id = ${s.id} AND failure_count >= ${MAX_FAILURES}`
        }
      }
    }))
    return ok
  } catch (err) {
    console.error('[notification-push] send failed:', err)
    return 0
  }
}
