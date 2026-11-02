ALTER TABLE records ADD COLUMN owner_capability_hash TEXT;
ALTER TABLE records ADD COLUMN participants_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN number_changed_at TEXT;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts >= 0)
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_window ON login_attempts(window_started_at);

INSERT OR IGNORE INTO reserved_numbers(number) VALUES
  ('admin'), ('api'), ('call'), ('callrecords'), ('contact'),
  ('help'), ('root'), ('sparkcall'), ('support'), ('system');

CREATE TABLE IF NOT EXISTS turn_snapshot_cursor (
  id INTEGER PRIMARY KEY CHECK (id=1),
  last_user_id TEXT
);
INSERT OR IGNORE INTO turn_snapshot_cursor(id,last_user_id) VALUES(1,NULL);
