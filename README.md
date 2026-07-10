# Hurry Up and Wait

Real-time wait times, park hours, and show schedules for Walt Disney World and Universal Orlando — built with Angular 17 and PrimeNG.

Live data comes from [ThemeParks.wiki](https://themeparks.wiki). Weather uses [Open-Meteo](https://open-meteo.com/).

## Features

- **Live Board (`/dashboard`)** — fullscreen hotel-style info channel that auto-rotates through all WDW + Universal parks (40s default, settings gear to change). Major / moderate / light wait bands, weather forecast, hours, Up Next shows, rides to avoid, insights, and Chart.js longest-wait bars. Left/right chevrons or arrow keys for manual advance. Linked from the main header as **Dashboard**.
- **Historical wait trends** — Chart.js sparklines on ride cards and a detail page with today’s curve, hourly averages, and day-of-week patterns (Turso)
- **Lightning Lane pricing** — live MLL/LLPP on the park Stats tab; individual ILL on ride cards and ride detail pages with end-of-day history (Turso)
- **Live wait times** — color-coded cards with smooth fade updates on refresh
- **Park hours** — today's schedule in park local time (Early Theme Park Entry, Early Park Admission, etc.)
- **Show times** — upcoming performances with expandable lists on each card
- **Quick stats** — averages, shortest/longest waits, and ride counts
- **Favorites** — star attractions across all parks and resorts
- **Auto-refresh** — polls every 3 minutes; header ring shows time until the next update
- **Weather & park clock** — resort weather badge and local park time in the header

## Parks

**Walt Disney World**

- Magic Kingdom
- EPCOT
- Hollywood Studios
- Animal Kingdom

**Universal Orlando**

- Universal Studios Florida
- Islands of Adventure
- Epic Universe

## Quick start

**Prerequisites:** Node.js 18+ and npm 9+

```bash
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200).

```bash
npm run build    # production build → dist/orlando-park-pulse
npm test         # unit tests (Karma)
```

## Tech stack

- Angular 17 (standalone components)
- PrimeNG 17 + PrimeIcons
- Chart.js 4 for historical wait-time visualizations
- [Turso](https://turso.tech/) (libSQL) for historical wait-time storage
- ThemeParks.wiki API for live/schedule data
- Open-Meteo for resort weather
- SCSS with resort-themed CSS variables (Disney blue/gold, Universal purple/orange)

## Project layout

```
.github/workflows/
  deploy-pages.yml         # Build + deploy static site to GitHub Pages
src/app/
  core/
    constants/     # park IDs, Turso URL/token, refresh intervals
    models/        # API and view-model types
    services/      # ThemeParks, weather, favorites, clock, Turso, historical data
    utils/         # wait-time formatting, show-time filtering, chart helpers
  features/
    dashboard/     # main UI — header, filters, cards, panels, bottom nav
    info-channel/  # fullscreen Live Board (/dashboard) — park carousel + dense panels
    ride-detail/   # per-ride historical charts
  shared/components/wait-trend-chart/
```

## Live Board (info channel)

| Item | Detail |
|------|--------|
| **URL** | `/dashboard` (local: `http://localhost:4201/dashboard`, Pages: `…/HurryUpAndWait/dashboard`) |
| **Entry** | **Dashboard** button in the main app header |
| **Rotation** | All 7 parks in order; default **40s**; gear icon → interval only (15–120s, stored in `localStorage`) |
| **Manual** | Semi-transparent side chevrons or ← / → keys |
| **Data** | Same live ThemeParks.wiki feed as the home app, Open-Meteo hourly forecast, park capacity insights |

No GitHub Actions changes are required — the existing `deploy-pages.yml` production build already lazy-loads the board chunk.


## Data architecture

Historical wait times are decoupled from the GitHub Pages deploy:

| Layer | Role |
|-------|------|
| **GitHub Pages** | Serves the Angular app (`deploy-pages.yml` on push to `main`) |
| **Turso** | Stores wait-time snapshots (`wait_snapshots`), daily ILL prices (`ill_daily_snapshots`), and park-level MLL/LLPP (`park_ll_daily_snapshots`); metadata in `collection_metadata` |
| **Docker on \*arr server** | Background wait-time collector (~5 min); nightly ILL collector (`scripts/collect_ill_daily.py`) |

The site reads history directly from Turso at runtime (`POST /v2/pipeline`). New snapshots appear in charts without redeploying the frontend.

Legacy per-day JSON under `data/` and the GitHub Actions collector workflow have been removed.

### Turso database

- **URL:** `libsql://hurryupandwait-cinkadeus.aws-us-east-1.turso.io`
- **HTTP API:** `https://hurryupandwait-cinkadeus.aws-us-east-1.turso.io/v2/pipeline`
- **Frontend config:** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in `src/app/core/constants/park.constants.ts`

#### Schema

```sql
CREATE TABLE collection_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE wait_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id TEXT NOT NULL,
  park_name TEXT NOT NULL,
  local_date TEXT NOT NULL,          -- America/New_York calendar date (YYYY-MM-DD)
  collected_at TEXT NOT NULL,        -- UTC ISO-8601 timestamp
  attraction_id TEXT NOT NULL,
  attraction_name TEXT NOT NULL,
  status TEXT NOT NULL,              -- e.g. OPERATING, CLOSED, REFURBISHMENT
  wait_time INTEGER,                 -- standby minutes; NULL when unavailable
  entity_type TEXT NOT NULL DEFAULT 'ATTRACTION',
  UNIQUE (park_id, collected_at, attraction_id)
);

CREATE INDEX idx_wait_snapshots_park_attraction
  ON wait_snapshots (park_id, attraction_id, collected_at);

CREATE INDEX idx_wait_snapshots_local_date
  ON wait_snapshots (local_date);

CREATE TABLE ill_daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id TEXT NOT NULL,
  park_name TEXT NOT NULL,
  local_date TEXT NOT NULL,          -- America/New_York calendar date (YYYY-MM-DD)
  collected_at TEXT NOT NULL,        -- UTC ISO-8601 timestamp
  attraction_id TEXT NOT NULL,
  attraction_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,      -- USD cents (UI rounds up to whole dollars)
  sold_out INTEGER NOT NULL DEFAULT 0,  -- 1 = sold out / unavailable that day
  source TEXT NOT NULL DEFAULT 'live',  -- live | schedule
  UNIQUE (park_id, local_date, attraction_id)
);

CREATE INDEX idx_ill_daily_park_date
  ON ill_daily_snapshots (park_id, local_date);

CREATE INDEX idx_ill_daily_attraction
  ON ill_daily_snapshots (park_id, attraction_id, local_date);

CREATE TABLE park_ll_daily_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id TEXT NOT NULL,
  park_name TEXT NOT NULL,
  local_date TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  multi_pass_cents INTEGER,
  multi_pass_sold_out INTEGER NOT NULL DEFAULT 0,
  premier_pass_cents INTEGER,
  premier_pass_sold_out INTEGER NOT NULL DEFAULT 0,
  UNIQUE (park_id, local_date)
);
```

Apply with `scripts/sql/ill_daily_snapshots.sql` and `scripts/sql/park_ll_daily_snapshots.sql` (the collector also runs `ensure_schema` on startup).

#### `collection_metadata` keys

| Key | Example | Purpose |
|-----|---------|---------|
| `last_updated` | `2026-07-07T22:00:48Z` | UTC timestamp of the most recent wait-time collection run |
| `last_ill_collected` | `2026-07-07T03:00:12Z` | UTC timestamp of the most recent ILL daily collection run |
| `last_park_ll_collected` | `2026-07-07T03:00:12Z` | UTC timestamp of the most recent park-level MLL/LLPP collection run |
| `retention_days` | `45` | Snapshot retention window used by the collector |

#### Row shape (app mapping)

Each `wait_snapshots` row maps to a `WaitTimeSnapshot` in the frontend:

| DB column | App field |
|-----------|-----------|
| `collected_at` | `timestamp` |
| `attraction_id` | `attractionId` |
| `attraction_name` | `name` |
| `status` | `status` |
| `wait_time` | `waitTime` |
| `entity_type` | `entityType` |

### Collector (Docker on \*arr server)

A background collector runs as a **Docker container on the homelab \*arr server** (alongside the Sonarr/Radarr/Prowlarr stack). It replaces the old repo-based JSON collector and GitHub Actions cron.

**Behavior (observed):**

- Polls `GET https://api.themeparks.wiki/v1/entity/{parkId}/live` for all seven parks
- Runs on a **~5-minute cadence** during park operating hours (**8 AM–midnight**, `America/New_York`)
- Inserts one row per attraction per collection round into `wait_snapshots`
- Updates `collection_metadata.last_updated` after each run
- Prunes snapshots older than `retention_days` (45)

**Parks collected:** same IDs as `PARKS` in `park.constants.ts` (four WDW parks + three Universal Orlando parks).

**Typical container env vars:**

```bash
TURSO_DATABASE_URL=libsql://hurryupandwait-cinkadeus.aws-us-east-1.turso.io
TURSO_AUTH_TOKEN=<rw token>
```

The collector image and compose service live on the \*arr server — not in this repo. Restart or upgrade it there when changing collection schedule or retention.

### ILL daily collector (`scripts/collect_ill_daily.py`)

WDW-only script that records **one price per attraction per day** (late evening, when the day’s ILL lineup is settled). It reads live `PAID_RETURN_TIME` prices and falls back to schedule `lightninglane_*` purchases when needed.

**Behavior:**

- Runs during **8 PM–11 PM** `America/New_York` (configurable in `scripts/parks_config.json`)
- Upserts into `ill_daily_snapshots` (per-attraction ILL) and `park_ll_daily_snapshots` (MLL + LLPP per park)
- Sets `sold_out` when purchases are unavailable or `PAID_RETURN_TIME` is `FINISHED`/`TEMP_FULL`
- Updates `collection_metadata.last_ill_collected` and prunes rows older than `retention_days` (45)

**Deploy on \*arr server** (after `git pull`):

```bash
cd scripts
cp env.example env.ll-collector    # add Turso URL + RW token; chmod 600
chmod +x update-ll-collector.sh
./update-ll-collector.sh --schema-only   # create ILL + park LL tables
./update-ll-collector.sh --test          # one-off run (--ignore-hours)
./update-ll-collector.sh --install-cron  # nightly 11 PM ET
```

The wait-time Docker collector is unchanged; this is a **separate cron job** for Lightning Lane history.

**Local testing** (no server access required):

```bash
cd scripts
export TURSO_DATABASE_URL=libsql://...
export TURSO_AUTH_TOKEN=...
python collect_ill_daily.py --schema-only
python collect_ill_daily.py --ignore-hours
```

The table must exist in Turso before the app or collector can use it. Charts stay empty until the first successful run.

## Ride detail charts

Click a ride title on any card to open `/ride/{parkId}/{attractionId}` with:

- **Today’s trend** — standby waits collected today
- **Hourly averages** — typical wait by hour across all stored days
- **Day-of-week pattern** — average wait by weekday
- **Recent hours** — last 6 hours of snapshots
- **ILL pricing** (WDW, when applicable) — live price banner plus daily bar chart from `ill_daily_snapshots` (sold-out days highlighted)

The dashboard **Stats** tab shows today’s **Multi Pass (MLL)** and **Premier Pass (LLPP)** prices for the selected WDW park (including sold-out status) plus a daily history table from `park_ll_daily_snapshots`.

Live polling is unchanged; historical charts load from Turso separately.

## Configuration

Preferences (resort, park, favorites mode) persist in `localStorage`.

Key constants live in `src/app/core/constants/park.constants.ts`:

- `REFRESH_INTERVAL_MS` — live data polling (default 3 minutes)
- `PARKS` — supported parks and ThemeParks.wiki entity IDs
- `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — historical data connection
- `HISTORICAL_DATA_RETENTION_DAYS` — fallback retention (45) when metadata is missing

## Integration guide

See [SETUP.md](./SETUP.md) for step-by-step instructions to embed this dashboard into another Angular workspace.

## Data attribution

Wait times and schedules are provided by third-party APIs and may lag official park systems, especially at rope drop. This app is not affiliated with Disney or Universal.

Powered by [ThemeParks.wiki](https://themeparks.wiki).