# Hurry Up and Wait

Real-time wait times, park hours, and show schedules for Walt Disney World and Universal Orlando — built with Angular 17 and PrimeNG.

Live data comes from [ThemeParks.wiki](https://themeparks.wiki). Weather uses [Open-Meteo](https://open-meteo.com/).

## Features

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
- ThemeParks.wiki API for live/schedule data
- Open-Meteo for resort weather
- SCSS with resort-themed CSS variables (Disney blue/gold, Universal purple/orange)

## Project layout

```
src/app/
  core/
    constants/     # park IDs, resort themes, refresh intervals
    models/        # API and view-model types
    services/      # ThemeParks, weather, favorites, clock
    utils/         # wait-time formatting, show-time filtering, schedule labels
  features/
    dashboard/     # main UI — header, filters, cards, panels, bottom nav
```

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