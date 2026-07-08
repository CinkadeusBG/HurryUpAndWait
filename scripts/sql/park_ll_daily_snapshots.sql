-- Park-level Lightning Lane (Multi Pass + Premier Pass) end-of-day snapshots (WDW only).
-- Run once against the Turso database before starting the collector.

CREATE TABLE IF NOT EXISTS park_ll_daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id TEXT NOT NULL,
  park_name TEXT NOT NULL,
  local_date TEXT NOT NULL,                  -- America/New_York calendar date (YYYY-MM-DD)
  collected_at TEXT NOT NULL,                -- UTC ISO-8601 timestamp of collection
  multi_pass_cents INTEGER,                  -- NULL when Multi Pass not offered that day
  multi_pass_sold_out INTEGER NOT NULL DEFAULT 0,
  premier_pass_cents INTEGER,                -- NULL when Premier Pass not offered that day
  premier_pass_sold_out INTEGER NOT NULL DEFAULT 0,
  UNIQUE (park_id, local_date)
);

CREATE INDEX IF NOT EXISTS idx_park_ll_daily_park_date
  ON park_ll_daily_snapshots (park_id, local_date DESC);