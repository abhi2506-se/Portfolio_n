/** Overlay published translations onto content objects (pure; never mutates the originals). */
import { contentIdFor, type ContentType } from './content-ids'

export type TranslationMap = Record<string, Record<string, string>>

function setPath(obj: any, path: string, value: string) {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i]
    if (cur[k] == null || typeof cur[k] !== 'object') return          // structure changed since translation → skip safely
    cur = cur[k]
  }
  const last = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts[parts.length - 1]) : parts[parts.length - 1]
  if (last in Object(cur) || typeof last === 'string') cur[last] = value
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

export function applyItem<T>(type: ContentType, item: T, map: TranslationMap): T {
  const fields = map[`${type}:${contentIdFor(type, item)}`]
  if (!fields) return item
  const out: any = clone(item)
  for (const [k, v] of Object.entries(fields)) {
    if (type === 'project' && k === 'title') { out.title = v; out.name = v; continue }
    setPath(out, k, v)
  }
  return out
}

export function hasTranslation(type: ContentType, item: unknown, map: TranslationMap): boolean {
  return !!map[`${type}:${contentIdFor(type, item)}`]
}

/** Applies translations to the portfolio sections that have translatable text. */
export function applyPortfolio<T extends Record<string, any>>(data: T, map: TranslationMap): T {
  if (!map || !Object.keys(map).length) return data
  return {
    ...data,
    hero: data.hero ? applyItem('hero', data.hero, map) : data.hero,
    about: data.about ? applyItem('about', data.about, map) : data.about,
    projects: (data.projects || []).map((p: any) => applyItem('project', p, map)),
    experience: (data.experience || []).map((e: any) => applyItem('experience', e, map)),
    education: (data.education || []).map((e: any) => applyItem('education', e, map)),
  }
}
