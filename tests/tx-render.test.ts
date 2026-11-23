import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => '/' }))
import { LanguageProvider } from '@/lib/language-context'
import { Tx } from '@/components/tx'
import { uiHash } from '@/lib/i18n/ui-strings'

const h = React.createElement
describe('<Tx>', () => {
  it('renders the translated text, falls back to English, passes elements through', () => {
    const ui = { [uiHash('Save changes')]: 'बदलाव सहेजें' }
    const html = renderToStaticMarkup(
      h(LanguageProvider as any, { locale: 'hi', messages: { site: {}, user: {} }, uiStrings: ui },
        h('b', null, h(Tx, null, 'Save changes')), h('i', null, h(Tx, null, 'Unknown text')), h('u', null, h(Tx, null, h('em', null, 'x')))))
    expect(html).toBe('<b>बदलाव सहेजें</b><i>Unknown text</i><u><em>x</em></u>')
  })
})
