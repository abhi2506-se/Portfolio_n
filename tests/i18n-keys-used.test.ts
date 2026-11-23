/** Every statically-referenced t('key') / tOr('key') in the source must exist in the English dictionary. */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import site from '@/lib/i18n/messages/en/site'
import user from '@/lib/i18n/messages/en/user'

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    if (['node_modules', '.next', 'tests', 'messages'].includes(f)) continue
    const p = join(dir, f)
    statSync(p).isDirectory() ? walk(p, out) : /\.(tsx?|ts)$/.test(f) && out.push(p)
  }
  return out
}

describe('translation keys used in code exist', () => {
  it('has no missing keys', () => {
    const known = new Set([...Object.keys(site as any), ...Object.keys(user as any)])
    const missing: string[] = []
    for (const d of ['app', 'components', 'hooks', 'lib']) {
      for (const f of walk(join(process.cwd(), d))) {
        const src = readFileSync(f, 'utf8')
        for (const m of src.matchAll(/\b(?:t|tr|tOr)\(\s*'([a-z0-9_]+(?:\.[A-Za-z0-9_ ]+)+)'/g))
          if (!known.has(m[1])) missing.push(`${f.replace(process.cwd() + '/', '')}: ${m[1]}`)
      }
    }
    expect(missing).toEqual([])
  })
})
