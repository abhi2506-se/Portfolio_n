import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, verifyToken } from '@/lib/admin-auth'

/** The signed-in MAIN admin's username, or null. (Co-admins have a separate session and are intentionally not accepted here.) */
export function adminFromRequest(req: NextRequest): string | null {
  const c = req.cookies.get(SESSION_COOKIE)?.value
  try {
    if (!c || !verifyToken(c)) return null
    const payload = JSON.parse(Buffer.from(c.split('.')[0], 'base64').toString())
    return typeof payload.username === 'string' ? payload.username : 'admin'
  } catch { return null }
}
