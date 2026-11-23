import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ rows: new Map<string, any>() }))
vi.mock('@/lib/neon-lazy', () => ({
  lazySql: (strings: TemplateStringsArray, ...v: any[]) => {
    const q = strings.join('?')
    if (/^\s*CREATE/i.test(q)) return Promise.resolve([])
    if (/^\s*INSERT/i.test(q)) { h.rows.set(`${v[0]}:${v[1]}`, { locale: v[0], hash: v[1], text: v[3] }); return Promise.resolve([]) }
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([...h.rows.values()].filter(r => r.locale === v[0]).map(r => ({ hash: r.hash, text: r.text })))
    return Promise.resolve([])
  },
}))
vi.mock('@/lib/i18n/ui-manifest.json', () => ({ default: ['Save changes', 'Delete', 'Hello world'] }))

vi.mock('@/lib/i18n/ui-seed/hi.json', () => ({ default: {} }))
vi.mock('@/lib/i18n/ui-seed/de.json', () => ({ default: {} }))
vi.mock('@/lib/i18n/ui-seed/fr.json', () => ({ default: {} }))
vi.mock('@/lib/i18n/ui-seed/es.json', () => ({ default: {} }))

import { uiHash, lookupUi, normalizeUi } from '@/lib/i18n/ui-strings'
import { getUiStrings, saveUiStrings, missingUiStrings, uiCoverage, clearUiCache } from '@/lib/i18n/ui-strings-db'

beforeEach(() => { h.rows.clear(); clearUiCache() })

describe('ui strings', () => {
  it('hash ignores whitespace differences', () => {
    expect(uiHash('Hello   world\n')).toBe(uiHash(' Hello world'))
    expect(normalizeUi('  a \n b ')).toBe('a b')
  })
  it('lookup falls back to English', () => {
    expect(lookupUi({}, 'Save')).toBe('Save')
    expect(lookupUi({ [uiHash('Save')]: 'सहेजें' }, 'Save')).toBe('सहेजें')
  })
  it('stores, serves and counts coverage; English never loads', async () => {
    expect(await getUiStrings('en')).toEqual({})
    expect(await missingUiStrings('hi')).toHaveLength(3)
    await saveUiStrings('hi', [{ source: 'Save changes', text: 'बदलाव सहेजें' }], 'ai:auto')
    expect((await getUiStrings('hi', 0))[uiHash('Save changes')]).toBe('बदलाव सहेजें')
    expect(await uiCoverage('hi')).toEqual({ total: 3, translated: 1, percent: 33 })
    expect(await missingUiStrings('de')).toHaveLength(3)
  })
})

describe('bundled seed', () => {
  it('covers the whole real manifest in every language without any DB rows', async () => {
    const fs = await import('node:fs')
    const man: string[] = JSON.parse(fs.readFileSync('lib/i18n/ui-manifest.json', 'utf8'))
    for (const l of ['hi', 'de', 'fr', 'es']) {
      const seed = JSON.parse(fs.readFileSync(`lib/i18n/ui-seed/${l}.json`, 'utf8'))
      expect(man.filter(s => !seed[uiHash(s)])).toEqual([])
    }
  })
})
