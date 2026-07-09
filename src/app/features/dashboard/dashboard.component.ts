import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import {
  BehaviorSubject,
  combineLatest,
  forkJoin,
  interval,
  map,
  of,
  startWith,
  switchMap,
} from 'rxjs';
import {
  DEFAULT_PARK_ID,
  ParkConfig,
  REFRESH_INTERVAL_MS,
  RESORT_THEMES,
  RESORT_WEATHER_LOCATIONS,
  ResortId,
  getParkById,
  getParksForResort,
} from '../../core/constants/park.constants';
import { WaitTimeSnapshot } from '../../core/models/historical.models';
import { HistoricalDataService } from '../../core/services/historical-data.service';
import {
  AllParksDashboardState,
  AttractionViewModel,
  ParkDashboardState,
  ParkLiveBundle,
  SortOption,
} from '../../core/models/theme-parks.models';
import { FavoritesService } from '../../core/services/favorites.service';
import { ThemeParksService } from '../../core/services/theme-parks.service';
import {
  filterAttractions,
  isClosedSectionAttraction,
  isMainListAttraction,
  isPerformanceShow,
  isTrackableEntity,
  sortAttractions,
  toAttractionViewModel,
} from '../../core/utils/attraction.utils';
import {
  buildLightningLanePurchaseMap,
  getParkLightningLanePricing,
  type ParkLightningLanePricing,
} from '../../core/utils/lightning-lane.utils';
import { AttractionCardComponent } from './components/attraction-card/attraction-card.component';
import { ClosedRidesPanelComponent } from './components/closed-rides-panel/closed-rides-panel.component';
import { FilterToolbarComponent } from './components/filter-toolbar/filter-toolbar.component';
import { ParkHeaderComponent } from './components/park-header/park-header.component';
import { ParkHoursPanelComponent } from './components/park-hours-panel/park-hours-panel.component';
import { ParkLlStatsPanelComponent } from './components/park-ll-stats-panel/park-ll-stats-panel.component';
import { QuickStatsPanelComponent } from './components/quick-stats-panel/quick-stats-panel.component';
import { ShowTimesPanelComponent } from './components/show-times-panel/show-times-panel.component';

type DashboardTab = 'waits' | 'hours' | 'shows' | 'stats';
type BottomNavTab = DashboardTab;

const PREF_KEYS = {
  resort: 'orlando-park-pulse-resort',
  park: 'orlando-park-pulse-park',
  favoritesMode: 'orlando-park-pulse-favorites-mode',
} as const;

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    FormsModule,
    SkeletonModule,
    MessageModule,
    ParkHeaderComponent,
    FilterToolbarComponent,
    AttractionCardComponent,
    ClosedRidesPanelComponent,
    ParkHoursPanelComponent,
    ShowTimesPanelComponent,
    QuickStatsPanelComponent,
    ParkLlStatsPanelComponent,
  ],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  private readonly themeParksService = inject(ThemeParksService);
  private readonly historicalData = inject(HistoricalDataService);
  private readonly favoritesService = inject(FavoritesService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  selectedResort: ResortId = this.loadResort();
  selectedParkId = this.loadParkId();
  favoritesMode = this.loadFavoritesMode();
  activeTab: BottomNavTab = 'waits';
  favoriteCount = this.favoritesService.getSnapshot().size;

  search = '';
  sort: SortOption = 'shortest-wait';

  loading = true;
  error: string | null = null;
  lastRefreshed: Date | null = null;
  parkTimezone = RESORT_WEATHER_LOCATIONS[this.selectedResort].timezone;
  schedule: import('../../core/models/theme-parks.models').ScheduleEntry[] = [];
  parkLightningLanePricing: Record<string, ParkLightningLanePricing> = {};
  sparklineTrends: Record<string, WaitTimeSnapshot[]> = {};
  sparklineLastWaits: Record<string, WaitTimeSnapshot> = {};

  private readonly parkId$ = new BehaviorSubject<string>(this.selectedParkId);
  private readonly favoritesMode$ = new BehaviorSubject<boolean>(this.favoritesMode);
  private readonly sparklineParkIds$ = new BehaviorSubject<string[]>([]);
  private allAttractions: AttractionViewModel[] = [];

  readonly bottomNav: { id: BottomNavTab; label: string; icon: string }[] = [
    { id: 'waits', label: 'Waits', icon: 'pi pi-stopwatch' },
    { id: 'hours', label: 'Hours', icon: 'pi pi-calendar-clock' },
    { id: 'shows', label: 'Shows', icon: 'pi pi-video' },
    { id: 'stats', label: 'Stats', icon: 'pi pi-chart-bar' },
  ];

  ngOnInit(): void {
    this.applyResortTheme();

    combineLatest([this.favoritesMode$, this.parkId$])
      .pipe(
        switchMap(([favoritesMode, parkId]) => {
          if (favoritesMode) {
            return this.themeParksService
              .watchAllParks()
              .pipe(map((state) => ({ favoritesMode, state })));
          }

          return this.themeParksService
            .watchPark(parkId)
            .pipe(map((state) => ({ favoritesMode, parkId, state })));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((payload) => {
        if (payload.favoritesMode) {
          this.applyAllParksState(payload.state);
          return;
        }

        this.applySingleParkState(payload.parkId, payload.state);
      });

    this.favoritesService.favorites$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.favoriteCount = this.favoritesService.getSnapshot().size;
        this.rebuildViewModels();
      });

    this.themeParksService
      .watchWdwParkLightningLanePricing()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((pricing) => {
        this.parkLightningLanePricing = pricing;
      });

    combineLatest([
      this.sparklineParkIds$,
      interval(REFRESH_INTERVAL_MS).pipe(startWith(0)),
    ])
      .pipe(
        switchMap(([parkIds]) => {
          const ids = [...new Set(parkIds.filter(Boolean))];
          if (!ids.length) {
            return of({ trends: {}, lastWaits: {} });
          }

          return forkJoin({
            trends: this.historicalData.getSparklineTrendsForParks(ids, 6),
            lastWaits: this.historicalData.getLastKnownWaitsForParks(ids),
          });
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ trends, lastWaits }) => {
        this.sparklineTrends = trends;
        this.sparklineLastWaits = lastWaits;
      });
  }

  get parks(): ParkConfig[] {
    return getParksForResort(this.selectedResort);
  }

  get openAttractions(): AttractionViewModel[] {
    return this.filteredAttractions.filter((item) => isMainListAttraction(item));
  }

  get closedAttractions(): AttractionViewModel[] {
    return this.allAttractions.filter((item) => isClosedSectionAttraction(item));
  }

  get filteredAttractions(): AttractionViewModel[] {
    const filtered = filterAttractions(this.allAttractions, this.search, 'all', 'all');
    return sortAttractions(filtered, this.sort);
  }

  get shows(): AttractionViewModel[] {
    return this.allAttractions.filter((item) => isPerformanceShow(item));
  }

  get theme() {
    return RESORT_THEMES[this.selectedResort];
  }

  sparklineTrendFor(attractionId: string): WaitTimeSnapshot[] {
    return this.sparklineTrends[attractionId] ?? [];
  }

  sparklineLastWaitFor(attractionId: string): WaitTimeSnapshot | null {
    return this.sparklineLastWaits[attractionId] ?? null;
  }

  get emptyStateMessage(): string {
    if (this.favoritesMode) {
      return this.favoriteCount === 0
        ? 'Tap the star on any attraction to build your favorites list.'
        : 'No favorites match your current filters.';
    }

    return 'No matching attractions right now.';
  }

  onResortChange(resort: ResortId): void {
    this.selectedResort = resort;
    localStorage.setItem(PREF_KEYS.resort, resort);

    const resortParks = getParksForResort(resort);
    if (!resortParks.some((park) => park.id === this.selectedParkId)) {
      this.onParkChange(resortParks[0].id);
    } else {
      this.applyResortTheme();
      this.resetForNewDataSource();
      this.parkId$.next(this.selectedParkId);
    }
  }

  onParkChange(parkId: string): void {
    this.selectedParkId = parkId;
    localStorage.setItem(PREF_KEYS.park, parkId);
    this.applyResortTheme();
    this.resetForNewDataSource();
    this.parkId$.next(parkId);
  }

  onFavoritesModeChange(enabled: boolean): void {
    this.favoritesMode = enabled;
    localStorage.setItem(PREF_KEYS.favoritesMode, String(enabled));
    this.resetForNewDataSource();
    this.favoritesMode$.next(enabled);

    if (enabled) {
      this.activeTab = 'waits';
    }
  }

  onFavoriteToggle(id: string): void {
    this.favoritesService.toggleFavorite(id);
  }

  setActiveTab(tab: BottomNavTab): void {
    if (this.favoritesMode && tab !== 'waits') {
      return;
    }
    this.activeTab = tab;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private applySingleParkState(parkId: string, state: ParkDashboardState): void {
    this.loading = state.loading && this.allAttractions.length === 0;
    this.error = state.error;
    this.lastRefreshed = state.lastRefreshed;
    this.schedule = state.schedule;

    if (!state.loading && !state.error) {
      this.parkTimezone = state.timezone;
      this.sparklineParkIds$.next([parkId]);
      const parkConfig = getParkById(parkId);
      this.allAttractions = this.buildAttractionsFromPark(
        {
          parkId,
          parkName: parkConfig?.name ?? 'Park',
          parkShortName: parkConfig?.shortName ?? 'Park',
          resort: parkConfig?.resort ?? this.selectedResort,
          timezone: state.timezone,
          liveData: state.liveData,
          schedule: state.schedule,
          areaMap: state.areaMap,
          entityMetadata: state.entityMetadata,
        },
        false
      );
    }
  }

  private applyAllParksState(state: AllParksDashboardState): void {
    this.loading = state.loading && this.allAttractions.length === 0;
    this.error = state.error;
    this.lastRefreshed = state.lastRefreshed;
    this.schedule = [];

    if (!state.loading && !state.error) {
      this.parkTimezone =
        state.parks[0]?.timezone ??
        RESORT_WEATHER_LOCATIONS[this.selectedResort].timezone;
      this.parkLightningLanePricing = Object.fromEntries(
        state.parks.map((park) => [
          park.parkId,
          getParkLightningLanePricing(park.schedule, park.timezone),
        ])
      );
      this.sparklineParkIds$.next(state.parks.map((park) => park.parkId));
      this.allAttractions = state.parks.flatMap((park) =>
        this.buildAttractionsFromPark(park, true)
      );
    }
  }

  private buildAttractionsFromPark(
    park: ParkLiveBundle,
    favoritesOnly: boolean
  ): AttractionViewModel[] {
    const favoriteIds = this.favoritesService.getSnapshot();
    const resort = park.resort as ResortId;
    const lightningLanePurchases =
      resort === 'wdw'
        ? buildLightningLanePurchaseMap(park.schedule, park.timezone)
        : new Map();

    return park.liveData
      .filter(
        (item) =>
          isTrackableEntity(item, park.parkId, park.entityMetadata) &&
          (!favoritesOnly || favoriteIds.has(item.id))
      )
      .map((item) =>
        toAttractionViewModel(
          item,
          park.areaMap,
          favoriteIds,
          park.entityMetadata,
          {
            parkId: park.parkId,
            parkName: park.parkShortName,
            resort,
          },
          lightningLanePurchases
        )
      );
  }

  private rebuildViewModels(): void {
    const favoriteIds = this.favoritesService.getSnapshot();

    if (this.favoritesMode) {
      this.allAttractions = this.allAttractions
        .map((item) => ({
          ...item,
          isFavorite: favoriteIds.has(item.id),
        }))
        .filter((item) => favoriteIds.has(item.id));
      return;
    }

    this.allAttractions = this.allAttractions.map((item) => ({
      ...item,
      isFavorite: favoriteIds.has(item.id),
    }));
  }

  private applyResortTheme(): void {
    const park = getParkById(this.selectedParkId);
    const resort = park?.resort ?? this.selectedResort;
    const theme = RESORT_THEMES[resort];
    const root = this.host.nativeElement;
    root.style.setProperty('--accent-primary', theme.accent);
    root.style.setProperty('--accent-gold', theme.accentMuted);
    root.style.setProperty('--accent-glow', theme.accentGlow);
    root.style.setProperty('--resort-gradient', theme.gradient);
    root.style.setProperty('--resort-mesh', theme.mesh);
  }

  private loadResort(): ResortId {
    const stored = localStorage.getItem(PREF_KEYS.resort);
    return stored === 'universal' ? 'universal' : 'wdw';
  }

  private loadParkId(): string {
    const stored = localStorage.getItem(PREF_KEYS.park);
    if (stored && getParkById(stored)) {
      return stored;
    }
    const resort = this.loadResort();
    return getParksForResort(resort)[0]?.id ?? DEFAULT_PARK_ID;
  }

  private loadFavoritesMode(): boolean {
    return localStorage.getItem(PREF_KEYS.favoritesMode) === 'true';
  }

  private resetForNewDataSource(): void {
    this.allAttractions = [];
    this.loading = true;
    this.error = null;
    this.lastRefreshed = null;
    this.parkTimezone = RESORT_WEATHER_LOCATIONS[this.selectedResort].timezone;
    this.schedule = [];
    this.sparklineTrends = {};
    this.sparklineLastWaits = {};
    this.sparklineParkIds$.next([]);
  }
}