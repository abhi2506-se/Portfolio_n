/** Language preference stored per signed-in visitor (so it follows them across devices). Table auto-created. */
import { lazySql } from '@/lib/neon-lazy'
import { isLocale, type Locale } from './config'

const sql: any = lazySql
let ready: Promise<void> | null = null
function ensure() {
  if (!ready) ready = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS user_language_prefs (
      recipient_key TEXT PRIMARY KEY, locale TEXT NOT NULL, updated_at BIGINT NOT NULL)`
  })().catch(e => { ready = null; throw e })
  return ready
}

export async function getLanguagePref(key: string): Promise<{ locale: Locale; updatedAt: number } | null> {
  await ensure()
  const r = (await sql`SELECT locale, updated_at FROM user_language_prefs WHERE recipient_key = ${key}`)[0]
  return r && isLocale(r.locale) ? { locale: r.locale, updatedAt: Number(r.updated_at) } : null
}

export async function setLanguagePref(key: string, locale: Locale, at = Date.now()) {
  await ensure()
  await sql`INSERT INTO user_language_prefs (recipient_key, locale, updated_at) VALUES (${key}, ${locale}, ${at})
            ON CONFLICT (recipient_key) DO UPDATE SET locale = EXCLUDED.locale, updated_at = EXCLUDED.updated_at`
}
