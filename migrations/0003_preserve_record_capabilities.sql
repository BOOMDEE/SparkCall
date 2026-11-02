-- Keep separately owned records after temporary-account cleanup. A snapshot
-- preserves eligible call metadata if call_history is removed by its user FK.
CREATE TABLE records_next (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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
  updated_at TEXT NOT NULL,
  owner_capability_hash TEXT,
  participants_json TEXT NOT NULL DEFAULT '[]',
  record_started_at TEXT,
  record_ended_at TEXT,
  record_duration_seconds INTEGER
);
INSERT INTO records_next
  SELECT r.id,r.owner_id,r.call_id,r.slug,r.title,r.description,r.notes,r.tags_json,r.metadata_json,
    r.is_public,r.expires_at,r.created_at,r.updated_at,r.owner_capability_hash,r.participants_json,
    c.started_at,c.ended_at,c.duration_seconds
  FROM records r LEFT JOIN call_history c ON c.id=r.call_id;
DROP TABLE records;
ALTER TABLE records_next RENAME TO records;
CREATE INDEX idx_records_owner ON records(owner_id, updated_at DESC);
CREATE INDEX idx_records_public ON records(slug COLLATE NOCASE, is_public);
