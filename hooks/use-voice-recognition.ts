'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_RECOGNITION_LANG,
  MSG_UNSUPPORTED,
  SILENCE_TIMEOUT_MS,
  getRecognitionCtor,
  mapRecognitionError,
} from '@/lib/voice/speech-support'

export interface VoiceRecognitionOptions {
  /** BCP-47 language tag. Defaults to en-IN. */
  lang?: string
  /** Stop after this many ms with no speech. */
  silenceMs?: number
  /** Live partial transcript (shown while the user is still speaking). */
  onInterim?: (text: string) => void
  /** A finished transcript and its confidence (0–1, or undefined when the browser doesn't report it). */
  onFinal: (text: string, confidence?: number) => void
  /** A user-facing message. Empty messages are never passed here. */
  onError?: (message: string) => void
}

/**
 * Speech-to-text on top of the browser's SpeechRecognition (Web Speech API). It handles
 * start/stop, live interim text, a silence timeout, error mapping, and unsupported browsers.
 * It never executes anything itself; the caller decides what to do with the transcript.
 */
export function useVoiceRecognition(opts: VoiceRecognitionOptions) {
  // Callbacks are read through a ref, so the hook always calls the latest ones.
  const optsRef = useRef(opts)
  optsRef.current = opts

  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setSupported(!!getRecognitionCtor(typeof window === 'undefined' ? undefined : window))
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      try { recRef.current?.abort?.() } catch {}
    }
  }, [])

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const stop = useCallback(() => {
    clearTimer()
    try { recRef.current?.stop?.() } catch {}
    setListening(false)
  }, [])

  const armTimer = () => {
    clearTimer()
    timerRef.current = setTimeout(() => {
      optsRef.current.onError?.("I didn't hear anything. Tap the mic and try again.")
      stop()
    }, optsRef.current.silenceMs ?? SILENCE_TIMEOUT_MS)
  }

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor(typeof window === 'undefined' ? undefined : window)
    if (!Ctor) {
      optsRef.current.onError?.(MSG_UNSUPPORTED)
      return
    }
    try { recRef.current?.abort?.() } catch {}

    const rec = new Ctor()
    rec.lang = optsRef.current.lang ?? DEFAULT_RECOGNITION_LANG
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    recRef.current = rec

    rec.onstart = () => { setListening(true); armTimer() }
    rec.onresult = (event: any) => {
      armTimer()
      let interim = ''
      let finalText = ''
      let confidence: number | undefined
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        if (r.isFinal) {
          finalText += r[0].transcript
          confidence = r[0].confidence
        } else {
          interim += r[0].transcript
        }
      }
      if (interim) optsRef.current.onInterim?.(interim)
      if (finalText.trim()) {
        clearTimer()
        optsRef.current.onFinal(finalText.trim(), confidence)
      }
    }
    rec.onerror = (e: any) => {
      clearTimer()
      const info = mapRecognitionError(e?.error)
      if (info.message) optsRef.current.onError?.(info.message)
      setListening(false)
    }
    rec.onend = () => { clearTimer(); setListening(false) }

    try {
      rec.start()
    } catch {
      optsRef.current.onError?.("Voice input couldn't start. Please try again or type your message.")
      setListening(false)
    }
  }, [])

  const toggle = useCallback(() => {
    if (listening) stop()
    else start()
  }, [listening, start, stop])

  return { supported, listening, start, stop, toggle }
}
