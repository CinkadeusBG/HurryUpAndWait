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

## Build for production

```bash
npm run build
```

Output: `dist/orlando-park-pulse/`

## Attribution

Footer includes **"Powered by ThemeParks.wiki"** as required by the free API. Please keep this attribution visible.