/** Content translation workflow: DB, admin API authorization, publish rules, outdated detection, legal safety, AI suggest. (PGlite) */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ pg: null as any }))
vi.mock('@/lib/db', () => ({ dbGetSettings: async () => Object.fromEntries((await h.pg.query('SELECT key,value FROM chatbot_settings')).rows.map((r: any) => [r.key, r.value])) }))
vi.mock('@neondatabase/serverless', async () => {
  const { PGlite } = await import('@electric-sql/pglite'); h.pg = new PGlite()
  const run = async (t: string, v: any[]) => (await h.pg.query(t, v)).rows as any[]
  const sql: any = async (s: any, ...v: any[]) => { if (typeof s === 'string') return run(s, v[0] || []); let t = s[0]; for (let i = 0; i < v.length; i++) t += `$${i + 1}` + s[i + 1]; return run(t, v) }
  return { neon: () => sql }
})
process.env.SESSION_SECRET = 'test-secret'; process.env.DATABASE_URL = 'postgres://x'
delete process.env.ANTHROPIC_API_KEY; delete process.env.GOOGLE_TRANSLATE_API_KEY

import { NextRequest } from 'next/server'
import { generateToken } from '@/lib/admin-auth'
import * as Admin from '@/app/api/admin/translations/route'
import * as Locales from '@/app/api/admin/translations/locales/route'
import * as Content from '@/app/api/i18n/content/route'
import * as Legal from '@/app/api/legal/route'
import { applyItem, applyPortfolio } from '@/lib/i18n/content-apply'
import { flattenFields, hashFields } from '@/lib/i18n/content-ids'
import { clearCatalogCache, getCatalog } from '@/lib/i18n/content-catalog'
import { getEnabledLocales, setLocaleEnabled, sanitizeFields } from '@/lib/i18n/translations-db'
import { suggestFields } from '@/lib/i18n/ai-translate'
import { defaultPortfolioData } from '@/lib/portfolio-data'

const admin = `portfolio_admin_session=${generateToken('abhishek')}`
const mk = (path: string, init: any = {}, cookie = admin) => new NextRequest('http://l' + path, { ...init, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } })
const post = (body: any, cookie = admin) => Admin.POST(mk('/api/admin/translations', { method: 'POST', body: JSON.stringify(body) }, cookie))
const pub = async (locale: string) => (await (await Content.GET(mk(`/api/i18n/content?locale=${locale}`, {}, ''))).json()).items
const P = defaultPortfolioData.projects[0] as any
const PID = 'project'
const slug = (P.title as string).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')

beforeAll(async () => { await h.pg.query(`CREATE TABLE chatbot_settings (key TEXT PRIMARY KEY, value TEXT)`); await h.pg.query(`INSERT INTO chatbot_settings VALUES ('privacy_policy','Original privacy text'),('terms_of_service','Original terms')`) })
beforeEach(() => clearCatalogCache())

describe('overlay (pure)', () => {
  it('never mutates the English original; project title maps to name+title; arrays by index', () => {
    const before = JSON.stringify(P)
    const out: any = applyItem('project', P, { [`project:${slug}`]: { title: 'KI-Lebenslauf', 'features.0': 'Erste', 'caseStudy.results.0': 'R0' } })
    expect(out.title).toBe('KI-Lebenslauf'); expect(out.name).toBe('KI-Lebenslauf'); expect(out.features[0]).toBe('Erste'); expect(out.features[1]).toBe(P.features[1])
    expect(JSON.stringify(P)).toBe(before)
    expect(applyItem('project', P, {})).toBe(P)
    const port: any = applyPortfolio({ projects: [P], about: { bio1: 'x' } } as any, { 'about:main': { bio1: 'y' } })
    expect(port.about.bio1).toBe('y')
  })
  it('stale structure is skipped safely and hash changes with text', () => {
    const out: any = applyItem('project', P, { [`project:${slug}`]: { 'features.99.x': 'boom' } }); expect(out.features.length).toBe(P.features.length)
    expect(hashFields({ a: '1' })).not.toBe(hashFields({ a: '2' })); expect(hashFields({ a: '1' })).toBe(hashFields({ a: '1' }))
    expect(Object.keys(flattenFields('project', P))).toContain('caseStudy.problem')
  })
})

describe('admin API authorization', () => {
  it('rejects every admin endpoint without the admin session', async () => {
    expect((await Admin.GET(mk('/api/admin/translations', {}, ''))).status).toBe(401)
    expect((await post({ action: 'save', locale: 'hi', type: 'project', id: slug, fields: { title: 'x' } }, '')).status).toBe(401)
    expect((await Locales.PUT(mk('/api/admin/translations/locales', { method: 'PUT', body: JSON.stringify({ locale: 'hi', enabled: false }) }, ''))).status).toBe(401)
    expect((await Admin.GET(mk('/api/admin/translations', {}, 'portfolio_admin_session=garbage.sig'))).status).toBe(401)
  })
})

describe('workflow', () => {
  it('save never publishes; public API only exposes published; draft/in_review hidden', async () => {
    const body = { locale: 'hi', type: 'project', id: slug }
    expect((await post({ ...body, action: 'save', fields: { title: 'एआई रिज्यूमे विश्लेषक', bogus: 'ignored' }, status: 'published' })).status).toBe(200)   // asks for published → still a draft
    let d = await (await Admin.GET(mk(`/api/admin/translations?locale=hi&type=project&id=${slug}`))).json()
    expect(d.effectiveStatus).toBe('draft'); expect(d.translation.fields.bogus).toBeUndefined()
    expect(await pub('hi')).toEqual({})
    await post({ ...body, action: 'save', fields: { title: 'एआई रिज्यूमे विश्लेषक' }, status: 'in_review' })
    expect(await pub('hi')).toEqual({})
    expect((await post({ ...body, action: 'publish' })).status).toBe(200)
    expect((await pub('hi'))[`project:${slug}`]).toEqual({ title: 'एआई रिज्यूमे विश्लेषक' })
    expect(await pub('de')).toEqual({})                          // other language unaffected
    expect(await pub('en')).toEqual({})                          // English is never overlaid
  })

  it('publishing without a saved translation is refused', async () => {
    const r = await post({ locale: 'fr', type: 'project', id: slug, action: 'publish' }); expect(r.status).toBe(500)
    expect((await r.json()).error).toMatch(/Save a translation/)
  })

  it('changing the English source marks the translation outdated and hides it from the website', async () => {
    await h.pg.query(`CREATE TABLE IF NOT EXISTS portfolio_data (key TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at BIGINT)`)
    const changed = { ...defaultPortfolioData, projects: [{ ...P, description: P.description + ' (updated)' }, ...defaultPortfolioData.projects.slice(1)] }
    await h.pg.query(`INSERT INTO portfolio_data VALUES ('main', $1, 0) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data`, [JSON.stringify(changed)])
    clearCatalogCache()
    // translation was made from the old text, and flattened fields now differ only if the translated item hash changes
    const cat = await getCatalog(0)
    expect(cat.find(i => i.id === slug)!.fields.description).toContain('(updated)')
    const list = await (await Admin.GET(mk('/api/admin/translations?locale=hi'))).json()
    expect(list.entries.find((e: any) => e.id === slug).status).toBe('outdated')
    expect((await pub('hi'))[`project:${slug}`]).toBeUndefined()
    const cov = (await (await Admin.GET(mk('/api/admin/translations'))).json()).languages.find((l: any) => l.code === 'hi').coverage
    expect(cov.outdated).toBe(1); expect(cov.published).toBe(0)
  })

  it('versions are recorded and revert restores text as a DRAFT, never published', async () => {
    const body = { locale: 'es', type: 'blog', id: 'x' }
    await h.pg.query(`CREATE TABLE IF NOT EXISTS portfolio_blogs (id TEXT PRIMARY KEY, title TEXT, summary TEXT, published BOOLEAN DEFAULT true, created_at BIGINT DEFAULT 0)`)
    await h.pg.query(`INSERT INTO portfolio_blogs (id,title,summary) VALUES ('x','My post','About things')`); clearCatalogCache()
    await post({ ...body, action: 'save', fields: { title: 'Mi publicación', summary: 'Sobre cosas' } })
    await post({ ...body, action: 'publish' })
    await post({ ...body, action: 'save', fields: { title: 'Mi entrada', summary: 'Sobre cosas' } })
    const d = await (await Admin.GET(mk('/api/admin/translations?locale=es&type=blog&id=x'))).json()
    expect(d.versions.length).toBeGreaterThanOrEqual(3)
    const pubV = d.versions.find((v: any) => v.action === 'publish')
    const r = await (await post({ ...body, action: 'revert', versionId: pubV.id })).json()
    expect(r.translation.status).toBe('draft'); expect(r.translation.fields.title).toBe('Mi publicación')
    expect((await pub('es'))['blog:x']).toBeUndefined()
  })
})

describe('legal documents', () => {
  it('AI suggestions are refused for legal; only a manually published, still-matching translation is served', async () => {
    const body = { locale: 'de', type: 'legal', id: 'privacy-policy' }
    expect((await post({ ...body, action: 'suggest' })).status).toBe(403)
    await post({ ...body, action: 'save', fields: { body: 'Übersetzte Datenschutzerklärung' } })
    let j = await (await Legal.GET(mk('/api/legal?locale=de', {}, ''))).json()
    expect(j.privacy_policy).toBe('Original privacy text'); expect(j.translated).toEqual({})        // draft is NOT shown
    await post({ ...body, action: 'publish' })
    j = await (await Legal.GET(mk('/api/legal?locale=de', {}, ''))).json()
    expect(j.translated.privacy_policy).toBe('Übersetzte Datenschutzerklärung')
    expect(j.privacy_policy).toBe('Original privacy text')                                           // English original unchanged
    await h.pg.query(`UPDATE chatbot_settings SET value='Changed english' WHERE key='privacy_policy'`); clearCatalogCache()
    j = await (await Legal.GET(mk('/api/legal?locale=de', {}, ''))).json()
    expect(j.translated).toEqual({})                                                                  // outdated → English only
    expect((await (await Legal.GET(mk('/api/legal', {}, ''))).json()).translated).toBeUndefined()   // plain request unchanged
  })
})

describe('languages & AI', () => {
  it('admin can disable a language (not English); sanitizeFields drops unknown keys', async () => {
    expect((await Locales.PUT(mk('/api/admin/translations/locales', { method: 'PUT', body: JSON.stringify({ locale: 'en', enabled: false }) }))).status).toBe(400)
    await Locales.PUT(mk('/api/admin/translations/locales', { method: 'PUT', body: JSON.stringify({ locale: 'fr', enabled: false }) }))
    const set = await getEnabledLocales(); expect(set.has('fr')).toBe(false); expect(set.has('en')).toBe(true)
    await setLocaleEnabled('fr', true); expect((await getEnabledLocales()).has('fr')).toBe(true)
    expect(sanitizeFields({ title: ' ok ', nope: 'x', description: 5 }, { type: 'project', id: 'p', label: '', fields: { title: 'T', description: 'D' }, hash: 'h' })).toEqual({ title: 'ok' })
  })
  it('suggest: 501 when no provider; with a provider it only RETURNS text (nothing saved)', async () => {
    expect((await post({ locale: 'hi', type: 'project', id: slug, action: 'suggest' })).status).toBe(501)
    process.env.ANTHROPIC_API_KEY = 'k'
    const fakeFetch = (async () => new Response(JSON.stringify({ content: [{ text: 'Sure: {"title":"शीर्षक","description":"विवरण"}' }] }), { status: 200 })) as any
    const out = await suggestFields({ title: 'T', description: 'D' }, 'hi', { fetchImpl: fakeFetch })
    expect(out).toEqual({ title: 'शीर्षक', description: 'विवरण' })
    delete process.env.ANTHROPIC_API_KEY
  })
  it('autotranslate: 501 without provider; publishes missing items; never legal, never human drafts', async () => {
    expect((await post({ locale: 'fr', action: 'autotranslate' })).status).toBe(501)
    // a human draft in French must survive untouched
    await post({ locale: 'fr', type: 'project', id: slug, action: 'save', fields: { title: 'Brouillon humain' }, status: 'draft' })
    process.env.ANTHROPIC_API_KEY = 'k'
    const orig = globalThis.fetch
    globalThis.fetch = (async (_u: any, init: any) => {
      const input = JSON.parse(JSON.parse(init.body).messages[0].content)
      const out: Record<string, any> = {}; for (const [k, v] of Object.entries(input)) out[k] = Array.isArray(v) ? (v as any[]).map(x => 'FR:' + x) : 'FR:' + v
      return new Response(JSON.stringify({ content: [{ text: JSON.stringify(out) }] }), { status: 200 })
    }) as any
    try {
      let rem = 1, total = 0
      for (let g = 0; g < 40 && rem > 0; g++) { const r = await (await post({ locale: 'fr', action: 'autotranslate', batch: 6 })).json(); total += r.translated; rem = r.remaining; if (!r.translated) break }
      expect(total).toBeGreaterThan(0)
      const map = await pub('fr')
      expect(Object.keys(map).some(k => k.startsWith('legal:'))).toBe(false)        // legal is never auto-translated
      expect(map[`project:${slug}`]).toBeUndefined()                                 // the human draft was not overwritten or published
      const d = await (await Admin.GET(mk(`/api/admin/translations?locale=fr&type=project&id=${slug}`))).json()
      expect(d.translation.fields.title).toBe('Brouillon humain')
      expect(Object.values(map).some((f: any) => Object.values(f).some(v => typeof v === 'string' && v.startsWith('FR:')))).toBe(true)
      expect((await post({ locale: 'fr', action: 'autotranslate' }, '')).status).toBe(401)
    } finally { globalThis.fetch = orig; delete process.env.ANTHROPIC_API_KEY }
  })
})
