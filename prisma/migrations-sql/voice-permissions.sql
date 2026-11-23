-- Voice Phase 4: access requests and per-visitor command permissions.
-- NOT APPLIED. Review, then run on a Neon branch first, then production (after approval).
-- Additive only: creates new tables; touches no existing table or row.
-- Uses live_chats.id (TEXT) for chat references, same as the rest of the live chat schema.

CREATE TABLE IF NOT EXISTS voice_access_requests (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,              -- live_chats.id
  user_name   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_at BIGINT NOT NULL,
  reviewed_by TEXT,
  reviewed_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_voice_access_requests_status ON voice_access_requests (status, requested_at DESC);

CREATE TABLE IF NOT EXISTS voice_permissions (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT NOT NULL,              -- live_chats.id
  permissions TEXT NOT NULL,              -- comma list from a fixed set: nav,portfolio,projects,skills,live_chat,contact
  granted_by  TEXT NOT NULL,
  granted_at  BIGINT NOT NULL,
  expires_at  BIGINT,                     -- NULL = no expiry
  revoked_at  BIGINT,                     -- set on revocation; permissions are checked server-side on every command
  UNIQUE (chat_id)
);

CREATE TABLE IF NOT EXISTS voice_command_log (
  id          TEXT PRIMARY KEY,
  chat_id     TEXT,
  actor       TEXT NOT NULL,              -- 'admin:<name>' or 'visitor:<chat_id>'
  command     TEXT NOT NULL,
  status      TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_command_log_created ON voice_command_log (created_at DESC);
