# Multilingual system — notes (Phases A–C)

Languages: en (source), hi, de, fr, es; haryanvi cookie-only (falls back hi → en). Add a language: add an entry in `lib/i18n/config.ts` + `lib/i18n/messages/<code>/{site,user}.ts` (tests enforce key/placeholder parity).

## Layers
1. UI strings: typed dictionaries, only the active locale loads. `useLanguage().t()`.
2. Content (DB): `content_translations` (+ versions, `i18n_locale_settings`). Statuses Missing/Draft/In Review/Published/Outdated. Public site only gets Published + hash-matching translations. Admin UI: `/admin/translations` (not yet linked from dashboard).
3. Dynamic (optional): `/api/live-chat/translate` — on click only, one admin message, consent prompt, cached in `live_chat_message_translations`, 60/chat/day. Original never changed.

## Env
- `SESSION_SECRET` (real), `NEXT_PUBLIC_BASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Optional AI: `TRANSLATION_PROVIDER` (anthropic|google|none), `ANTHROPIC_API_KEY` (+`TRANSLATION_MODEL`) or `GOOGLE_TRANSLATE_API_KEY`. Without them everything works manually.

## Notes
- Next 15: `middleware.ts` handles locale routing; `proxy.ts` is dead until Next 16 (merge then).
- Pages are dynamic (layout reads locale headers).
- Legal translations are never AI-suggested and never shown unless manually published.

## Round 2 — UI now translated (en/hi/de/fr/es)
Pre-chat form, chat block/unblock gate, PIN lock, visitor login/request-access, portal login/register, testimonials (form + headings), schedule section, meeting-scheduler wizard (hero "book a meeting"), ATS resume widget, AI assistant widget, visitor dashboard.

## Still English
- Admin dashboard and all admin screens (except /admin/translations content), extra-security modal, admin tool names listed in the visitor dashboard.
- Testimonial entries / blog / project text are content → translate via /admin/translations.
- AI assistant *answers* come from the backend model (English prompt); `send("Is Abhishek available for hire?")` quick prompt is sent as English on purpose.
- Visitor activation page, first-visit terms modal, PWA install hints, some smaller widgets (github-stats, visitor-analytics, whats-new).
- Server-generated emails and API error messages.

## Round 3
- AI assistant answers now follow the visitor's site language (`language` sent to /api/ai, whitelisted, appended to the system prompt; the visitor can still write in another language).
- `/admin/translations` linked from the admin dashboard ("Translations" in the sidebar).
- Visitor activation/reset page, GitHub stats, visitor counter translated.

## Round 4
- First-visit security/sign-up/login/OTP/forgot-password modal, What's-new, visitor analytics translated.
- `tests/i18n-keys-used.test.ts`: fails if any static t('key') in the source is missing from the English dictionary.
- Admin dashboard (8,400 lines, owner-only) intentionally left in English.

## Round 5 — content follows the selected language
`/admin/translations` → **Auto-translate everything missing**: translates about, hero, projects, experience, education and blogs into every enabled language with the configured AI provider and publishes them (author `ai:auto`). Never touches legal pages, human translations, drafts or in-review items; re-run after editing English (outdated auto-translations are refreshed). Needs `ANTHROPIC_API_KEY` or `GOOGLE_TRANSLATE_API_KEY`. Admin sidebar translated.

## Round 6 — every screen, user + admin ("English-as-key" interface translation)

* `scripts/i18n-codemod.mjs` wrapped ~2,486 hard-coded English strings in 120 files (visible text → `<Tx>`, placeholders/aria-labels/alerts/toasts/errors → `__tx()`), including the whole admin dashboard. Re-run it (idempotent) after adding new screens: `node scripts/i18n-codemod.mjs` (or `--manifest` to only refresh `lib/i18n/ui-manifest.json`).
* Translations live in table `ui_string_translations` (locale, hash of the English text). Missing → English is shown, so nothing can break. The layout preloads the map so SSR and client match (no flash).
* Admin → Translations → **"Auto-translate all screen text (user + admin)"** fills the table with the AI provider (needs `ANTHROPIC_API_KEY` or `GOOGLE_TRANSLATE_API_KEY`). You can also edit any row in the DB by hand.
* Known limits: sentences split around `{variables}` are translated in fragments; template-literal strings and text inside `<code>/<pre>` are skipped; server API error texts are covered only where the client shows them via `{error}`/`{message}`; static text in emails/PDFs is not part of this.

## Round 7 — Titan SMTP
All mail routes (contact, appeal, live-chat, admin reply/suspicious/OTP, auth OTP, testimonials, journey/*, security report, meeting mailer) now use `lib/smtp.ts` → `SMTP_HOST` (default smtp.titan.email), `SMTP_PORT` (default 465), `SMTP_USER` (full mailbox), `SMTP_PASS`. No Gmail defaults remain. `lib/portal/proposal-mailer.ts` keeps its separate `SALES_SMTP_*` config; `lib/visitor/mailer.ts` was already Titan.

## Round 8 — bundled translations (no API key needed)
All 2,487 interface strings are pre-translated into hi/de/fr/es and shipped in `lib/i18n/ui-seed/<locale>.json` (keyed by the same hash). `getUiStrings` = seed, overridden by DB rows (admin edits / AI auto-translate). So every user + admin screen is translated out of the box; also if the DB is down. After you add new screens, run `node scripts/i18n-codemod.mjs`, then press "Auto-translate all screen text" (needs an AI key) to fill only the new strings.
