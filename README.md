# Hurry Up and Wait

Real-time wait times, park hours, and show schedules for Walt Disney World and Universal Orlando — built with Angular 17 and PrimeNG.

Live data comes from [ThemeParks.wiki](https://themeparks.wiki). Weather uses [Open-Meteo](https://open-meteo.com/).

## Features

- **Historical wait trends** — Chart.js sparklines on ride cards and a detail page with today’s curve, hourly averages, and day-of-week patterns (background collector via GitHub Actions)
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
- ThemeParks.wiki API for live/schedule data
- Open-Meteo for resort weather
- SCSS with resort-themed CSS variables (Disney blue/gold, Universal purple/orange)

## Project layout

```
.github/workflows/
  collect-wait-times.yml   # Cron collector (every 5 min, park hours only)
  deploy-pages.yml         # Build + deploy static site to GitHub Pages
data/
  manifest.json            # Available dates per park (updated by collector)
  parks/{parkId}/{date}.json
scripts/
  collect_wait_times.py    # ThemeParks.wiki poller, prune, git commit
  parks_config.json
src/app/
  core/
    constants/     # park IDs, resort themes, refresh intervals
    models/        # API and view-model types
    services/      # ThemeParks, weather, favorites, clock, historical data
    utils/         # wait-time formatting, show-time filtering, chart helpers
  features/
    dashboard/     # main UI — header, filters, cards, panels, bottom nav
    ride-detail/   # per-ride historical charts
  shared/components/wait-trend-chart/
```

## Historical data collection

A Python workflow polls [ThemeParks.wiki](https://themeparks.wiki) every **5 minutes** during Orlando park hours (**8 AM–midnight Eastern**). Snapshots are stored under `data/parks/{parkId}/{YYYY-MM-DD}.json` and pruned after **45 days**.

| File | Role |
|------|------|
| `.github/workflows/collect-wait-times.yml` | Scheduled GitHub Actions job |
| `scripts/collect_wait_times.py` | API calls, append, prune, optional `git push` |
| `scripts/parks_config.json` | Park IDs (mirrors `park.constants.ts`) |

### Enable the collector on GitHub

1. Push this repo to GitHub (default branch `main`).
2. **Settings → Actions → General → Workflow permissions** → choose **Read and write permissions** (required for the collector to commit data).
3. The `collect-wait-times` workflow runs on cron automatically. Use **Actions → Collect Wait Times → Run workflow** to test (optional **force** bypasses operating-hours check).
4. Each data commit triggers `deploy-pages.yml`, which copies `data/` into the static build so charts load via `fetch()` at `/HurryUpAndWait/data/...`.

### Run the collector locally

```bash
pip install -r scripts/requirements.txt
python scripts/collect_wait_times.py --force   # --commit to git push
```

## Ride detail charts

Click a ride title on any card to open `/ride/{parkId}/{attractionId}` with:

- **Today’s trend** — standby waits collected today
- **Hourly averages** — typical wait by hour across all stored days
- **Day-of-week pattern** — average wait by weekday
- **Recent hours** — last 6 hours of snapshots

Live polling is unchanged; historical JSON is loaded separately from the site root.

## Configuration

Preferences (resort, park, favorites mode) persist in `localStorage`.

Key constants live in `src/app/core/constants/park.constants.ts`:

- `REFRESH_INTERVAL_MS` — live data polling (default 3 minutes)
- `PARKS` — supported parks and ThemeParks.wiki entity IDs

## Integration guide

See [SETUP.md](./SETUP.md) for step-by-step instructions to embed this dashboard into another Angular workspace.

## Data attribution

Wait times and schedules are provided by third-party APIs and may lag official park systems, especially at rope drop. This app is not affiliated with Disney or Universal.

Powered by [ThemeParks.wiki](https://themeparks.wiki).