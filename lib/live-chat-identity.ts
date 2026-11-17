/**
 * Live Chat — server-verified identity.
 *
 * Who is chatting is decided ONLY here, on the server, from the existing
 * visitor session cookie (lib/visitor/auth.ts → getAuthedVisitor). The browser
 * never supplies a visitor id; any name/email/phone it sends for a signed-in
 * visitor is ignored.
 *
 * Access rule (ownsChat):
 *   • chat created by a signed-in visitor (live_chats.visitor_id set)
 *       → reachable ONLY while that same visitor has a valid session.
 *         After logout / expiry / revocation the device cookie alone is not enough,
 *         so the previous user's conversation cannot be opened by the next person
 *         on the same browser, and two accounts are never merged.
 *   • guest chat (no visitor_id) → unchanged: the signed device cookie owns it.
 */
import type { NextRequest } from 'next/server'
import { getAuthedVisitor } from '@/lib/visitor/auth'
import { VISITOR_COOKIE } from '@/lib/visitor/config'
import { sql as visitorSql } from '@/lib/visitor/db'

export interface ChatVisitor {
  visitorId: string
  fullName: string
  email: string
  mobile: string
}

/** Cheap for guests: with no visitor cookie there is no database query at all. */
export async function getVisitorForChat(req: NextRequest): Promise<ChatVisitor | null> {
  if (!req.cookies.get(VISITOR_COOKIE)?.value) return null
  try {
    const v = await getAuthedVisitor(req)
    // Chat activity counts as session activity. Before, only the visitor dashboard sent heartbeats,
    // so someone sitting in the chat (or browsing the main site) was "idle" after 30 min, their
    // session died, and every message after that came back 403 → "Send again" forever.
    // Throttled to one write a minute per session. Never allowed to break chat.
    if (v && Date.now() - new Date(v.sessionLastActiveAt).getTime() > 60_000) {
      try { await visitorSql`UPDATE visitor_sessions_auth SET last_active_at = now() WHERE id = ${v.sessionId}` } catch {}
    }
    return v ? { visitorId: v.visitorId, fullName: v.fullName, email: v.email, mobile: v.mobile } : null
  } catch (err) {
    // If the visitor tables are unavailable, chat must keep working as a guest chat.
    console.error('[live-chat] visitor session lookup failed:', err)
    return null
  }
}

interface OwnedRow { device_id?: string | null; visitor_id?: string | null }

/**
 * @param strict  true  → a chat with no recorded device is NOT accessible (used by write actions);
 *                false → legacy behaviour where an unowned guest chat is open.
 */
export function ownsChat(row: OwnedRow | null | undefined, deviceId: string, visitorId: string | null, strict = false): boolean {
  if (!row) return false
  if (row.visitor_id) return !!visitorId && row.visitor_id === visitorId
  if (strict) return !!row.device_id && row.device_id === deviceId
  return !row.device_id || row.device_id === deviceId
}

/**
 * Why access to a chat was refused. A chat that belongs to a signed-in visitor becomes unreachable when
 * that visitor's login session has ended (expired / signed out). That is NOT a permanent "forbidden":
 * the visitor just has to sign in again, so it gets its own code the widget can act on.
 */
export function chatAccessDenied(row: OwnedRow | null | undefined, visitorId: string | null): { status: 401 | 403; code: 'session_expired' | 'forbidden'; error: string } {
  if (row?.visitor_id && !visitorId) {
    return { status: 401, code: 'session_expired', error: 'Your sign-in session has expired. Please sign in again to continue this chat.' }
  }
  return { status: 403, code: 'forbidden', error: 'Unauthorized' }
}
