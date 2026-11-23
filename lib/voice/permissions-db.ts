/** SERVER ONLY. Voice permission storage. Needs voice-permissions.sql applied (see the migration file). */
import { lazySql as sql } from '@/lib/neon-lazy'
import type { PermissionRow } from './permissions'

/** Postgres "undefined_table" — the migration hasn't been applied yet. */
export function isMissingTable(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as any).code === '42P01'
}

export async function getChatPermissionRow(chatId: string): Promise<PermissionRow | null> {
  const rows = (await sql`SELECT permissions, expires_at, revoked_at FROM voice_permissions WHERE chat_id = ${chatId}`) as any[]
  const r = rows[0]
  if (!r) return null
  return {
    permissions: String(r.permissions || ''),
    expiresAt: r.expires_at === null ? null : Number(r.expires_at),
    revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
  }
}
