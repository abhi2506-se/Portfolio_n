# v46 — Persistent chat identity, Notification Center, Web Push (Phases 2–4)

(Phase 1, delivery fix, is in LIVE_CHAT_UPDATE_v45.md.)

## Phase 2 — identity
- A signed-in visitor (existing `/visitor/login` session) skips the name/email/phone form; the server takes identity from the session cookie only. Browser-sent details are ignored.
- `live_chats.visitor_id` (auto-migrated). Resume = `visitor_id` match — never phone/device matching, so two accounts never merge.
- After logout / another account on the same browser the old chat is unreachable (`lib/live-chat-identity.ts` → `ownsChat`). Guest chats keep the device-cookie rule.
- `GET /api/live-chat?whoami=1` drives the widget. `/?openChat=1` opens the widget (used by notification clicks).

## Phase 3 — notification center
- Tables `app_notifications`, `notification_push_subscriptions` (auto-created).
- Recipient = `v:<visitorId>` or `g:<deviceId>`, derived server-side. Anonymous browsers get an empty list and no cookie.
- API: `GET/POST /api/notifications` (list, read, read_all, delete, clear_read); admin `POST /api/admin/announcements {title, body?, url?, category?}`.
- UI: bell in navbar (desktop + mobile), `/notifications` page (category tabs, unread filter, pagination, push card).
- Realtime: per-recipient unguessable Supabase channel, payload `{t:'changed'}` only; 45 s poll fallback.
- Producers: chat reply / approved / ended (generic wording, never message text; skipped if visitor is in the chat), login, new-device login, password changed, account locked, site posts/updates/announcements (`lib/notifications.ts`). All wrapped so they cannot break the main action.

## Phase 4 — Web Push (visitors & guests)
- `/api/notifications/push` GET/POST/DELETE, VAPID via existing env vars. Permission asked only on a button click.
- Subscriptions are re-bound to the current identity on every visit; removed on visitor logout, on 404/410, and after 5 failures. `pushsubscriptionchange` handled in `public/sw.js` (cache v5; admin push untouched).
- Legacy `VisitorNotifications` and its routes are untouched; devices in both systems don't get duplicate site pushes.

## Env vars
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (push), `SESSION_SECRET` (set a real value!), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (realtime), `DATABASE_URL`.

## Not verified
Nothing was run against live Vercel/Neon/Supabase; push delivery needs a real browser + HTTPS.

## v46.1 hotfix
- **"Internal error" on chat start / form shown even when logged in:** the schema bootstrap in `lib/live-chat-db.ts` now tolerates failing statements (logged, not fatal) and gives up retrying after 3 attempts. Before, any single failing statement made EVERY live-chat request return 500. Regression test: `tests/live-chat-schema-resilience.test.ts` (fails on the old code).
- **Notifications come to you:** `components/notifications/notification-live.tsx` (mounted in `app/layout.tsx`) shows a pop-up the moment a notification arrives and a one-tap "Allow notifications" card for visitors / guests who used live chat. Real push (tab closed) needs `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`.
