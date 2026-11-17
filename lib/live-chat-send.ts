/**
 * Live Chat — reliable, idempotent message submission (client side).
 *
 * Why this exists
 * ───────────────
 * The server already de-duplicates on (chat_id, client_id), so re-sending the
 * SAME payload is always safe: if the first attempt was saved but its
 * response was lost (timeout, dropped connection, cold start), the retry just
 * returns the stored row. The old UI treated every failed/slow response as
 * "failed", and its "Send again" re-typed the text under a NEW client_id —
 * which is how an already-saved message showed an error and could then be
 * sent twice.
 *
 * Rules implemented here:
 *   • every attempt re-sends the identical payload (same clientId);
 *   • transient failures (network error, timeout, 408/425/429/5xx) are retried
 *     automatically with backoff;
 *   • definitive refusals (400/401/403/404/409, blocked chat…) are NOT retried
 *     — they are real failures;
 *   • when the browser is offline we don't burn attempts: we report a
 *     retryable failure and the caller resumes on the `online` event.
 */

export interface SendResult {
  ok: boolean
  /** The persisted message row, when the server returned it. */
  message?: any
  /** HTTP status of the last attempt, when there was a response. */
  status?: number
  /** True if trying again later could succeed (offline, timeout, 5xx…). */
  retryable: boolean
  /** The device/chat is blocked by the reply timer. */
  blocked?: boolean
  /** The visitor's login session ended — they must sign in again (retrying can't help). */
  sessionExpired?: boolean
  /** Why it failed, for logs only — never shown to visitors verbatim. */
  reason?: 'offline' | 'timeout' | 'network' | 'server' | 'rejected' | 'bad-response' | 'session-expired'
  attempts: number
}

export interface SendOptions {
  url?: string
  /** Extra fetch init (e.g. credentials: 'include' for the admin panel). */
  init?: RequestInit
  /** Per-attempt timeout. Default 15 s. */
  timeoutMs?: number
  /** Wait before attempt 2, 3, …  Default [800, 2500]  → up to 3 attempts. */
  delaysMs?: number[]
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  isOnline?: () => boolean
}

const RETRYABLE_STATUS = new Set([408, 425, 429])
const isRetryableStatus = (s: number) => s >= 500 || RETRYABLE_STATUS.has(s)

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const defaultIsOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false)

export async function sendWithRetry(payload: Record<string, unknown>, opts: SendOptions = {}): Promise<SendResult> {
  const {
    url = '/api/live-chat',
    init = {},
    timeoutMs = 15_000,
    delaysMs = [800, 2500],
    fetchImpl = (...a: Parameters<typeof fetch>) => fetch(...a),
    sleep = defaultSleep,
    isOnline = defaultIsOnline,
  } = opts

  const body = JSON.stringify(payload) // identical bytes (same clientId) on every attempt
  const maxAttempts = delaysMs.length + 1
  let last: Omit<SendResult, 'attempts'> = { ok: false, retryable: true, reason: 'network' }
  let attempts = 0

  for (let i = 0; i < maxAttempts; i++) {
    if (i > 0) await sleep(delaysMs[i - 1])
    if (!isOnline()) return { ok: false, retryable: true, reason: 'offline', attempts }

    attempts++
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    try {
      const res = await fetchImpl(url, {
        ...init,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
        body,
        signal: ctrl.signal,
      })
      const data = await res.json().catch(() => null)

      if (res.ok) {
        if (data && data.message) return { ok: true, message: data.message, status: res.status, retryable: false, attempts }
        // 2xx but no usable body: the save probably happened, we just can't
        // see the row. Re-sending is safe (idempotent) and returns it.
        last = { ok: false, status: res.status, retryable: true, reason: 'bad-response' }
        continue
      }

      const retryable = isRetryableStatus(res.status)
      last = { ok: false, status: res.status, retryable, blocked: !!data?.blocked, sessionExpired: data?.code === 'session_expired', reason: data?.code === 'session_expired' ? 'session-expired' : retryable ? 'server' : 'rejected' }
      if (!retryable) return { ...last, attempts }
    } catch (err: any) {
      last = { ok: false, retryable: true, reason: err?.name === 'AbortError' ? 'timeout' : 'network' }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ...last, attempts }
}
