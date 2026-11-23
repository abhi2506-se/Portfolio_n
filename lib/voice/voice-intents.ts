/**
 * Voice Phase 2 — pure transcript classification (no browser APIs, fully unit-testable).
 *
 * Phase 2 never EXECUTES anything from voice. It only decides what a transcript means so the
 * UI can (a) ask the user to repeat unclear speech, (b) handle yes/no/stop/help locally, and
 * (c) put a clear transcript into the normal input for the user to review and send.
 * Executable commands come later through the server-side command registry (Phase 3).
 */

export type VoiceUtteranceKind =
  | 'confirm_yes'
  | 'confirm_no'
  | 'stop_listening'
  | 'repeat'
  | 'help'
  | 'text'      // a meaningful sentence: goes to the input for review, never auto-sent
  | 'unclear'   // empty, too short, or only punctuation: ask the user to repeat

export interface VoiceClassification {
  kind: VoiceUtteranceKind
  normalized: string
}

/** Minimum browser confidence (0–1) for a final result to be trusted. Missing confidence is allowed. */
export const MIN_CONFIDENCE = 0.45

// Hindi / Hinglish words mapped to the English form. Matched on whole words only.
const HINGLISH: Record<string, string> = {
  haan: 'yes', ha: 'yes', ji: 'yes', theek: 'ok', thik: 'ok',
  nahi: 'no', nahin: 'no', mat: 'not', band: 'stop', ruko: 'stop',
  dobara: 'again', phir: 'again', bolo: 'say', kholo: 'open', dikhao: 'show',
  madad: 'help',
}

/** Lowercases, strips punctuation, collapses spaces, and maps Hinglish words to English. */
export function normalizeTranscript(raw: string): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  return cleaned
    .split(' ')
    .map(w => HINGLISH[w] ?? w)
    .join(' ')
}

const YES = new Set(['yes', 'ok', 'confirm', 'do it', 'go ahead', 'proceed', 'sure'])
const NO = new Set(['no', 'cancel', 'not', 'leave it', 'dont', 'do not', 'never mind'])
const STOP = new Set(['stop', 'stop listening', 'stop voice', 'quit'])
const REPEAT = new Set(['repeat', 'again', 'say again', 'say it again', 'pardon'])

/**
 * Decides what a transcript means. Whole-phrase matches only, so "no" inside "know" or
 * "ok" inside "cook" doesn't count.
 */
export function classifyUtterance(raw: string): VoiceClassification {
  const normalized = normalizeTranscript(raw)
  // Needs at least one real word (2+ letters/digits).
  if (!normalized || !/[\p{L}\p{N}]{2,}/u.test(normalized)) {
    return { kind: 'unclear', normalized }
  }
  if (YES.has(normalized)) return { kind: 'confirm_yes', normalized }
  if (NO.has(normalized)) return { kind: 'confirm_no', normalized }
  if (STOP.has(normalized)) return { kind: 'stop_listening', normalized }
  if (REPEAT.has(normalized)) return { kind: 'repeat', normalized }
  if (/(^| )(help|what can you do|commands)( |$)/.test(normalized)) return { kind: 'help', normalized }
  return { kind: 'text', normalized }
}

/** True when a final result is trustworthy enough to use. A missing confidence is accepted. */
export function isConfidentEnough(confidence: number | undefined | null): boolean {
  if (confidence === undefined || confidence === null || Number.isNaN(confidence)) return true
  return confidence >= MIN_CONFIDENCE
}
