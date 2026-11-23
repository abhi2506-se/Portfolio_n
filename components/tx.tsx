'use client'
import React from 'react'
import { useLanguage } from '@/lib/language-context'

/** Renders its English text in the visitor's/admin's language (falls back to the English text). Non-string children pass through. */
export function Tx({ children }: { children?: React.ReactNode }) {
  const { tx } = useLanguage()
  return <>{typeof children === 'string' ? tx(children) : children}</>
}

/** Hook form: `const __tx = useTx(); … placeholder={__tx("Search")}` */
export function useTx(): (text: string) => string {
  return useLanguage().tx
}
