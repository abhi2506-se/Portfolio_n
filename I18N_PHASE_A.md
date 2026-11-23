# Multilingual system — Phase A (foundation)

## Root cause of "only a few labels translate"
`lib/language-context.tsx` was a client-only dictionary of 146 keys (en/hi/haryanvi/de) used by 12 components of the public
page. Admin, login/visitor/portal, live chat, notifications, legal pages and every DB-driven content block (projects, blog,
experience…) never called it. The language lived only in localStorage, so the server always rendered English
(`<html lang="en">`), there were no language URLs/SEO, and all four languages shipped in every page bundle.

## Architecture (extends the existing provider — no second system)
- `lib/i18n/config.ts` — one list of languages (en, hi, de, fr, es + existing haryanvi). Add a language = one entry + a messages folder.
- `lib/i18n/messages/<locale>/{site,user}.ts` — typed dictionaries (English is the source of truth; other locales are `Record<Key,string>` so a
  missing key is a compile error; `tests/i18n.test.ts` also checks placeholders). Only the ACTIVE locale is loaded (per-locale chunks).
- `middleware.ts` — `/hi /de /fr /es` URLs are rewritten to the existing pages (no file moves); `/en/*` 308-redirects to the unprefixed English URL
  (all existing URLs and SEO unchanged); admin/portal/visitor/api never get a prefix and follow the cookie.
- `app/layout.tsx` — locale decided on the server → correct `<html lang dir>`, translated SSR, locale-aware metadata (title, description, Open Graph,
  canonical, hreflang incl. x-default). `app/sitemap.ts` — one URL per language with hreflang alternates.
- `lib/language-context.tsx` — same `useLanguage()` API (+ `tOr`, `formatDate/Number/Relative` via Intl). Switching language = cookie + router navigation (no full reload).
- Persistence: cookie `portfolio_lang` (guests), `user_language_prefs` table (signed-in visitors; newest choice wins across devices; `components/language-sync.tsx`).
- Notifications/push: server-authored notifications are translated by type at display time and at push time (recipient's language).

## Not yet done (later phases) — see final report
Admin translation management + DB content translations (Phase B); legal pages; admin CMS UI strings; remaining hardcoded text in components.

## Notes
- `proxy.ts` is Next 16 syntax and is NOT executed on the installed Next 15.5 (so its admin-route protection/maintenance redirect never ran). Left untouched. If you upgrade to Next 16, merge `middleware.ts` into `proxy.ts` (Next 16 errors if both exist).
- Pages are now rendered per request (the root layout reads the locale header) instead of statically.
