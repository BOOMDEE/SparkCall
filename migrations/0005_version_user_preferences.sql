ALTER TABLE user_preferences
  ADD COLUMN version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0);
