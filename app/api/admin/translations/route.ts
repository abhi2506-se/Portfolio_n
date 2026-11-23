export const runtime = 'nodejs'
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { adminFromRequest } from '@/lib/admin-request'
import { isLocale, LOCALES, type Locale } from '@/lib/i18n/config'
import { getCatalog, clearCatalogCache } from '@/lib/i18n/content-catalog'
import {
  coverageAll, effectiveStatus, getEnabledLocales, getTranslation, listForAdmin, listVersions, publishTranslation,
  revertToVersion, sanitizeFields, saveTranslation, unpublishTranslation,
} from '@/lib/i18n/translations-db'
import { activeProvider, suggestFields } from '@/lib/i18n/ai-translate'
import { missingUiStrings, saveUiStrings, uiCoverage, clearUiCache } from '@/lib/i18n/ui-strings-db'

const noStore = { 'Cache-Control': 'no-store' }
const deny = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s, headers: noStore })

/**
 * GET                      → languages (enabled flag + coverage) and provider info
 * GET ?locale=hi           → every translatable item with its status for that language
 * GET ?locale=hi&type&id   → one item: English source, current translation, versions
 */
export async function GET(req: NextRequest) {
  if (!adminFromRequest(req)) return deny()
  try {
    const p = req.nextUrl.searchParams
    const locale = p.get('locale')
    if (!locale) {
      const [coverage, enabled] = await Promise.all([coverageAll(), getEnabledLocales()])
      return NextResponse.json({
        languages: LOCALES.filter(l => l.code !== 'en').map(l => ({ code: l.code, native: l.native, english: l.english, enabled: enabled.has(l.code), coverage: coverage[l.code] })),
        provider: activeProvider(),
      }, { headers: noStore })
    }
    if (!isLocale(locale) || locale === 'en') return bad('Unsupported language')
    const type = p.get('type'), id = p.get('id')
    if (!type || !id) return NextResponse.json(await listForAdmin(locale), { headers: noStore })
    const item = (await getCatalog(0)).find(i => i.type === type && i.id === id)
    if (!item) return bad('Unknown content', 404)
    const row = await getTranslation(type, id, locale)
    return NextResponse.json({
      item: { type: item.type, id: item.id, label: item.label, fields: item.fields },
      translation: row ? { ...row, effectiveStatus: effectiveStatus(row, item) } : null,
      effectiveStatus: effectiveStatus(row, item),
      versions: row ? await listVersions(row.id) : [],
    }, { headers: noStore })
  } catch (err) {
    console.error('[admin/translations] GET failed:', err)
    return bad('Could not load translations', 500)
  }
}

/** Body: { action: 'save'|'publish'|'unpublish'|'revert'|'suggest', type, id, locale, fields?, status?, versionId?, note? } */
export async function POST(req: NextRequest) {
  const admin = adminFromRequest(req)
  if (!admin) return deny()
  try {
    const b = await req.json().catch(() => null)
    if (!b || !isLocale(b.locale) || b.locale === 'en') return bad('Unsupported language')
    const locale = b.locale as Locale

    // Bulk: translate what is missing (or was auto-translated earlier and is now outdated) with the configured AI provider
    // and publish it, so visitors see content in their language without manual work. Human-written, draft and in-review
    // translations are never touched, and legal documents are never auto-translated. Processes a small batch per call so
    // it fits serverless time limits; the admin UI calls it repeatedly until `remaining` is 0.
    // Interface text (every button/label/message hard-coded in the app, user and admin side): English-as-key translation memory.
    if (b.action === 'ui_coverage') return NextResponse.json({ ok: true, ...(await uiCoverage(locale)) }, { headers: noStore })
    if (b.action === 'autotranslate_ui') {
      if (activeProvider() === 'none') return bad('No AI translation provider is configured (set ANTHROPIC_API_KEY or GOOGLE_TRANSLATE_API_KEY).', 501)
      const batch = Math.min(Math.max(Number(b.batch) || 30, 1), 40)
      const missing = await missingUiStrings(locale)
      const chunk = missing.slice(0, batch)
      let translated = 0; let failed = 0
      if (chunk.length) {
        try {
          const input: Record<string, string> = {}; chunk.forEach((t, i) => { input[String(i)] = t })
          const out = await suggestFields(input, locale)
          const pairs = chunk.map((source, i) => ({ source, text: out[String(i)] || '' })).filter(p => p.text.trim())
          await saveUiStrings(locale, pairs, 'ai:auto')
          translated = pairs.length; failed = chunk.length - pairs.length
        } catch (err) { console.error('[admin/translations] autotranslate_ui failed', err); failed = chunk.length }
      }
      clearUiCache()
      return NextResponse.json({ ok: true, translated, failed, remaining: Math.max(missing.length - translated, 0) }, { headers: noStore })
    }
    if (b.action === 'autotranslate') {
      if (activeProvider() === 'none') return bad('No AI translation provider is configured (set ANTHROPIC_API_KEY or GOOGLE_TRANSLATE_API_KEY).', 501)
      const batch = Math.min(Math.max(Number(b.batch) || 4, 1), 6)
      const { entries } = await listForAdmin(locale)
      const eligible = entries.filter(e => e.type !== 'legal' && (e.status === 'missing' || (e.status === 'outdated' && (e.updatedBy || '').startsWith('ai:'))))
      const catalog = await getCatalog(0)
      let translated = 0; const failed: string[] = []
      for (const e of eligible.slice(0, batch)) {
        const it = catalog.find(i => i.type === e.type && i.id === e.id)
        if (!it || !Object.keys(it.fields).length) continue
        try {
          const fields = sanitizeFields(await suggestFields(it.fields, locale), it)
          if (!Object.keys(fields).length) throw new Error('empty')
          await saveTranslation(it, locale, fields, 'draft', 'ai:auto', 'Automatic translation')
          await publishTranslation(it, locale, 'ai:auto')
          translated++
        } catch (err) { console.error('[admin/translations] autotranslate failed for', e.type, e.id, err); failed.push(`${e.type}:${e.id}`) }
      }
      clearCatalogCache()
      return NextResponse.json({ ok: true, translated, failed, remaining: Math.max(eligible.length - translated - failed.length, 0) }, { headers: noStore })
    }
    const item = (await getCatalog(0)).find(i => i.type === b.type && i.id === b.id)
    if (!item) return bad('Unknown content', 404)

    switch (b.action) {
      case 'save': {
        const fields = sanitizeFields(b.fields, item)
        if (!Object.keys(fields).length) return bad('Enter at least one translated field')
        const status = b.status === 'in_review' ? 'in_review' : 'draft'     // saving can NEVER publish
        const row = await saveTranslation(item, locale, fields, status, admin, typeof b.note === 'string' ? b.note.slice(0, 500) : null)
        return NextResponse.json({ ok: true, translation: row }, { headers: noStore })
      }
      case 'publish': {
        const row = await publishTranslation(item, locale, admin)
        clearCatalogCache()
        return NextResponse.json({ ok: true, translation: row }, { headers: noStore })
      }
      case 'unpublish': {
        const row = await unpublishTranslation(item.type, item.id, locale, admin)
        return NextResponse.json({ ok: true, translation: row }, { headers: noStore })
      }
      case 'revert': {
        if (typeof b.versionId !== 'string') return bad('versionId required')
        const row = await revertToVersion(item, locale, b.versionId, admin)
        return NextResponse.json({ ok: true, translation: row }, { headers: noStore })
      }
      case 'suggest': {
        if (item.type === 'legal') return bad('Legal documents must be translated and reviewed manually.', 403)
        if (activeProvider() === 'none') return bad('No AI translation provider is configured. You can still translate manually.', 501)
        const suggestion = await suggestFields(item.fields, locale)   // returned for review — NOT saved
        return NextResponse.json({ ok: true, suggestion }, { headers: noStore })
      }
      default: return bad('Unknown action')
    }
  } catch (err: any) {
    console.error('[admin/translations] POST failed:', err)
    return bad(err?.message === 'Nothing to publish' ? 'Save a translation before publishing.' : 'Request failed', 500)
  }
}
