# Orlando Park Pulse — Setup Guide

Real-time Walt Disney World and Universal Orlando wait times dashboard built with Angular 17 and PrimeNG.

## Prerequisites

- Node.js 18+ (Angular 17 officially supports 18–20; Node 22 may work with warnings)
- npm 9+

## Quick Start (this repo)

```bash
npm install
npm start
```

Open `http://localhost:4200`.

## Integrate into an existing Angular workspace

### 1. Install dependencies

```bash
npm install primeng@17 primeicons
```

### 2. Enable HttpClient and animations

In `app.config.ts`:

```typescript
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(),
    provideAnimations(),
    // ...existing providers
  ],
};
```

### 3. Add global styles

In `src/styles.scss`:

```scss
@import 'primeng/resources/themes/lara-dark-blue/theme.css';
@import 'primeng/resources/primeng.min.css';
@import 'primeicons/primeicons.css';
```

Copy the CSS variables and glassmorphism helpers from this project's `src/styles.scss`.

### 4. Copy application source

Copy these folders into your app:

```
src/app/core/constants/park.constants.ts
src/app/core/models/theme-parks.models.ts
src/app/core/utils/attraction.utils.ts
src/app/core/services/theme-parks.service.ts
src/app/core/services/favorites.service.ts
src/app/features/dashboard/
```

### 5. Register the route

```typescript
import { DashboardComponent } from './features/dashboard/dashboard.component';

export const routes: Routes = [
  { path: '', component: DashboardComponent },
];
```

## ThemeParks.wiki API integration

Base URL (no API key required):

```
https://api.themeparks.wiki/v1
```

### Endpoints used

| Endpoint | Purpose |
|----------|---------|
| `GET /entity/{parkId}/live` | Live wait times, showtimes, status |
| `GET /entity/{parkId}/schedule` | Today's park hours |
| `GET /entity/{parkId}/children` | Land/area lookup for sorting |

### Hardcoded destination & park IDs

Defined in `src/app/core/constants/park.constants.ts`:

- **WDW destination:** `e957da41-3552-4cf6-b636-5babc5cbc4e5`
- **Universal Orlando destination:** `89db5d43-c434-4097-b71f-f6869f495a22`
- Parks: Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom, Universal Studios Florida, Islands of Adventure, Volcano Bay, Epic Universe

### Polling & refresh

`ThemeParksService.watchPark()` uses `combineLatest` + `interval(180000)` for auto-refresh every 3 minutes. Call `refreshNow()` for manual refresh (header button or pull-to-refresh on mobile).

## PrimeNG components used

- `p-card` — attraction cards
- `p-tag` / `p-badge` — status badges
- `p-selectButton` — WDW vs Universal tabs
- `p-dropdown` — sort & filter controls
- `p-inputText` + `p-iconField` — search bar
- `p-skeleton` — loading placeholders
- `p-accordion` — closed rides section
- `p-message` — error banner
- `p-button` — refresh & favorites

All are imported as standalone modules per component (tree-shakable).

## Local persistence

| Key | Storage | Purpose |
|-----|---------|---------|
| `orlando-park-pulse-resort` | localStorage | Last selected resort tab |
| `orlando-park-pulse-park` | localStorage | Last selected park |
| `orlando-park-pulse-favorites` | localStorage | Starred attraction IDs |

## Project structure

```
src/app/
├── core/
│   ├── constants/park.constants.ts   # Resort/park IDs & theme tokens
│   ├── models/theme-parks.models.ts  # API TypeScript interfaces
│   ├── services/
│   │   ├── theme-parks.service.ts    # HttpClient + RxJS polling
│   │   └── favorites.service.ts      # localStorage favorites
│   └── utils/attraction.utils.ts     # Sort, filter, wait-time helpers
└── features/dashboard/
    ├── dashboard.component.*           # Main SPA shell
    └── components/
        ├── attraction-card/
        ├── closed-rides-panel/
        ├── filter-toolbar/
        ├── park-header/
        ├── park-hours-panel/
        ├── quick-stats-panel/
        └── show-times-panel/
```

## Historical wait data (Chart.js + Turso)

### Overview

| Component | Location | Responsibility |
|-----------|----------|----------------|
| Angular app | GitHub Pages | Live polling + chart UI |
| Turso DB | `hurryupandwait-cinkadeus.aws-us-east-1.turso.io` | Persistent snapshot storage |
| Collector | Docker on \*arr server | Poll ThemeParks.wiki → insert rows |

There is **no** GitHub Actions data-collection workflow and **no** `data/` JSON in the repo anymore.

### Dependencies

```bash
npm install chart.js@4
```

### Turso schema

```sql
CREATE TABLE collection_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE wait_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park_id TEXT NOT NULL,
  park_name TEXT NOT NULL,
  local_date TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  attraction_id TEXT NOT NULL,
  attraction_name TEXT NOT NULL,
  status TEXT NOT NULL,
  wait_time INTEGER,
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
  local_date TEXT NOT NULL,
  collected_at TEXT NOT NULL,
  attraction_id TEXT NOT NULL,
  attraction_name TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  sold_out INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'live',
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

SQL files: `scripts/sql/ill_daily_snapshots.sql` and `scripts/sql/park_ll_daily_snapshots.sql`. Run against Turso before enabling the collector or frontend history views.

**`collection_metadata` rows:**

- `last_updated` — UTC ISO timestamp of the latest wait-time collector run
- `last_ill_collected` — UTC ISO timestamp of the latest ILL daily collector run
- `retention_days` — days of history to keep (currently `45`)

**Uniqueness:** one row per `(park_id, collected_at, attraction_id)` prevents duplicate inserts when a collection round is retried.

### Collector (Docker on \*arr server)

The wait-time collector runs outside this repo as a **long-lived Docker service on the homelab \*arr server**.

Each cycle:

1. Check local park time is within operating hours (8 AM–midnight `America/New_York`)
2. For each park in `PARKS`, call ThemeParks.wiki `GET /entity/{parkId}/live`
3. `INSERT` attraction snapshots into `wait_snapshots` (standby `waitTime` may be `NULL`)
4. Set `collection_metadata.last_updated`
5. Delete rows older than `retention_days`
6. Sleep ~5 minutes and repeat

**Container environment (typical):**

```bash
TURSO_DATABASE_URL=libsql://hurryupandwait-cinkadeus.aws-us-east-1.turso.io
TURSO_AUTH_TOKEN=<read-write token>
```

Manage the container on the \*arr host (`docker compose up -d`, logs, image updates). The compose file and collector image are maintained on that server, not in this Angular repo.

### ILL daily collector (`scripts/collect_ill_daily.py`)

Separate from the wait-time Docker service. Collects **end-of-day Individual Lightning Lane prices** for the four WDW parks once per evening.

| Setting | Default | Location |
|---------|---------|----------|
| Collection window | 8 PM–11 PM ET | `scripts/parks_config.json` → `collectionHourStart` / `collectionHourEnd` |
| Retention | 45 days | `retentionDays` in config |
| Parks | Magic Kingdom, EPCOT, Hollywood Studios, Animal Kingdom | `wdwParks` in config |

Each run:

1. Skip if outside the evening window (unless `--ignore-hours` or `--force`)
2. `ensure_schema` from both SQL files under `scripts/sql/`
3. For each WDW park: `GET /entity/{parkId}/live` + `GET /entity/{parkId}/schedule`
4. Upsert one row per park into `park_ll_daily_snapshots` (MLL + LLPP)
5. Upsert one row per ILL attraction into `ill_daily_snapshots` (`sold_out` = 1 when unavailable)
6. Set `collection_metadata.last_ill_collected` / `last_park_ll_collected` and prune old rows

**Deploy on \*arr server** (separate from the wait-time Docker collector):

```bash
cd scripts
cp env.example env.ll-collector    # Turso URL + RW token; chmod 600
chmod +x update-ll-collector.sh
./update-ll-collector.sh --schema-only
./update-ll-collector.sh --test
./update-ll-collector.sh --install-cron
```

**Test locally without server access:**

```bash
cd scripts
export TURSO_DATABASE_URL=libsql://...
export TURSO_AUTH_TOKEN=...
python collect_ill_daily.py --schema-only
python collect_ill_daily.py --ignore-hours
```

### Frontend (Turso reads)

Connection settings: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` in `park.constants.ts`.

| Path | Purpose |
|------|---------|
| `src/app/core/services/turso-client.service.ts` | Turso HTTP pipeline client (`POST /v2/pipeline`) |
| `src/app/core/services/historical-data.service.ts` | SQL for manifest, park history, sparklines, ride detail |

**Queries used by the app:**

| Method | SQL target |
|--------|------------|
| Manifest | `collection_metadata` + `GROUP BY park_id, local_date` on `wait_snapshots` |
| Ride detail | `wait_snapshots` filtered by `park_id` + `attraction_id` |
| Card sparkline | today's rows for one attraction, `collected_at >=` 6-hour cutoff |
| Stats park LL history | `park_ll_daily_snapshots` for selected WDW park (`getParkLlHistory`) |
| Ride detail ILL chart | `ill_daily_snapshots` for one `park_id` + `attraction_id` (`getAttractionIllHistory`) |

ILL / Lightning Lane UI paths:

| Path | Purpose |
|------|---------|
| `src/app/core/utils/ill-display.utils.ts` | ILL price formatting, sold-out labels |
| `src/app/core/utils/lightning-lane.utils.ts` | Live MLL/LLPP/ILL from ThemeParks.wiki schedule + live data |
| `src/app/features/dashboard/components/park-ll-stats-panel/` | Stats tab — today's Multi Pass (MLL) and Premier Pass (LLPP) with sold-out |
| `src/app/features/ride-detail/` | ILL banner, summary stats, and daily bar chart when history exists |

Turso pipeline args must be typed objects (`{ "type": "text", "value": "..." }`), not raw strings.

### Chart.js pieces

| Path | Purpose |
|------|---------|
| `src/app/core/utils/chart.utils.ts` | Chart.js config + hourly/dow aggregations |
| `src/app/shared/components/wait-trend-chart/` | Reusable line chart (card sparkline + detail page) |
| `src/app/features/ride-detail/` | Detail route `/ride/:parkId/:attractionId` |

Register the route in `app.routes.ts` and link ride titles from `attraction-card` with `routerLink`.

### GitHub Pages deploy

`deploy-pages.yml` builds with `--base-href /{repo-name}/` and deploys on every push to `main`. Historical charts read Turso from the browser — no redeploy needed when the Docker collector adds snapshots.

## Build for production

```bash
npm run build
```

Output: `dist/orlando-park-pulse/`

## Attribution

Footer includes **"Powered by ThemeParks.wiki"** as required by the free API. Please keep this attribution visible.