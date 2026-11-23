/**
 * Optional AI-assisted translation (admin only). Suggests; never saves or publishes.
 * Provider is configurable:  TRANSLATION_PROVIDER = anthropic | google | none   (default: first one with a key)
 *   anthropic → ANTHROPIC_API_KEY (+ optional TRANSLATION_MODEL, default claude-sonnet-4-6, same key/model the site's AI features use)
 *   google    → GOOGLE_TRANSLATE_API_KEY (already used by client-portal chat translation)
 * Only public website text is sent. Chat messages are never sent here.
 */
import { localeInfo, type Locale } from './config'

export type ProviderName = 'anthropic' | 'google' | 'none'

export function activeProvider(): ProviderName {
  const want = (process.env.TRANSLATION_PROVIDER || '').toLowerCase()
  if (want === 'none') return 'none'
  if ((want === 'anthropic' || !want) && process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if ((want === 'google' || !want) && process.env.GOOGLE_TRANSLATE_API_KEY) return 'google'
  return 'none'
}

const GLOSSARY_RULE = 'Keep unchanged: brand and company names, product names, programming languages, frameworks, libraries, tools, URLs, e-mail addresses, code, numbers and emoji. Translate naturally and idiomatically for a professional portfolio — not word for word.'

export async function suggestFields(fields: Record<string, string>, target: Locale, opts: { fetchImpl?: typeof fetch } = {}): Promise<Record<string, string>> {
  const provider = activeProvider()
  const f = opts.fetchImpl || fetch
  const lang = localeInfo(target).english
  if (provider === 'none') throw new Error('No translation provider is configured. Manual translation still works.')

  if (provider === 'anthropic') {
    const res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.TRANSLATION_MODEL || 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: `You translate website content from English into ${lang}. ${GLOSSARY_RULE} Reply with ONLY a JSON object with exactly the same keys as the input, values translated.`,
        messages: [{ role: 'user', content: JSON.stringify(fields) }],
      }),
    })
    if (!res.ok) throw new Error(`Translation provider error (${res.status})`)
    const data = await res.json()
    const text: string = data?.content?.[0]?.text || ''
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
    const parsed = JSON.parse(json)
    const out: Record<string, string> = {}
    for (const k of Object.keys(fields)) if (typeof parsed[k] === 'string') out[k] = parsed[k]
    return out
  }

  // google
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) {
    const res = await f(`https://translation.googleapis.com/language/translate/v2?key=${process.env.GOOGLE_TRANSLATE_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: v, source: 'en', target: localeInfo(target).tag, format: 'text' }),
    })
    if (!res.ok) throw new Error(`Translation provider error (${res.status})`)
    out[k] = (await res.json())?.data?.translations?.[0]?.translatedText ?? ''
  }
  return out
}
