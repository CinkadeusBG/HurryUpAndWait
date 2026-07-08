-- Individual Lightning Lane (ILL) end-of-day price snapshots (WDW only).
-- Run once against the Turso database before starting the collector.

CREATE TABLE IF NOT EXISTS ill_daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id TEXT NOT NULL,
  park_name TEXT NOT NULL,
  local_date TEXT NOT NULL,              -- America/New_York calendar date (YYYY-MM-DD)
  collected_at TEXT NOT NULL,            -- UTC ISO-8601 timestamp of collection
  attraction_id TEXT NOT NULL,           -- ThemeParks.wiki entity UUID
  attraction_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,          -- USD cents (display rounds up to whole dollars)
  sold_out INTEGER NOT NULL DEFAULT 0,   -- 1 = sold out / unavailable for purchase that day
  source TEXT NOT NULL DEFAULT 'live',   -- live | schedule
  UNIQUE (park_id, local_date, attraction_id)
);

CREATE INDEX IF NOT EXISTS idx_ill_daily_park_date
  ON ill_daily_snapshots (park_id, local_date);

CREATE INDEX IF NOT EXISTS idx_ill_daily_attraction
  ON ill_daily_snapshots (park_id, attraction_id, local_date);