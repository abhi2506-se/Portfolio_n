/**
 * Voice Phase 4 — permission rules (pure, no I/O).
 * A visitor has no voice permissions until an admin grants them. Every check happens on the server.
 */
export const PERMISSION_KEYS = ['nav', 'portfolio', 'projects', 'skills', 'live_chat', 'contact'] as const
export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export interface PermissionRow {
  permissions: string
  expiresAt: number | null
  revokedAt: number | null
}

export type PermissionDecision =
  | { allowed: true }
  | { allowed: false; reason: 'no-grant' | 'revoked' | 'expired' | 'not-in-grant' }

export function parsePermissions(csv: string): PermissionKey[] {
  const known = new Set<string>(PERMISSION_KEYS)
  return Array.from(new Set((csv || '').split(',').map(s => s.trim()).filter(s => known.has(s)))) as PermissionKey[]
}

/** Validates an admin-supplied permission list. Unknown keys are rejected, not ignored. */
export function validatePermissionList(input: unknown): { ok: true; keys: PermissionKey[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'Permissions must be a list.' }
  const known = new Set<string>(PERMISSION_KEYS)
  for (const k of input) if (typeof k !== 'string' || !known.has(k)) return { ok: false, error: `Unknown permission: ${String(k)}` }
  return { ok: true, keys: Array.from(new Set(input as PermissionKey[])) }
}

export function evaluatePermission(row: PermissionRow | null, key: PermissionKey, now: number): PermissionDecision {
  if (!row) return { allowed: false, reason: 'no-grant' }
  if (row.revokedAt) return { allowed: false, reason: 'revoked' }
  if (row.expiresAt !== null && now >= row.expiresAt) return { allowed: false, reason: 'expired' }
  if (!parsePermissions(row.permissions).includes(key)) return { allowed: false, reason: 'not-in-grant' }
  return { allowed: true }
}
