CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_turn_limit_bytes INTEGER NOT NULL CHECK (monthly_turn_limit_bytes >= 0),
  updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_settings_updated_by ON user_settings(updated_by, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_scope TEXT NOT NULL CHECK (length(target_scope) BETWEEN 1 AND 40),
  affected_count INTEGER NOT NULL CHECK (affected_count >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_actor_time ON admin_audit(actor_user_id, created_at DESC);
