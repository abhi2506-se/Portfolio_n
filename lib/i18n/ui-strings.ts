/**
 * "English-as-key" UI strings. Any hard-coded English label in the app is wrapped with <Tx>…</Tx> / tx('…');
 * its translation is looked up by a hash of the normalized English text in a per-language table (ui_string_translations).
 * Missing → the English text is shown, so nothing can ever break or go blank.
 * Pure + isomorphic (used by the client runtime, the server layout and the codemod).
 */
export function normalizeUi(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 32-bit FNV-1a → 8 hex chars. Collisions are astronomically unlikely at this scale and merely show another label's text. */
export function uiHash(text: string): string {
  const s = normalizeUi(text)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

export type UiMap = Record<string, string>

export function lookupUi(map: UiMap | undefined, text: string): string {
  if (!map) return text
  const hit = map[uiHash(text)]
  return hit ? hit : text
}
