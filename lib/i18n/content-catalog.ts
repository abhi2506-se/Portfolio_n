/** Server-side catalog of everything translatable, built from the live content tables (read-only). */
import { lazySql } from '@/lib/neon-lazy'
import { defaultPortfolioData } from '@/lib/portfolio-data'
import { contentIdFor, flattenFields, hashFields, type ContentType } from './content-ids'

const sql: any = lazySql

export interface ContentItem {
  type: ContentType
  id: string
  label: string
  fields: Record<string, string>
  hash: string
}

/** Legal documents: English text lives in admin settings; translations are manual + reviewed only (no AI, never auto-published). */
export const LEGAL_DOCS = [
  { id: 'privacy-policy', setting: 'privacy_policy', label: 'Privacy Policy' },
  { id: 'terms-of-service', setting: 'terms_of_service', label: 'Terms of Service' },
] as const

const mk = (type: ContentType, item: any, label: string): ContentItem => {
  const fields = flattenFields(type, item)
  return { type, id: contentIdFor(type, item), label, fields, hash: hashFields(fields) }
}

export async function buildCatalog(): Promise<ContentItem[]> {
  let data: any = defaultPortfolioData
  try {
    const rows = await sql`SELECT data FROM portfolio_data WHERE key = 'main'`
    if (rows[0]?.data) data = { ...defaultPortfolioData, ...rows[0].data, about: { ...defaultPortfolioData.about, ...(rows[0].data.about || {}) }, hero: { ...defaultPortfolioData.hero, ...(rows[0].data.hero || {}) } }
  } catch { /* table absent → defaults */ }

  const items: ContentItem[] = []
  items.push(mk('hero', data.hero, 'Hero'))
  items.push(mk('about', data.about, 'About Me'))
  ;(data.projects?.length ? data.projects : defaultPortfolioData.projects).forEach((p: any) => items.push(mk('project', p, `Project: ${p.name || p.title}`)))
  ;(data.experience || []).forEach((e: any) => items.push(mk('experience', e, `Experience: ${e.title}`)))
  ;(data.education || []).forEach((e: any) => items.push(mk('education', e, `Education: ${e.title}`)))
  try {
    const blogs = await sql`SELECT id, title, summary FROM portfolio_blogs WHERE published = true ORDER BY created_at DESC`
    for (const b of blogs) items.push(mk('blog', b, `Blog: ${b.title}`))
  } catch { /* no blogs table yet */ }
  // Legal documents are authored by the admin (chatbot_settings). Their English text is the source; editing it makes translations outdated.
  try {
    const rows = await sql`SELECT key, value FROM chatbot_settings WHERE key IN ('privacy_policy', 'terms_of_service')`
    const byKey: Record<string, string> = Object.fromEntries(rows.map((r: any) => [r.key, r.value || '']))
    for (const d of LEGAL_DOCS) items.push(mk('legal', { id: d.id, body: byKey[d.setting] }, `Legal: ${d.label}`))
  } catch { /* settings table absent */ }
  return items.filter(i => Object.keys(i.fields).length > 0 && i.id)
}

let cached: { at: number; items: ContentItem[] } | null = null
export async function getCatalog(maxAgeMs = 30_000): Promise<ContentItem[]> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.items
  const items = await buildCatalog()
  cached = { at: Date.now(), items }
  return items
}
export const clearCatalogCache = () => { cached = null }
