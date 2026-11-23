-- Voice Phase 3: persistent command audit log.
-- NOT APPLIED. Run only after explicit approval, on a Neon branch first, then production.
-- Additive only: creates one new table, touches no existing table or row.
CREATE TABLE IF NOT EXISTS voice_command_audit (
  id          TEXT PRIMARY KEY,
  admin       TEXT NOT NULL,
  command     TEXT NOT NULL,
  status      TEXT NOT NULL,            -- ok | denied | error | confirmation-issued | confirmation-failed | invalid-args | unknown
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_command_audit_created ON voice_command_audit (created_at DESC);
