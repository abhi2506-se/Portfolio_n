/**
 * Voice Phase 2 — browser speech support helpers (pure where possible).
 */

/** Stop listening after this long with no speech. */
export const SILENCE_TIMEOUT_MS = 8000

/** Default recognition language. en-IN handles English and most Hinglish sentences. */
export const DEFAULT_RECOGNITION_LANG = 'en-IN'

/** Returns the constructor the browser provides, or null when speech recognition isn't supported. */
export function getRecognitionCtor(win: any): (new () => any) | null {
  if (!win) return null
  return win.SpeechRecognition || win.webkitSpeechRecognition || null
}

export interface RecognitionErrorInfo {
  /** Message to show the visitor. Empty string means "show nothing". */
  message: string
  /** True when trying again might work without changing anything. */
  retryable: boolean
}

/** Maps the browser's SpeechRecognition error codes to friendly messages. */
export function mapRecognitionError(code: string | undefined): RecognitionErrorInfo {
  switch (code) {
    case 'aborted':
      return { message: '', retryable: true }
    case 'no-speech':
      return { message: "I didn't hear anything. Tap the mic and try again.", retryable: true }
    case 'audio-capture':
      return { message: 'No microphone was found. Check your device, or type your message.', retryable: false }
    case 'not-allowed':
    case 'service-not-allowed':
      return { message: 'Microphone access is blocked. Allow it in your browser settings, or type your message.', retryable: false }
    case 'network':
      return { message: 'Speech service is unavailable right now. Please type your message.', retryable: true }
    case 'language-not-supported':
      return { message: 'Voice input for this language is not supported here. Please type your message.', retryable: false }
    default:
      return { message: "Voice input stopped unexpectedly. Please try again or type your message.", retryable: true }
  }
}

export const MSG_REPEAT = "I couldn't understand that. Please repeat."
export const MSG_UNSUPPORTED = 'Voice input is not supported in this browser. Please type your message.'
