/**
 * Translation storage + workflow.
 *   status (stored):  draft → in_review → published       effective status adds:  missing (no row) · outdated (source changed)
 * Original English content is never touched. Every save/publish writes a version row so changes can be reverted.
 */
import { randomBytes } from 'node:crypto'
import { lazySql } from '@/lib/neon-lazy'
import { LOCALES, isLocale, type Locale } from './config'
import { getCatalog, type ContentItem } from './content-catalog'

const sql: any = lazySql

export type StoredStatus = 'draft' | 'in_review' | 'published'
export type EffectiveStatus = StoredStatus | 'missing' | 'outdated'
export const STORED_STATUSES: StoredStatus[] = ['draft', 'in_review', 'published']

export interface TranslationRow {
  id: string; contentType: string; contentId: string; locale: Locale
  fields: Record<string, string>; status: StoredStatus; sourceHash: string
  updatedBy: string | null; reviewerNote: string | null
  createdAt: number; updatedAt: number; publishedAt: number | null; publishedBy: string | null
}

let ready: Promise<void> | null = null
export function ensureTranslationSchema(): Promise<void> {
  if (!ready) ready = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS content_translations (
      id TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      content_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      fields JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      source_hash TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      reviewer_note TEXT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      published_at BIGINT,
      published_by TEXT,
      UNIQUE (content_type, content_id, locale)
    )`
    await sql`CREATE INDEX IF NOT EXISTS idx_content_tr_locale_status ON content_translations (locale, status)`
    await sql`CREATE TABLE IF NOT EXISTS content_translation_versions (
      id TEXT PRIMARY KEY,
      translation_id TEXT NOT NULL,
      fields JSONB NOT NULL,
      status TEXT NOT NULL,
      source_hash TEXT NOT NULL,
      saved_by TEXT,
      action TEXT NOT NULL,
      saved_at BIGINT NOT NULL
    )`
    await sql`CREATE INDEX IF NOT EXISTS idx_content_tr_versions ON content_translation_versions (translation_id, saved_at DESC)`
    await sql`CREATE TABLE IF NOT EXISTS i18n_locale_settings (locale TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL, updated_at BIGINT NOT NULL)`
  })().catch(e => { ready = null; throw e })
  return ready
}

const uid = (p: string) => `${p}_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`
const toRow = (r: any): TranslationRow => ({
  id: r.id, contentType: r.content_type, contentId: r.content_id, locale: r.locale,
  fields: (r.fields && typeof r.fields === 'object') ? r.fields : {}, status: r.status, sourceHash: r.source_hash,
  updatedBy: r.updated_by, reviewerNote: r.reviewer_note, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  publishedAt: r.published_at == null ? null : Number(r.published_at), publishedBy: r.published_by,
})

export function effectiveStatus(row: TranslationRow | null, item: ContentItem): EffectiveStatus {
  if (!row) return 'missing'
  if (row.sourceHash !== item.hash) return 'outdated'
  return row.status
}

/** Only keep keys that exist in the English source and are non-empty strings (no stray data, bounded size). */
export function sanitizeFields(input: unknown, item: ContentItem): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== 'object') return out
  const maxLen = item.type === 'legal' ? 200_000 : 20_000
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(k in item.fields) || typeof v !== 'string') continue
    const s = v.trim()
    if (s) out[k] = s.slice(0, maxLen)
  }
  return out
}

export async function getTranslation(type: string, id: string, locale: Locale): Promise<TranslationRow | null> {
  await ensureTranslationSchema()
  const r = (await sql`SELECT * FROM content_translations WHERE content_type = ${type} AND content_id = ${id} AND locale = ${locale}`)[0]
  return r ? toRow(r) : null
}

export async function saveTranslation(item: ContentItem, locale: Locale, fields: Record<string, string>, status: 'draft' | 'in_review', by: string, note?: string | null) {
  await ensureTranslationSchema()
  const now = Date.now(), id = uid('tr')
  const rows = await sql`
    INSERT INTO content_translations (id, content_type, content_id, locale, fields, status, source_hash, updated_by, reviewer_note, created_at, updated_at)
    VALUES (${id}, ${item.type}, ${item.id}, ${locale}, ${JSON.stringify(fields)}::jsonb, ${status}, ${item.hash}, ${by}, ${note ?? null}, ${now}, ${now})
    ON CONFLICT (content_type, content_id, locale) DO UPDATE SET
      fields = EXCLUDED.fields, status = EXCLUDED.status, source_hash = EXCLUDED.source_hash,
      updated_by = EXCLUDED.updated_by, reviewer_note = EXCLUDED.reviewer_note, updated_at = EXCLUDED.updated_at,
      published_at = NULL, published_by = NULL
    RETURNING *`
  const row = toRow(rows[0])
  await sql`INSERT INTO content_translation_versions (id, translation_id, fields, status, source_hash, saved_by, action, saved_at)
            VALUES (${uid('tv')}, ${row.id}, ${JSON.stringify(fields)}::jsonb, ${status}, ${item.hash}, ${by}, ${'save_' + status}, ${now})`
  return row
}

/** Publishing freezes the translation against the CURRENT English hash. */
export async function publishTranslation(item: ContentItem, locale: Locale, by: string) {
  await ensureTranslationSchema()
  const cur = await getTranslation(item.type, item.id, locale)
  if (!cur || !Object.keys(cur.fields).length) throw new Error('Nothing to publish')
  const now = Date.now()
  const rows = await sql`UPDATE content_translations SET status = 'published', source_hash = ${item.hash}, published_at = ${now}, published_by = ${by}, updated_at = ${now}
                         WHERE id = ${cur.id} RETURNING *`
  await sql`INSERT INTO content_translation_versions (id, translation_id, fields, status, source_hash, saved_by, action, saved_at)
            VALUES (${uid('tv')}, ${cur.id}, ${JSON.stringify(cur.fields)}::jsonb, 'published', ${item.hash}, ${by}, 'publish', ${now})`
  return toRow(rows[0])
}

/** Back to draft: the website falls back to English for this item until it's published again. */
export async function unpublishTranslation(type: string, id: string, locale: Locale, by: string) {
  await ensureTranslationSchema()
  const cur = await getTranslation(type, id, locale); if (!cur) return null
  const now = Date.now()
  const rows = await sql`UPDATE content_translations SET status = 'draft', published_at = NULL, published_by = NULL, updated_at = ${now}, updated_by = ${by} WHERE id = ${cur.id} RETURNING *`
  await sql`INSERT INTO content_translation_versions (id, translation_id, fields, status, source_hash, saved_by, action, saved_at)
            VALUES (${uid('tv')}, ${cur.id}, ${JSON.stringify(cur.fields)}::jsonb, 'draft', ${cur.sourceHash}, ${by}, 'unpublish', ${now})`
  return toRow(rows[0])
}

export async function listVersions(translationId: string) {
  await ensureTranslationSchema()
  const rows = await sql`SELECT id, status, source_hash, saved_by, action, saved_at FROM content_translation_versions WHERE translation_id = ${translationId} ORDER BY saved_at DESC LIMIT 30`
  return rows.map((r: any) => ({ id: r.id, status: r.status, sourceHash: r.source_hash, savedBy: r.saved_by, action: r.action, savedAt: Number(r.saved_at) }))
}

/** Restores an old version's TEXT as a new draft (never straight to published). */
export async function revertToVersion(item: ContentItem, locale: Locale, versionId: string, by: string) {
  await ensureTranslationSchema()
  const cur = await getTranslation(item.type, item.id, locale); if (!cur) throw new Error('No translation')
  const v = (await sql`SELECT fields FROM content_translation_versions WHERE id = ${versionId} AND translation_id = ${cur.id}`)[0]
  if (!v) throw new Error('Version not found')
  const row = await saveTranslation(item, locale, sanitizeFields(v.fields, item), 'draft', by, `Reverted to version ${versionId}`)
  return row
}

export interface AdminListEntry { type: string; id: string; label: string; status: EffectiveStatus; updatedAt: number | null; updatedBy: string | null; fieldCount: number; translatedCount: number }

export async function listForAdmin(locale: Locale) {
  await ensureTranslationSchema()
  const catalog = await getCatalog(0)
  const raw: any[] = await sql`SELECT * FROM content_translations WHERE locale = ${locale}`
  const rows: TranslationRow[] = raw.map(toRow)
  const byKey = new Map<string, TranslationRow>(rows.map(r => [`${r.contentType}:${r.contentId}`, r]))
  const entries: AdminListEntry[] = catalog.map(item => {
    const row = byKey.get(`${item.type}:${item.id}`) || null
    return {
      type: item.type, id: item.id, label: item.label, status: effectiveStatus(row, item),
      updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null,
      fieldCount: Object.keys(item.fields).length, translatedCount: row ? Object.keys(row.fields).length : 0,
    }
  })
  const published = entries.filter(e => e.status === 'published').length
  return { entries, coverage: { total: entries.length, published, percent: entries.length ? Math.round((published / entries.length) * 100) : 0 } }
}

export async function coverageAll() {
  await ensureTranslationSchema()
  const catalog = await getCatalog(0)
  const rows = (await sql`SELECT content_type, content_id, locale, status, source_hash FROM content_translations`)
  const hashOf = new Map(catalog.map(i => [`${i.type}:${i.id}`, i.hash]))
  const out: Record<string, { published: number; draft: number; inReview: number; outdated: number; missing: number; total: number }> = {}
  for (const l of LOCALES) if (l.code !== 'en') out[l.code] = { published: 0, draft: 0, inReview: 0, outdated: 0, missing: catalog.length, total: catalog.length }
  for (const r of rows) {
    const h = hashOf.get(`${r.content_type}:${r.content_id}`); const o = out[r.locale]
    if (!o || h === undefined) continue
    o.missing--
    if (r.source_hash !== h) o.outdated++
    else if (r.status === 'published') o.published++
    else if (r.status === 'in_review') o.inReview++
    else o.draft++
  }
  return out
}

/** What the public site may show: published AND still matching the current English text. Everything else falls back to English. */
export async function getPublishedMap(locale: Locale): Promise<Record<string, Record<string, string>>> {
  await ensureTranslationSchema()
  const catalog = await getCatalog()
  const hashOf = new Map(catalog.map(i => [`${i.type}:${i.id}`, i.hash]))
  const rows = await sql`SELECT content_type, content_id, fields, source_hash FROM content_translations WHERE locale = ${locale} AND status = 'published'`
  const out: Record<string, Record<string, string>> = {}
  for (const r of rows) {
    const key = `${r.content_type}:${r.content_id}`
    if (hashOf.get(key) === r.source_hash) out[key] = r.fields
  }
  return out
}

// ── Language enable/disable ──────────────────────────────────────────────────
let enabledCache: { at: number; set: Set<string> } | null = null
export async function getEnabledLocales(): Promise<Set<string>> {
  if (enabledCache && Date.now() - enabledCache.at < 30_000) return enabledCache.set
  const all = new Set<string>(LOCALES.map(l => l.code))
  try {
    await ensureTranslationSchema()
    for (const r of await sql`SELECT locale, enabled FROM i18n_locale_settings`) if (!r.enabled && r.locale !== 'en') all.delete(r.locale)
  } catch { /* DB trouble → everything stays enabled */ }
  enabledCache = { at: Date.now(), set: all }
  return all
}
export async function setLocaleEnabled(locale: string, enabled: boolean) {
  if (!isLocale(locale) || locale === 'en') throw new Error('Language cannot be changed')
  await ensureTranslationSchema()
  await sql`INSERT INTO i18n_locale_settings (locale, enabled, updated_at) VALUES (${locale}, ${enabled}, ${Date.now()})
            ON CONFLICT (locale) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at`
  enabledCache = null
}
