/**
 * Stable ids + field flattening for translatable website content.
 * Shared by the server catalog (admin / API) and the browser overlay so both agree on keys.
 * The ENGLISH source is never modified: translations live in their own table, keyed by (type, id, locale).
 */
export type ContentType = 'about' | 'hero' | 'project' | 'experience' | 'education' | 'blog' | 'legal'

export function slugifyId(s: string): string {
  return String(s || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

export function contentIdFor(type: ContentType, item: any): string {
  switch (type) {
    case 'about': case 'hero': return 'main'
    case 'project': return String(item?.slug || slugifyId(item?.name || item?.title || ''))
    case 'experience': return slugifyId(`${item?.title || ''}-${item?.company || ''}`)
    case 'education': return slugifyId(`${item?.title || ''}-${item?.institution || ''}`)
    case 'blog': return String(item?.id || slugifyId(item?.title || ''))
    case 'legal': return String(item?.id || '')
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

function put(out: Record<string, string>, key: string, v: unknown) {
  if (Array.isArray(v)) v.forEach((x, i) => put(out, `${key}.${i}`, x))
  else { const s = str(v); if (s) out[key] = s }
}

/** English text fields of an item, flattened to { "title": "...", "features.0": "..." }. Names, URLs, tech lists are intentionally excluded. */
export function flattenFields(type: ContentType, item: any): Record<string, string> {
  const out: Record<string, string> = {}
  switch (type) {
    case 'about':
      put(out, 'bio1', item?.bio1); put(out, 'bio2', item?.bio2); put(out, 'bio3', item?.bio3)
      ;(item?.stats || []).forEach((s: any, i: number) => put(out, `stat.${i}.label`, s?.label))
      break
    case 'hero':
      put(out, 'title', item?.title); put(out, 'subtitle', item?.subtitle); put(out, 'description', item?.description)
      break
    case 'project':
      put(out, 'title', item?.name || item?.title); put(out, 'description', item?.description)
      if (item?.longDescription && item.longDescription !== item.description) put(out, 'longDescription', item.longDescription)
      put(out, 'features', item?.features)
      put(out, 'caseStudy.problem', item?.caseStudy?.problem); put(out, 'caseStudy.solution', item?.caseStudy?.solution)
      put(out, 'caseStudy.results', item?.caseStudy?.results)
      break
    case 'experience':
      put(out, 'title', item?.title); put(out, 'description', item?.description); put(out, 'achievements', item?.achievements)
      break
    case 'education':
      put(out, 'title', item?.title); put(out, 'description', item?.description); put(out, 'achievements', item?.achievements)
      break
    case 'blog':
      put(out, 'title', item?.title); put(out, 'summary', item?.summary)
      break
    case 'legal':
      put(out, 'body', item?.body)
      break
  }
  return out
}

/** Stable short hash of the English fields — a translation is "outdated" when this no longer matches the hash it was made from. */
export function hashFields(fields: Record<string, string>): string {
  const s = JSON.stringify(Object.keys(fields).sort().map(k => [k, fields[k]]))
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
