/** Account / security notifications for signed-in visitors. Never throws; never blocks login. */
import { lazySql } from '@/lib/neon-lazy'
import { createNotification } from '@/lib/notification-center'
import { parseUserAgent } from '@/lib/visitor/ua'

const sql: any = lazySql

/** Call BEFORE the new session row is created so "previous sessions" excludes it. */
export async function loginFingerprint(visitorId: string, ua: string): Promise<{ known: boolean; browser: string; os: string; first: boolean }> {
  const info = parseUserAgent(ua)
  try {
    const rows = await sql`SELECT 1 AS x, (browser = ${info.browser} AND os = ${info.os}) AS same FROM visitor_sessions_auth WHERE visitor_id = ${visitorId} ORDER BY login_at DESC LIMIT 50`
    return { known: rows.some((r: any) => r.same), browser: info.browser, os: info.os, first: rows.length === 0 }
  } catch { return { known: true, browser: info.browser, os: info.os, first: false } }
}

export async function notifyLogin(visitorId: string, fp: { known: boolean; browser: string; os: string; first: boolean }, sessionKey: string) {
  try {
    if (!fp.first && !fp.known) {
      await createNotification(`v:${visitorId}`, {
        type: 'security.new_device', title: 'New sign-in from a new device',
        body: `${fp.browser} on ${fp.os}. If this wasn't you, change your password.`, url: '/visitor/dashboard', dedupeKey: `login:${sessionKey}`, data: { browser: fp.browser, os: fp.os },
      })
    } else {
      await createNotification(`v:${visitorId}`, {
        type: 'account.login', title: 'Signed in', body: `${fp.browser} on ${fp.os}`, url: '/visitor/dashboard', dedupeKey: `login:${sessionKey}`, push: false, data: { browser: fp.browser, os: fp.os },
      })
    }
  } catch (e) { console.error('[visitor-notify] login failed:', e) }
}

export async function notifySecurity(visitorId: string, kind: 'password_changed' | 'account_locked', dedupeKey: string) {
  const copy = kind === 'password_changed'
    ? { type: 'security.password_changed' as const, title: 'Your password was changed', body: 'Other devices were signed out. If this wasn’t you, contact the site owner.' }
    : { type: 'security.account_locked' as const, title: 'Account temporarily locked', body: 'Too many failed sign-in attempts. Try again later.' }
  try { await createNotification(`v:${visitorId}`, { ...copy, url: '/visitor/dashboard', dedupeKey }) } catch (e) { console.error('[visitor-notify] security failed:', e) }
}
