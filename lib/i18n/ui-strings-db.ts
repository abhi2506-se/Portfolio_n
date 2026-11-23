import { lazySql } from '@/lib/neon-lazy'
import { DEFAULT_LOCALE, isLocale, type Locale } from './config'
import { normalizeUi, uiHash, type UiMap } from './ui-strings'
import manifest from './ui-manifest.json'
import seedHi from './ui-seed/hi.json'
import seedDe from './ui-seed/de.json'
import seedFr from './ui-seed/fr.json'
import seedEs from './ui-seed/es.json'

/** Built-in translations shipped with the code (work with no API key and no DB rows). DB rows (admin edits / AI) override them. */
const SEED: Record<string, UiMap> = { hi: seedHi, de: seedDe, fr: seedFr, es: seedEs }
export const seedFor = (l: string): UiMap => SEED[l] || {}

const sql: any = lazySql
let schema: Promise<void> | null = null

export function ensureUiSchema(): Promise<void> {
  if (!schema) schema = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS ui_string_translations (
      locale TEXT NOT NULL, hash TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL,
      updated_by TEXT, updated_at BIGINT NOT NULL, PRIMARY KEY (locale, hash))`
  })().catch(e => { schema = null; throw e })
  return schema
}

export const manifestStrings = (): string[] => (manifest as string[])

const cache = new Map<string, { at: number; map: UiMap }>()
export const clearUiCache = () => cache.clear()

/** hash → translated text for one language (30s in-memory cache). Never throws: on any DB problem the site simply stays English. */
export async function getUiStrings(locale: Locale, maxAgeMs = 30_000): Promise<UiMap> {
  if (locale === DEFAULT_LOCALE || !isLocale(locale)) return {}
  const hit = cache.get(locale)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.map
  try {
    await ensureUiSchema()
    const rows: any[] = await sql`SELECT hash, text FROM ui_string_translations WHERE locale = ${locale}`
    const map: UiMap = { ...seedFor(locale) }
    for (const r of rows) map[r.hash] = r.text
    cache.set(locale, { at: Date.now(), map })
    return map
  } catch (e) {
    console.error('[i18n] getUiStrings failed (showing English):', e)
    return hit?.map ?? { ...seedFor(locale) }
  }
}

export async function saveUiStrings(locale: Locale, pairs: Array<{ source: string; text: string }>, by: string) {
  await ensureUiSchema()
  const now = Date.now()
  for (const p of pairs) {
    const source = normalizeUi(p.source); const text = String(p.text ?? '').trim().slice(0, 2000)
    if (!source || !text) continue
    await sql`INSERT INTO ui_string_translations (locale, hash, source, text, updated_by, updated_at)
              VALUES (${locale}, ${uiHash(source)}, ${source}, ${text}, ${by}, ${now})
              ON CONFLICT (locale, hash) DO UPDATE SET source = EXCLUDED.source, text = EXCLUDED.text, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`
  }
  cache.delete(locale)
}

/** Manifest strings that have no translation yet for this language. */
export async function missingUiStrings(locale: Locale): Promise<string[]> {
  const have = await getUiStrings(locale, 0)
  return manifestStrings().filter(s => !have[uiHash(s)])
}

export async function uiCoverage(locale: Locale) {
  const total = manifestStrings().length
  const missing = (await missingUiStrings(locale)).length
  return { total, translated: total - missing, percent: total ? Math.round(((total - missing) / total) * 100) : 100 }
}
