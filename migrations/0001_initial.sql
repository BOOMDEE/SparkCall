PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE COLLATE NOCASE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  number TEXT UNIQUE COLLATE BINARY,
  is_temporary INTEGER NOT NULL DEFAULT 0 CHECK (is_temporary IN (0,1)),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_number ON users(number COLLATE BINARY);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_lookup ON sessions(token_hash, expires_at);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  number TEXT NOT NULL COLLATE BINARY,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, number COLLATE BINARY)
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS blocked_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, blocked_user_id), CHECK(user_id <> blocked_user_id)
);

CREATE TABLE IF NOT EXISTS call_history (
  id TEXT PRIMARY KEY,
  caller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  caller_number TEXT, recipient_number TEXT,
  started_at TEXT NOT NULL, ended_at TEXT, duration_seconds INTEGER,
  status TEXT NOT NULL CHECK(status IN ('calling','ringing','connecting','connected','ended','rejected','busy','timeout','failed','cancelled')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_participant ON call_history(caller_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_recipient ON call_history(recipient_id, started_at DESC);

CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id TEXT REFERENCES call_history(id) ON DELETE SET NULL,
  slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  is_public INTEGER NOT NULL DEFAULT 0 CHECK(is_public IN (0,1)),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_records_owner ON records(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_public ON records(slug COLLATE NOCASE, is_public);

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, bytes_used INTEGER NOT NULL DEFAULT 0, quota_bytes INTEGER,
  authoritative INTEGER NOT NULL DEFAULT 0, captured_at TEXT NOT NULL,
  UNIQUE(user_id, month)
);
CREATE TABLE IF NOT EXISTS numbers (
  number TEXT PRIMARY KEY COLLATE BINARY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reserved_numbers (number TEXT PRIMARY KEY COLLATE BINARY);
