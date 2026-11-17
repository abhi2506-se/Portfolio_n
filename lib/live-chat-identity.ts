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
