# Live Chat v45 — reliable message delivery ("Send again" fix)

## Root cause
The server saved the visitor's message, then **awaited** a link-preview fetch, the Supabase
Realtime broadcast (no timeout), admin push and presence checks *before replying*. If any of
those was slow or failed, or the function timed out, the visitor's request failed even though
the message was in the database (the admin could see it). The UI marked every failed or slow
response as `failed`, and "Send again" re-sent the text under a **new** `clientId`, so the
server's duplicate protection could not help and the message could be sent twice.

## Changes
- `app/api/live-chat/route.ts` — `message` / `admin_reply` reply as soon as the row is saved.
  Broadcast, link preview, admin push, AI reply and handoff note run in `after()` (the AI
  reply used to be fire-and-forget, which serverless can kill). A retry of an already-saved
  message re-broadcasts so the admin still gets it, without a second push/AI reply.
  `maxDuration = 30`.
- `lib/supabase-realtime.ts` — broadcast bounded to 4 s.
- `lib/live-chat-db.ts` — `ensureLiveChatSchema()` is race-safe (concurrent cold-start
  requests wait for the same run; a failed run is retried); a failed unique-index creation is
  logged instead of swallowed.
- `lib/live-chat-send.ts` (new) — `sendWithRetry`: same payload / same `clientId` on every
  attempt, per-attempt timeout, backoff retries for network/timeout/408/425/429/5xx, no retry
  for definitive refusals (400/401/403/404/409), no wasted attempts while offline.
- `components/live-chat/user-chat-panel.tsx`, `admin-chat-panel.tsx` — one `deliver()` path
  (text, GIF, sticker, image/video, voice) with an outbox: states **sending → sent →
  delivered/read**, `failed` only when a send genuinely failed, "Send again" re-sends under the
  same `clientId`, automatic resume on `online` / tab visible, a failed bubble is never
  resurrected if the poll/realtime already delivered the saved row. Visitor draft is kept in
  localStorage per chat. The admin panel previously had no failure handling at all.
- `components/live-chat/message-bubble.tsx` — `sending` status (clock icon).

## Tests
`tests/live-chat-send.test.ts` (client helper) and `tests/live-chat-delivery.test.ts`
(real route + real SQL via PGlite: hung/throwing broadcast, retry of same clientId, burst
double-submit, wrong-device 403, no internal error leakage). The hung-broadcast test fails on
the previous server code.

## Not changed / notes
- No new env vars, no DB schema change (the `(chat_id, client_id)` unique index already existed).
- Failed-but-unsent messages are kept in memory only; a full page reload clears them
  (the draft text for the input box is preserved).
