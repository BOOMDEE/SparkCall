ALTER TABLE users
  ADD COLUMN turn_monthly_quota_bytes INTEGER
  CHECK (turn_monthly_quota_bytes IS NULL OR turn_monthly_quota_bytes > 0);
