/**
 * lib/smtp.ts
 * ─────────────────────────────────────────────────────────────────────────
 * Single place that turns the SMTP_* environment variables into a Nodemailer
 * transport, for the Cloudflare Workers (OpenNext) runtime.
 *
 * Environment variables (all read from process.env at REQUEST time — OpenNext
 * copies every string binding/secret of the Worker into process.env on the
 * first request, see node_modules/@opennextjs/cloudflare/dist/cli/templates/init.js):
 *
 *   SMTP_HOST    default smtp.titan.email
 *   SMTP_PORT    default 465            (465 = implicit SSL/TLS, 587 = STARTTLS)
 *   SMTP_SECURE  optional; see "TLS mode" below
 *   SMTP_USER    FULL mailbox address, e.g. no-reply@yourdomain.com   (secret)
 *   SMTP_PASS    mailbox password                                      (secret)
 *
 * TLS mode (derived from the port so the two can never disagree):
 *   port 465  → secure: true            (implicit SSL). Forced even if SMTP_SECURE=false.
 *   port 587  → secure: false + requireTLS: true (STARTTLS). Forced even if SMTP_SECURE=true.
 *   other     → secure follows SMTP_SECURE (default false).
 *
 * Nothing in this file ever logs the password, the full username, OTPs or
 * the raw SMTP conversation. Do NOT enable nodemailer's `debug`/`logger`
 * options: they print the base64 AUTH line, which is the credential.
 */
import nodemailer from 'nodemailer'
import type { SendMailOptions, SentMessageInfo } from 'nodemailer'

export const DEFAULT_SMTP_HOST = 'smtp.titan.email'
export const DEFAULT_SMTP_PORT = 465

type Env = Record<string, string | undefined>

export interface ResolvedSmtpConfig {
  host: string
  hostSource: 'env' | 'default'
  port: number
  portSource: 'env' | 'default' | 'invalid-env-using-default'
  secure: boolean
  requireTLS: boolean
  mode: 'ssl' | 'starttls' | 'plain'
  user: string
  pass: string
  /** Human-readable problems found while resolving the config. Never contain secrets. */
  warnings: string[]
  /** Safe-to-log facts about the credentials (booleans / masked only). */
  flags: {
    userPresent: boolean
    passPresent: boolean
    userLooksLikeEmail: boolean
    userMasked: string
    userDomain: string
    passHadSurroundingWhitespace: boolean
    passHasSurroundingQuotes: boolean
    passLooksLikeGmailAppPassword: boolean
    userHadSurroundingWhitespace: boolean
  }
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v == null) return undefined
  const s = v.trim().toLowerCase()
  if (['true', '1', 'yes', 'ssl', 'tls'].includes(s)) return true
  if (['false', '0', 'no', 'starttls'].includes(s)) return false
  return undefined
}

function maskUser(user: string): string {
  const at = user.indexOf('@')
  if (at < 1) return user ? '***' : ''
  return `${user[0]}***${user.slice(at)}`
}

/** Pure function (takes env as a parameter) so it can be unit-tested. */
export function resolveSmtpConfig(env: Env = process.env): ResolvedSmtpConfig {
  const warnings: string[] = []

  // ── host ──
  const hostRaw = (env.SMTP_HOST ?? '').trim()
  const host = hostRaw || DEFAULT_SMTP_HOST
  const hostSource: ResolvedSmtpConfig['hostSource'] = hostRaw ? 'env' : 'default'
  if (!hostRaw) warnings.push(`SMTP_HOST is not set; using default ${DEFAULT_SMTP_HOST}.`)

  // ── port ──
  const portRaw = (env.SMTP_PORT ?? '').trim()
  let port = DEFAULT_SMTP_PORT
  let portSource: ResolvedSmtpConfig['portSource'] = 'default'
  if (portRaw) {
    const n = Number(portRaw)
    if (Number.isInteger(n) && n > 0 && n < 65536) {
      port = n
      portSource = 'env'
    } else {
      portSource = 'invalid-env-using-default'
      warnings.push(`SMTP_PORT is not a valid port number; using default ${DEFAULT_SMTP_PORT}.`)
    }
  } else {
    warnings.push(`SMTP_PORT is not set; using default ${DEFAULT_SMTP_PORT}.`)
  }

  // ── TLS mode ──
  const secureEnv = parseBool(env.SMTP_SECURE)
  if (env.SMTP_SECURE && secureEnv === undefined) {
    warnings.push('SMTP_SECURE has an unrecognised value (use true or false); ignoring it.')
  }
  let secure: boolean
  let requireTLS = false
  let mode: ResolvedSmtpConfig['mode']
  if (port === 465) {
    secure = true
    mode = 'ssl'
    if (secureEnv === false) warnings.push('Port 465 requires implicit SSL; SMTP_SECURE=false was overridden to secure=true.')
  } else if (port === 587) {
    secure = false
    requireTLS = true
    mode = 'starttls'
    if (secureEnv === true) warnings.push('Port 587 uses STARTTLS, not implicit SSL; SMTP_SECURE=true was overridden to secure=false + requireTLS.')
  } else {
    secure = secureEnv ?? false
    mode = secure ? 'ssl' : 'plain'
  }

  // ── credentials ──
  const userRaw = env.SMTP_USER ?? ''
  const passRaw = env.SMTP_PASS ?? ''
  const user = userRaw.trim()
  const pass = passRaw.trim()
  const passHadSurroundingWhitespace = passRaw !== pass
  const userHadSurroundingWhitespace = userRaw !== user
  const passHasSurroundingQuotes = /^(['"]).*\1$/.test(pass) && pass.length >= 2
  // Gmail app passwords are 16 lowercase letters, usually pasted as "abcd efgh ijkl mnop".
  const passLooksLikeGmailAppPassword = /^[a-z]{4}( [a-z]{4}){3}$/.test(pass) || /^[a-z]{16}$/.test(pass)
  const userLooksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)

  if (!user) warnings.push('SMTP_USER is missing or empty.')
  else if (!userLooksLikeEmail) warnings.push('SMTP_USER is not a full e-mail address. Titan requires the complete mailbox address (name@yourdomain.com).')
  if (userHadSurroundingWhitespace) warnings.push('SMTP_USER had leading/trailing whitespace (trimmed). Re-enter it in the dashboard.')
  if (!pass) warnings.push('SMTP_PASS is missing or empty.')
  if (passHadSurroundingWhitespace) warnings.push('SMTP_PASS had leading/trailing whitespace or a newline (trimmed). Re-enter it in the dashboard.')
  if (passHasSurroundingQuotes) warnings.push('SMTP_PASS starts and ends with quote characters. Dashboard values must NOT be quoted; if the quotes are not part of the password this is the cause of 535.')
  if (passLooksLikeGmailAppPassword) warnings.push('SMTP_PASS looks like a Gmail App Password (16 letters). Titan needs the Titan mailbox password instead.')
  if (/gmail\.com$/i.test(host) || /@(gmail|googlemail)\.com$/i.test(user)) {
    warnings.push('SMTP host/user look like Gmail while Titan is the intended provider (stale Gmail configuration?).')
  }

  return {
    host, hostSource, port, portSource, secure, requireTLS, mode,
    user, pass, warnings,
    flags: {
      userPresent: !!user,
      passPresent: !!pass,
      userLooksLikeEmail,
      userMasked: maskUser(user),
      userDomain: user.includes('@') ? user.split('@').pop()! : '',
      passHadSurroundingWhitespace,
      passHasSurroundingQuotes,
      passLooksLikeGmailAppPassword,
      userHadSurroundingWhitespace,
    },
  }
}

export const smtpConfigured = (env: Env = process.env): boolean => {
  const c = resolveSmtpConfig(env)
  return !!(c.user && c.pass)
}

const addrOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase()

/**
 * Safe, secret-free snapshot of the SMTP configuration, for logs.
 * Never includes SMTP_PASS, the full SMTP_USER, OTPs, tokens or auth strings.
 */
export function getSmtpDiagnostics(context: string, from?: string, env: Env = process.env) {
  const c = resolveSmtpConfig(env)
  const present = (k: string) => (env[k] && String(env[k]).trim() ? 'present' : 'MISSING')
  const warnings = [...c.warnings]
  let fromMatchesUser: boolean | null = null
  if (from) {
    fromMatchesUser = !!c.user && addrOf(from) === c.user.toLowerCase()
    if (!fromMatchesUser) {
      warnings.push(
        `Sender (${addrOf(from)}) differs from the authenticated mailbox (${c.flags.userMasked || 'unset'}). ` +
        'Titan only accepts this if the sender is an alias of that mailbox; otherwise it answers 550/553 after login.'
      )
    }
  }
  return {
    context,
    runtime: typeof (globalThis as any).WebSocketPair !== 'undefined' ? 'cloudflare-workers' : 'node',
    vars: {
      SMTP_HOST: present('SMTP_HOST'),
      SMTP_PORT: present('SMTP_PORT'),
      SMTP_SECURE: present('SMTP_SECURE'),
      SMTP_USER: present('SMTP_USER'),
      SMTP_PASS: present('SMTP_PASS'),
    },
    host: c.host,
    hostSource: c.hostSource,
    port: c.port,
    portSource: c.portSource,
    secure: c.secure,
    requireTLS: c.requireTLS,
    mode: c.mode,
    user: c.flags.userMasked,
    userLooksLikeEmail: c.flags.userLooksLikeEmail,
    passHadSurroundingWhitespace: c.flags.passHadSurroundingWhitespace,
    passHasSurroundingQuotes: c.flags.passHasSurroundingQuotes,
    passLooksLikeGmailAppPassword: c.flags.passLooksLikeGmailAppPassword,
    fromMatchesUser,
    warnings,
  }
}

const loggedContexts = new Set<string>()

/** Logs the diagnostics once per isolate per context (avoids log spam). */
export function logSmtpDiagnosticsOnce(context: string, from?: string) {
  if (loggedContexts.has(context)) return
  loggedContexts.add(context)
  console.log('[smtp-diag]', JSON.stringify(getSmtpDiagnostics(context, from)))
}

/** Strips anything credential-shaped from an error message before it reaches the logs. */
function scrub(text: string, c: ResolvedSmtpConfig): string {
  let out = text
  for (const secret of [c.pass, c.user]) {
    if (secret && secret.length >= 3) out = out.split(secret).join('***')
  }
  return out.slice(0, 300)
}

/** Actionable, secret-free explanation of an SMTP failure (server logs only). */
export function explainSmtpError(err: unknown, from?: string, env: Env = process.env): string {
  const e = err as any
  const c = resolveSmtpConfig(env)
  const code: string | undefined = e?.code
  const rc: number | undefined = e?.responseCode
  if (code === 'EAUTH' || rc === 535 || /535|authentication failed|invalid login/i.test(String(e?.message))) {
    return `SMTP login rejected (535) by ${c.host}:${c.port}. The connection and ${c.mode === 'plain' ? 'handshake' : 'TLS handshake'} succeeded, so host/port/mode are reachable; the server refused the SMTP_USER/SMTP_PASS pair. ` +
      'Check that SMTP_USER is the full mailbox address, SMTP_PASS is that mailbox\'s current password with no quotes/spaces/newline, and that SMTP/IMAP access is enabled for the mailbox in Titan.'
  }
  if (rc === 550 || rc === 553 || rc === 554 || code === 'EENVELOPE') {
    return `Sender/recipient refused (${rc ?? code}). From address ${from ? addrOf(from) : '?'} must be the authenticated mailbox (${c.flags.userMasked}) or one of its aliases.`
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'EDNS') {
    return `Cannot reach ${c.host}:${c.port} (${code}). Check SMTP_HOST / SMTP_PORT and that the port matches the TLS mode (${c.mode}).`
  }
  if (/wrong version number|packet length too long|unknown protocol/i.test(String(e?.message))) {
    return `TLS mode mismatch talking to ${c.host}:${c.port} (resolved mode: ${c.mode}). Use port 465 with SSL or 587 with STARTTLS.`
  }
  return scrub(String(e?.message || err), c)
}

/** Logs a failed send with enough detail to debug and nothing secret. */
export function logSmtpFailure(context: string, err: unknown, from?: string, env: Env = process.env) {
  const e = err as any
  const c = resolveSmtpConfig(env)
  console.error('[smtp-error]', JSON.stringify({
    context,
    code: e?.code ?? null,
    responseCode: e?.responseCode ?? null,
    command: e?.command ?? null,
    serverResponse: scrub(String(e?.response ?? ''), c),
    explanation: explainSmtpError(err, from, env),
    config: getSmtpDiagnostics(context, from, env),
  }))
}

/**
 * Returns an object with `sendMail`, a drop-in for a Nodemailer transporter.
 * The real transport is created lazily on the first send, so env vars are read
 * at request time (never at module-evaluation/build time). On any failure the
 * ORIGINAL error is re-thrown unchanged so existing callers keep their behaviour.
 */
export function createSmtpTransport(context: string): { sendMail: (options: SendMailOptions) => Promise<SentMessageInfo> } {
  let transport: ReturnType<typeof nodemailer.createTransport> | null = null
  return {
    async sendMail(options: SendMailOptions) {
      const from = typeof options.from === 'string' ? options.from : (options.from as any)?.address
      logSmtpDiagnosticsOnce(context, from)
      if (!transport) {
        const c = resolveSmtpConfig()
        transport = nodemailer.createTransport({
          host: c.host,
          port: c.port,
          secure: c.secure,
          requireTLS: c.requireTLS,
          auth: c.user && c.pass ? { user: c.user, pass: c.pass } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      }
      try {
        return await transport.sendMail(options)
      } catch (err) {
        logSmtpFailure(context, err, from)
        throw err
      }
    },
  }
}
