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
