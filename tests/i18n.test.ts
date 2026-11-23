import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { LOCALES, PREFIXED_LOCALES, INDEXED_LOCALES, parseLocale } from '@/lib/i18n/config'
import { loadMessages } from '@/lib/i18n/messages'
import { stripLocale, localizePath, isLocalizablePath } from '@/lib/i18n/paths'
import { createT, createTOr, formatRelative, formatNumber } from '@/lib/i18n/translate'
import { buildAlternates, localizedUrl } from '@/lib/i18n/seo'
import { middleware } from '@/middleware'

process.env.NEXT_PUBLIC_BASE_URL = 'https://www.example.com'

const FULL = ['en', 'hi', 'de', 'fr', 'es'] as const
const placeholders = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join()

describe('message completeness', () => {
  it.each(FULL.filter(l => l !== 'en'))('%s defines every English key with identical placeholders', async loc => {
    const en = await loadMessages('en'), m = await loadMessages(loc)
    const missing = Object.keys(en).filter(k => !(k in m))
    expect(missing).toEqual([])
    expect(Object.keys(m).filter(k => !(k in en))).toEqual([])
    for (const k of Object.keys(en)) expect(placeholders(m[k]), `${loc}:${k}`).toBe(placeholders(en[k]))
  })

  it('non-English locales actually differ from English for UI strings (no silent English copy)', async () => {
    const en = await loadMessages('en')
    for (const loc of ['hi', 'de', 'fr', 'es'] as const) {
      const m = await loadMessages(loc)
      const same = Object.keys(en).filter(k => m[k] === en[k] && en[k].length > 12 && !/^seo\./.test(k))
      expect(same.length, `${loc} identical to English: ${same.slice(0, 5).join(', ')}`).toBeLessThan(10) // a few genuine cognates (e.g. fr "Certifications") are legitimately identical
    }
  })

  it('haryanvi falls back to Hindi for keys it has no copy for, never to a raw key', async () => {
    const hv = await loadMessages('haryanvi'), hi = await loadMessages('hi'), en = await loadMessages('en')
    for (const k of Object.keys(en)) expect(hv[k], k).toBeTruthy()
    expect(hv['push.title']).toBe(hi['push.title'])
  })
})

describe('translate helpers', () => {
  it('interpolates, warns-free fallback, locale formatting', async () => {
    const t = createT({ a: 'Hi {name}' }); expect(t('a', { name: 'X' })).toBe('Hi X')
    expect(createTOr({})('x', 'fallback')).toBe('fallback')
    expect(formatNumber(1234567.5, 'de')).toBe('1.234.567,5')
    const now = Date.UTC(2026, 0, 1)
    expect(formatRelative(now - 5 * 60_000, 'de', now)).toMatch(/5 Minuten/)
    expect(formatRelative(now - 5 * 60_000, 'en', now)).toMatch(/5 minutes ago/)
    expect(parseLocale('xx')).toBe('en'); expect(parseLocale('fr')).toBe('fr')
  })
})

describe('paths & SEO', () => {
  it('strips and builds localized paths; English and private areas stay unprefixed', () => {
    expect(stripLocale('/hi/projects/x')).toEqual({ locale: 'hi', path: '/projects/x' })
    expect(stripLocale('/hi')).toEqual({ locale: 'hi', path: '/' })
    expect(stripLocale('/history')).toEqual({ locale: null, path: '/history' })   // not a locale prefix
    expect(localizePath('/', 'de')).toBe('/de')
    expect(localizePath('/journey', 'fr')).toBe('/fr/journey')
    expect(localizePath('/journey', 'en')).toBe('/journey')
    expect(localizePath('/admin/dashboard', 'es')).toBe('/admin/dashboard')
    expect(localizePath('/visitor/login', 'de')).toBe('/visitor/login')
    expect(localizePath('/journey', 'haryanvi')).toBe('/journey')
    expect(isLocalizablePath('/projects/foo')).toBe(true); expect(isLocalizablePath('/api/x')).toBe(false)
  })

  it('canonical + hreflang: self-canonical per language, x-default English, dialect canonicalises to English', () => {
    const a = buildAlternates('/journey', 'de')
    expect(a.canonical).toBe('https://www.example.com/de/journey')
    expect(a.languages).toMatchObject({ en: 'https://www.example.com/journey', hi: 'https://www.example.com/hi/journey', de: 'https://www.example.com/de/journey', fr: 'https://www.example.com/fr/journey', es: 'https://www.example.com/es/journey', 'x-default': 'https://www.example.com/journey' })
    expect(Object.keys(a.languages!)).toHaveLength(INDEXED_LOCALES.length + 1)
    expect(buildAlternates('/', 'haryanvi').canonical).toBe('https://www.example.com')
    expect(buildAlternates('/admin/dashboard', 'de')).toEqual({ canonical: 'https://www.example.com/admin/dashboard' })
    expect(localizedUrl('/', 'fr')).toBe('https://www.example.com/fr')
  })
})

describe('middleware routing', () => {
  const req = (path: string, cookie?: string) => new NextRequest('https://www.example.com' + path, cookie ? { headers: { cookie } } : undefined)
  const hdr = (res: Response, n: string) => res.headers.get('x-middleware-request-' + n)

  it('rewrites /de/journey to /journey with the locale header and sets the cookie', () => {
    const res = middleware(req('/de/journey?x=1'))
    expect(res.headers.get('x-middleware-rewrite')).toContain('/journey?x=1')
    expect(res.headers.get('x-middleware-rewrite')).not.toContain('/de/')
    expect(hdr(res, 'x-locale')).toBe('de'); expect(hdr(res, 'x-pathname')).toBe('/journey')
    expect(res.headers.get('set-cookie')).toContain('portfolio_lang=de')
  })
  it('/en/… redirects permanently to the unprefixed English URL (no duplicate pages)', () => {
    const res = middleware(req('/en/journey')); expect(res.status).toBe(308); expect(res.headers.get('location')).toBe('https://www.example.com/journey')
  })
  it('a prefix on a non-localized area is stripped', () => {
    const res = middleware(req('/hi/admin/dashboard')); expect(res.status).toBe(308); expect(res.headers.get('location')).toBe('https://www.example.com/admin/dashboard')
  })
  it('unprefixed URLs follow the cookie, default English, ignore bad values', () => {
    expect(hdr(middleware(req('/journey', 'portfolio_lang=fr')), 'x-locale')).toBe('fr')
    expect(hdr(middleware(req('/admin/dashboard', 'portfolio_lang=hi')), 'x-locale')).toBe('hi')
    expect(hdr(middleware(req('/journey')), 'x-locale')).toBe('en')
    expect(hdr(middleware(req('/journey', 'portfolio_lang=klingon')), 'x-locale')).toBe('en')
  })
})

describe('config sanity', () => {
  it('all required languages are present and prefixed ones are indexed', () => {
    const codes = LOCALES.map(l => l.code)
    for (const c of ['en', 'hi', 'de', 'fr', 'es']) expect(codes).toContain(c)
    for (const c of PREFIXED_LOCALES) expect(INDEXED_LOCALES).toContain(c)
    expect(LOCALES.every(l => l.native && l.tag && l.og)).toBe(true)
  })
})
