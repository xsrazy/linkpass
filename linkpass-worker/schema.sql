CREATE TABLE IF NOT EXISTS passes (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '',
  recovery_email TEXT,
  manage_token_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  creator_ip_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_active_at TEXT
);
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  pass_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS link_clicks (
  id TEXT PRIMARY KEY,
  pass_id TEXT NOT NULL,
  link_url TEXT NOT NULL,
  clicked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recovery_requests (
  id TEXT PRIMARY KEY,
  pass_id TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_passes_slug ON passes(slug);
CREATE INDEX IF NOT EXISTS idx_visits_pass ON visits(pass_id);
CREATE INDEX IF NOT EXISTS idx_clicks_pass ON link_clicks(pass_id);
CREATE INDEX IF NOT EXISTS idx_recovery_pass ON recovery_requests(pass_id);
CREATE INDEX IF NOT EXISTS idx_recovery_status ON recovery_requests(status);
-- Dedupe for stats: one row per pass, kind, key, IP, and day. A visit or
-- click only counts when its dedupe row is newly inserted, so repeat loads
-- and repeat clicks from the same IP on the same day do not inflate stats.
CREATE TABLE IF NOT EXISTS stat_events (
  pass_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (pass_id, kind, dedupe_key, ip_hash, day)
);
