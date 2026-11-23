# Voice Command System — Phase 3 (server registry, admin endpoints, typed confirmation)

## Endpoints (admin session required, checked server-side with adminFromRequest)
- `GET  /api/admin/voice/commands`  → command catalogue (no handlers, no secrets)
- `POST /api/admin/voice/command`   → execute `{ command, args?, confirm? }`

## Commands (only these exist; each maps to an existing function)
| id | sensitivity | what it does |
|---|---|---|
| nav.dashboard / nav.badges / nav.whats_new / nav.home / nav.projects / nav.journey | navigate | client navigation to allow-listed routes only |
| live_chat.counts | read | pending requests, active chats, unread messages (read-only SQL) |
| site.maintenance_status | read | reads `maintenance_mode` |
| site.settings_summary | read | safe keys only: maintenance_mode, site_version, chatbot_name |
| site.maintenance_on / _off | sensitive | `dbSetSettings({maintenance_mode})` — typed confirm |
| team.coadmins_list | read | co-admin names/usernames/enabled (no passwords) |
| team.coadmin_disable / _enable / _remove | sensitive | `setCoAdminEnabled` / `deleteCoAdmin` — typed confirm, args: username |

Not implemented (no existing API, or belongs to a later phase):
- Voice access requests and authorized voice users → Phase 4 (tables not created yet).
- User deletion → no existing admin API for registered users.
- Command history / audit viewer → needs `prisma/migrations-sql/voice-command-audit.sql` (not applied).

## Typed confirmation flow
1. POST without `confirm` → `{status:"confirmation_required", prompt, confirmToken}` (valid 2 min).
2. POST again with `confirm: { token, phrase }` → executes only if the token matches this command,
   these exact arguments, this admin, is unexpired, and the phrase matches (case/spacing-insensitive).
3. Otherwise → 403 `denied`, nothing changed.
Limitation: the token is stateless, so the same admin could replay it within 2 minutes.

## Security fixes made in this phase (existing routes, found by audit)
Previously unauthenticated, now admin-only:
- `/api/admin/settings` POST (anyone could change maintenance mode, notify email, resend settings)
- `/api/admin/block-ip` GET/POST/DELETE
- `/api/admin/reply` POST (anyone could send email through the site SMTP)
- `/api/admin/resume` POST (anyone could replace the resume file)
- `/api/admin/settings` GET is still public for the site (navbar, footer, AI assistant) but
  now strips any key matching key|secret|token|password|pass. Admins get everything.
Left as-is on purpose: `/api/admin/send-otp` (needed before login). It should get rate limiting.

## Environment
- `SESSION_SECRET` must be set in production. Sensitive voice actions are disabled (503) without it.
  The existing admin-auth fallback is still hardcoded and should be removed.

## Tests
- `lib/voice/commands/confirm.test.ts`: 6 pass (challenge TTL, binding to command/args/admin,
  tamper and wrong-secret rejection, phrase normalization, argument validation).
- Typecheck: 259 errors, identical set before and after (all pre-existing).
