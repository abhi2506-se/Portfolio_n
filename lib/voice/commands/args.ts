/**
 * Voice Phase 3 — argument validation (pure). Every command declares its arguments; anything
 * else is rejected, so the frontend can never pass extra or unexpected fields.
 */

export type ArgKind = 'username' | 'name'
export type ArgsSpec = Record<string, ArgKind>

const USERNAME = /^[a-zA-Z0-9_.-]{3,40}$/
const NAME = /^[\p{L} .'-]{2,60}$/u

export function validateArgs(
  spec: ArgsSpec,
  input: unknown,
): { ok: true; args: Record<string, string> } | { ok: false; error: string } {
  if (input === undefined || input === null) input = {}
  if (typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Arguments must be an object.' }
  const obj = input as Record<string, unknown>
  for (const k of Object.keys(obj)) {
    if (!(k in spec)) return { ok: false, error: `Unexpected argument: ${k}` }
  }
  const out: Record<string, string> = {}
  for (const [key, kind] of Object.entries(spec)) {
    const v = obj[key]
    if (typeof v !== 'string') return { ok: false, error: `Missing argument: ${key}` }
    if (kind === 'username' && !USERNAME.test(v)) return { ok: false, error: `Invalid ${key}.` }
    if (kind === 'name' && !NAME.test(v.trim())) return { ok: false, error: `Invalid ${key}.` }
    out[key] = v
  }
  return { ok: true, args: out }
}
