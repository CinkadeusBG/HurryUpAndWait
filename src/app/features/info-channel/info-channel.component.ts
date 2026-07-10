import { DatePipe, NgClass } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SharedModule } from 'primeng/api';
import { DialogModule } from 'primeng/dialog';
import { SliderModule } from 'primeng/slider';
import {
  BehaviorSubject,
  combineLatest,
  map,
  of,
  switchMap,
  takeWhile,
  timer,
} from 'rxjs';
import {
  APP_NAME,
  PARKS,
  ParkConfig,
  RESORT_THEMES,
  RESORT_WEATHER_LOCATIONS,
  ResortId,
  getParkById,
} from '../../core/constants/park.constants';
import { ResortForecastState } from '../../core/models/weather.models';
import {
  AllParksDashboardState,
  AttractionViewModel,
  ParkLiveBundle,
} from '../../core/models/theme-parks.models';
import { ClockService } from '../../core/services/clock.service';
import {
  HistoricalDataService,
  ParkCapacityHistoryRow,
} from '../../core/services/historical-data.service';
import { ParkCapacityService } from '../../core/services/park-capacity.service';
import { ThemeParksService } from '../../core/services/theme-parks.service';
import { WeatherService } from '../../core/services/weather.service';
import { WaitTimeSnapshot } from '../../core/models/historical.models';
import {
  formatDownDuration,
  formatDownSinceTime,
  formatParkClockTime,
  formatRelativeUpdated,
  formatShowTime,
  getStandbyWait,
  isClosedSectionAttraction,
  isLocalDateToday,
  isMainListAttraction,
  isTrackableEntity,
  toAttractionViewModel,
} from '../../core/utils/attraction.utils';
import {
  buildLightningLanePurchaseMap,
  getParkLightningLanePricing,
  hasLightningLanePricePair,
  type ParkLightningLanePricing,
} from '../../core/utils/lightning-lane.utils';
import { mergeParkLightningLanePricingWithSeenToday } from '../../core/utils/park-ll-pricing-cache.utils';
import {
  ParkCapacityScore,
  capacityLevelLabel,
  capacityLevelShortLabel,
} from '../../core/utils/park-capacity.utils';
import { ParkIconComponent } from '../dashboard/components/park-icon/park-icon.component';
import {
  BOARD_DEFAULT_ROTATION_MS,
  BOARD_MAX_ROTATION_MS,
  BOARD_MIN_ROTATION_MS,
  BOARD_ROTATION_STEP_MS,
  UP_NEXT_SHOWS_LIMIT,
  WAIT_BAND_META,
  WaitBandId,
} from './board.constants';
import {
  AvgWaitPoint,
  BoardAvgWaitChartComponent,
} from './components/board-avg-wait-chart/board-avg-wait-chart.component';
import { BoardBandMixChartComponent } from './components/board-band-mix-chart/board-band-mix-chart.component';
import {
  BoardNetworkChartComponent,
  NetworkParkAvg,
} from './components/board-network-chart/board-network-chart.component';
import { BoardWaitsChartComponent } from './components/board-waits-chart/board-waits-chart.component';
import { BoardWeatherChartComponent } from './components/board-weather-chart/board-weather-chart.component';
import { BoardSettingsService } from './services/board-settings.service';
import {
  BoardInsights,
  BoardParkHours,
  UpNextShow,
  averageLiveWaitForRides,
  bandRides,
  buildParkAverageWaitSeries,
  computeBoardInsights,
  ridesToAvoid,
  todayParkHours,
  topWaitsForChart,
  upNextShows,
} from './utils/board-data.utils';

@Component({
  selector: 'app-info-channel',
  standalone: true,
  imports: [
    DatePipe,
    NgClass,
    FormsModule,
    RouterLink,
    DialogModule,
    SharedModule,
    SliderModule,
    ParkIconComponent,
    BoardWaitsChartComponent,
    BoardAvgWaitChartComponent,
    BoardBandMixChartComponent,
    BoardNetworkChartComponent,
    BoardWeatherChartComponent,
  ],
  templateUrl: './info-channel.component.html',
  styleUrl: './info-channel.component.scss',
})
export class InfoChannelComponent implements OnInit {
  private readonly themeParks = inject(ThemeParksService);
  private readonly weather = inject(WeatherService);
  private readonly capacity = inject(ParkCapacityService);
  private readonly historicalData = inject(HistoricalDataService);
  private readonly clock = inject(ClockService);
  private readonly settings = inject(BoardSettingsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly appName = APP_NAME;
  readonly parks: readonly ParkConfig[] = PARKS;
  readonly waitBandMeta = WAIT_BAND_META;
  readonly waitBandOrder: WaitBandId[] = ['major', 'moderate', 'light'];
  readonly minRotationMs = BOARD_MIN_ROTATION_MS;
  readonly maxRotationMs = BOARD_MAX_ROTATION_MS;
  readonly rotationStepMs = BOARD_ROTATION_STEP_MS;

  parkIndex = 0;
  slideDirection: 'next' | 'prev' | 'none' = 'none';
  contentKey = 0;
  /** Soft park crossfade: idle → out → in → idle */
  transitionPhase: 'idle' | 'out' | 'in' = 'idle';
  settingsOpen = false;
  draftRotationSec = BOARD_DEFAULT_ROTATION_MS / 1000;
  rotationMs = BOARD_DEFAULT_ROTATION_MS;
  rotationProgress = 0;
  parkLocalTime = '';
  clockNow = new Date();

  loading = true;
  error: string | null = null;
  lastRefreshed: Date | null = null;

  allParksState: AllParksDashboardState | null = null;
  attractions: AttractionViewModel[] = [];
  scheduleHours: BoardParkHours[] = [];
  insights: BoardInsights = emptyInsights();
  avoidList: Array<AttractionViewModel & { reason: string }> = [];
  nextShows: UpNextShow[] = [];
  chartRides: AttractionViewModel[] = [];
  avgWaitSeries: AvgWaitPoint[] = [];
  networkParkAvgs: NetworkParkAvg[] = [];
  lightningLane: ParkLightningLanePricing | null = null;
  /** Per-ride wait change since the previous live poll (`up` / `down` / none). */
  waitTrendById: Record<string, 'up' | 'down'> = {};
  /** Last Turso standby snapshot per attraction — used for down “since / duration”. */
  lastKnownWaitsById: Record<string, WaitTimeSnapshot> = {};
  bandLists: Record<WaitBandId, AttractionViewModel[]> = {
    major: [],
    moderate: [],
    light: [],
  };

  /**
   * Prior standby waits for caret trends (seeded from Turso last-known, then
   * each live poll). Compared against the current live values in Live Wait Times.
   */
  private readonly previousWaits = new Map<string, number | null>();
  private lastTrendRefreshMs: number | null = null;
  private historyTrendSeeded = false;

  forecast: ResortForecastState = {
    loading: true,
    error: null,
    weather: null,
    hourly: [],
  };

  capacityScores: Record<string, ParkCapacityScore> = {};
  parkOpenByPark: Record<string, boolean> = {};

  private readonly parkIndex$ = new BehaviorSubject(0);
  private readonly rotationReset$ = new BehaviorSubject(0);
  private transitionTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.draftRotationSec = this.settings.rotationMs / 1000;
    this.rotationMs = this.settings.rotationMs;
    this.applyTheme();
    this.rebuildDerived();

    this.themeParks
      .watchAllParks()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        this.allParksState = state;
        this.loading = state.loading && !state.parks.length;
        this.error = state.error;
        this.lastRefreshed = state.lastRefreshed;
        this.rebuildDerived();
      });

    // Last-known waits: down-time labels + first-load trend caret baselines.
    this.historicalData
      .getLastKnownWaitsForParks(this.parks.map((park) => park.id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((lastWaits) => {
        this.lastKnownWaitsById = lastWaits;

        if (this.historyTrendSeeded) {
          return;
        }
        this.historyTrendSeeded = true;

        const historyBaseline = new Map<string, number>();
        for (const [attractionId, snapshot] of Object.entries(lastWaits)) {
          if (snapshot.waitTime !== null && Number.isFinite(snapshot.waitTime)) {
            historyBaseline.set(attractionId, snapshot.waitTime as number);
          }
        }

        if (!historyBaseline.size || !this.allParksState?.parks.length) {
          for (const [id, wait] of historyBaseline) {
            this.previousWaits.set(id, wait);
          }
          return;
        }

        if (this.lastTrendRefreshMs === null) {
          for (const [id, wait] of historyBaseline) {
            this.previousWaits.set(id, wait);
          }
          this.recomputeWaitTrendsFromBaseline();
          return;
        }

        this.waitTrendById = this.computeTrendsAgainst(historyBaseline);
      });

    this.parkIndex$
      .pipe(
        switchMap((index) => {
          const park = this.parks[index];
          const resort = park?.resort ?? 'wdw';
          return this.weather.watchResortForecast(resort);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((forecast) => {
        this.forecast = forecast;
      });

    this.parkIndex$
      .pipe(
        map((index) => this.parks[index]?.resort ?? 'wdw'),
        switchMap((resort) => this.capacity.watchResortParkCapacity(resort)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ scores, openByPark }) => {
        this.capacityScores = scores;
        this.parkOpenByPark = openByPark;
      });

    this.parkIndex$
      .pipe(
        switchMap((index) => {
          const park = this.parks[index];
          if (!park) {
            return of([] as ParkCapacityHistoryRow[]);
          }
          const timezone =
            this.currentBundle()?.timezone ??
            RESORT_WEATHER_LOCATIONS[park.resort].timezone;
          return this.historicalData.getParkCapacityHistoryRows(
            [park.id],
            timezone
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((rows) => {
        this.avgWaitSeries = buildParkAverageWaitSeries(
          rows,
          this.selectedPark.id,
          this.timezone,
          6
        );
      });

    this.clock.tick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.clockNow = new Date();
      this.parkLocalTime = formatParkClockTime(this.timezone);
      this.rebuildShows();
    });

    this.settings.rotationMs$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ms) => {
        this.rotationMs = ms;
        this.draftRotationSec = ms / 1000;
        this.rotationReset$.next(this.rotationReset$.value + 1);
      });

    combineLatest([this.settings.rotationMs$, this.rotationReset$])
      .pipe(
        switchMap(([ms]) => {
          const stepMs = 50;
          return timer(0, stepMs).pipe(
            map((tick) => {
              const elapsed = tick * stepMs;
              return {
                progress: Math.min(1, elapsed / ms),
                done: elapsed >= ms,
              };
            }),
            takeWhile((state) => !state.done, true)
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ progress, done }) => {
        this.rotationProgress = progress;
        if (done) {
          this.goNext('auto');
          this.resetRotationTimer();
        }
      });

    this.parkLocalTime = formatParkClockTime(this.timezone);
  }

  get selectedPark(): ParkConfig {
    return this.parks[this.parkIndex] ?? this.parks[0];
  }

  get resort(): ResortId {
    return this.selectedPark.resort;
  }

  get theme() {
    return RESORT_THEMES[this.resort];
  }

  get timezone(): string {
    const bundle = this.currentBundle();
    return bundle?.timezone ?? RESORT_WEATHER_LOCATIONS[this.resort].timezone;
  }

  get capacityScore(): ParkCapacityScore | null {
    if (!this.parkOpenByPark[this.selectedPark.id]) {
      return null;
    }
    return this.capacityScores[this.selectedPark.id] ?? null;
  }

  get capacityLabel(): string {
    const score = this.capacityScore;
    if (!this.parkOpenByPark[this.selectedPark.id]) {
      return 'Closed';
    }
    if (!score) {
      return '—';
    }
    return capacityLevelShortLabel(score.level);
  }

  /** Text color class for Park Pulse crowd word (matches main-app capacity palette). */
  get capacityWordClass(): string {
    if (!this.parkOpenByPark[this.selectedPark.id]) {
      return 'crowd-closed';
    }
    const score = this.capacityScore;
    switch (score?.level) {
      case 'low':
        return 'crowd-low';
      case 'moderate':
        return 'crowd-moderate';
      case 'high':
        return 'crowd-high';
      default:
        return 'crowd-unknown';
    }
  }

  get capacityDetail(): string {
    const score = this.capacityScore;
    if (!score) {
      return this.parkOpenByPark[this.selectedPark.id]
        ? 'Crowd data warming up'
        : 'Park appears closed right now';
    }
    return `${capacityLevelLabel(score.level)} · ${score.summary}`;
  }

  get liveStamp(): string {
    if (!this.lastRefreshed) {
      return 'Connecting…';
    }
    return formatRelativeUpdated(this.lastRefreshed.toISOString());
  }

  get closedCount(): number {
    return this.attractions.filter((item) => isClosedSectionAttraction(item))
      .length;
  }

  get openAttractionCount(): number {
    return this.attractions.filter((item) => isMainListAttraction(item)).length;
  }

  get networkOpenRides(): number {
    if (!this.allParksState?.parks.length) {
      return 0;
    }
    return this.allParksState.parks.reduce((sum, park) => {
      return (
        sum +
        park.liveData.filter(
          (item) =>
            item.entityType === 'ATTRACTION' && item.status === 'OPERATING'
        ).length
      );
    }, 0);
  }

  get showLightningLane(): boolean {
    return (
      this.resort === 'wdw' &&
      !!this.lightningLane &&
      hasLightningLanePricePair(
        this.lightningLane.multiPass,
        this.lightningLane.premierPass
      )
    );
  }

  get llIllCount(): number {
    return this.attractions.filter(
      (item) => !!item.lightningLanePrice || item.lightningLaneAvailable === false
    ).length;
  }

  bandList(band: WaitBandId): AttractionViewModel[] {
    return this.bandLists[band];
  }

  waitTrend(attractionId: string): 'up' | 'down' | null {
    return this.waitTrendById[attractionId] ?? null;
  }

  /**
   * Down-ride detail for Rides to Avoid (same rules as attraction cards):
   * last known standby today → “Since 2:15p” + “45 min”.
   */
  downDetailFor(
    ride: AttractionViewModel & { reason: string }
  ): { since: string; duration: string } | null {
    void this.clockNow;
    if (ride.reason !== 'Down' && ride.displayStatus !== 'Down') {
      return null;
    }

    const last = this.lastKnownWaitsById[ride.id];
    if (!last || !isLocalDateToday(last.timestamp, this.timezone)) {
      return null;
    }

    return {
      since: formatDownSinceTime(last.timestamp, this.timezone),
      duration: formatDownDuration(last.timestamp),
    };
  }

  /** Down but last standby wasn’t today (same as main app “Not opened yet”). */
  isDownNotOpenedYet(ride: AttractionViewModel & { reason: string }): boolean {
    if (ride.reason !== 'Down' && ride.displayStatus !== 'Down') {
      return false;
    }
    const last = this.lastKnownWaitsById[ride.id];
    return !!last && !isLocalDateToday(last.timestamp, this.timezone);
  }

  selectPark(index: number): void {
    if (index === this.parkIndex || index < 0 || index >= this.parks.length) {
      return;
    }
    this.changePark(index, index > this.parkIndex ? 'next' : 'prev', true);
  }

  goNext(source: 'auto' | 'manual' = 'manual'): void {
    const next = (this.parkIndex + 1) % this.parks.length;
    this.changePark(next, 'next', source === 'manual');
  }

  goPrev(): void {
    const prev = (this.parkIndex - 1 + this.parks.length) % this.parks.length;
    this.changePark(prev, 'prev', true);
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.settingsOpen) {
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.goNext('manual');
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.goPrev();
    }
  }

  openSettings(): void {
    this.draftRotationSec = this.rotationMs / 1000;
    this.settingsOpen = true;
  }

  saveSettings(): void {
    this.settings.setRotationMs(this.draftRotationSec * 1000);
    this.settingsOpen = false;
  }

  cancelSettings(): void {
    this.draftRotationSec = this.rotationMs / 1000;
    this.settingsOpen = false;
  }

  hourLabel(iso: string): string {
    return formatShowTime(iso, this.timezone).replace(/:00/, '');
  }

  /** Colorful emoji icons (not outline line icons). */
  weatherEmoji(variant: string): string {
    switch (variant) {
      case 'clear-day':
        return '☀️';
      case 'clear-night':
        return '🌙';
      case 'partly-cloudy-day':
        return '⛅';
      case 'partly-cloudy-night':
        return '☁️';
      case 'cloudy':
        return '☁️';
      case 'fog':
        return '🌫️';
      case 'rain':
        return '🌧️';
      case 'snow':
        return '❄️';
      case 'thunder':
        return '⛈️';
      default:
        return '🌤️';
    }
  }

  illTitle(ride: AttractionViewModel): string {
    if (ride.lightningLaneAvailable === false) {
      return 'Individual Lightning Lane sold out';
    }
    if (ride.lightningLanePrice) {
      return `Individual Lightning Lane ${ride.lightningLanePrice}`;
    }
    return 'Lightning Lane';
  }

  private changePark(
    index: number,
    direction: 'next' | 'prev',
    resetTimer: boolean
  ): void {
    if (index === this.parkIndex || this.transitionPhase !== 'idle') {
      return;
    }

    this.slideDirection = direction;
    if (this.transitionTimer) {
      clearTimeout(this.transitionTimer);
    }

    // Gentle crossfade: ease out current park, swap content, ease in next.
    this.transitionPhase = 'out';
    this.transitionTimer = setTimeout(() => {
      this.parkIndex = index;
      this.parkIndex$.next(index);
      this.contentKey += 1;
      this.applyTheme();
      this.rebuildDerived();
      if (resetTimer) {
        this.resetRotationTimer();
      } else {
        this.rotationProgress = 0;
      }

      this.transitionPhase = 'in';
      this.transitionTimer = setTimeout(() => {
        this.transitionPhase = 'idle';
        this.transitionTimer = null;
      }, 720);
    }, 280);
  }

  private resetRotationTimer(): void {
    this.rotationProgress = 0;
    this.rotationReset$.next(this.rotationReset$.value + 1);
  }

  private applyTheme(): void {
    const theme = RESORT_THEMES[this.resort];
    const root = this.host.nativeElement;
    root.style.setProperty('--accent-primary', theme.accent);
    root.style.setProperty('--accent-gold', theme.accentMuted);
    root.style.setProperty('--accent-glow', theme.accentGlow);
    root.style.setProperty('--resort-gradient', theme.gradient);
    root.style.setProperty('--resort-mesh', theme.mesh);
  }

  private currentBundle(): ParkLiveBundle | null {
    const parkId = this.selectedPark.id;
    return this.allParksState?.parks.find((park) => park.parkId === parkId) ?? null;
  }

  private rebuildDerived(): void {
    const bundle = this.currentBundle();
    if (!bundle) {
      this.attractions = [];
      this.scheduleHours = [];
      this.insights = emptyInsights();
      this.avoidList = [];
      this.nextShows = [];
      this.chartRides = [];
      this.networkParkAvgs = [];
      this.lightningLane = null;
      this.bandLists = { major: [], moderate: [], light: [] };
      this.parkLocalTime = formatParkClockTime(this.timezone);
      return;
    }

    const resort = (getParkById(bundle.parkId)?.resort ?? this.resort) as ResortId;
    const llMap =
      resort === 'wdw'
        ? buildLightningLanePurchaseMap(bundle.schedule, bundle.timezone)
        : new Map();

    this.attractions = bundle.liveData
      .filter((item) => isTrackableEntity(item, bundle.parkId, bundle.entityMetadata))
      .map((item) =>
        toAttractionViewModel(
          item,
          bundle.areaMap,
          new Set(),
          bundle.entityMetadata,
          {
            parkId: bundle.parkId,
            parkName: bundle.parkShortName,
            resort,
          },
          llMap
        )
      );

    this.scheduleHours = todayParkHours(bundle.schedule, resort, bundle.timezone);
    this.insights = computeBoardInsights(this.attractions);
    this.avoidList = ridesToAvoid(this.attractions);
    this.chartRides = topWaitsForChart(this.attractions);
    this.bandLists = {
      major: bandRides(this.attractions, 'major'),
      moderate: bandRides(this.attractions, 'moderate'),
      light: bandRides(this.attractions, 'light'),
    };
    this.updateWaitTrends(this.attractions);

    if (resort === 'wdw') {
      this.lightningLane = mergeParkLightningLanePricingWithSeenToday(
        getParkLightningLanePricing(bundle.schedule, bundle.timezone),
        bundle.parkId,
        bundle.timezone,
        bundle.schedule
      );
    } else {
      this.lightningLane = null;
    }

    this.networkParkAvgs = this.buildNetworkAverages();
    this.rebuildShows();
    this.parkLocalTime = formatParkClockTime(this.timezone);
  }

  private buildNetworkAverages(): NetworkParkAvg[] {
    if (!this.allParksState?.parks.length) {
      return [];
    }

    return this.parks.map((park) => {
      const bundle = this.allParksState?.parks.find((row) => row.parkId === park.id);
      const theme = RESORT_THEMES[park.resort];
      if (!bundle) {
        return {
          label: park.shortName.replace('Islands of Adventure', 'IoA'),
          averageWait: null,
          accent: theme.accent,
          active: park.id === this.selectedPark.id,
        };
      }

      const attractions = bundle.liveData
        .filter((item) =>
          isTrackableEntity(item, bundle.parkId, bundle.entityMetadata)
        )
        .map((item) =>
          toAttractionViewModel(
            item,
            bundle.areaMap,
            new Set(),
            bundle.entityMetadata,
            {
              parkId: bundle.parkId,
              parkName: bundle.parkShortName,
              resort: park.resort,
            }
          )
        );

      return {
        label: park.shortName
          .replace('Islands of Adventure', 'IoA')
          .replace('Hollywood Studios', 'DHS')
          .replace('Magic Kingdom', 'MK')
          .replace('Animal Kingdom', 'AK')
          .replace('Epic Universe', 'Epic')
          .replace('Studios', 'USF'),
        averageWait: averageLiveWaitForRides(attractions),
        accent: theme.accent,
        active: park.id === this.selectedPark.id,
      };
    });
  }

  private rebuildShows(): void {
    this.nextShows = upNextShows(
      this.attractions,
      UP_NEXT_SHOWS_LIMIT,
      Date.now(),
      this.timezone
    );
  }

  /**
   * Live Wait Times carets: compare current posted waits to the prior baseline
   * (Turso last-known, then each live poll). Recomputes only on new live data.
   */
  private updateWaitTrends(_attractions: AttractionViewModel[]): void {
    void _attractions;
    const refreshMs = this.lastRefreshed?.getTime() ?? null;
    if (refreshMs === null) {
      return;
    }

    const isNewRefresh = refreshMs !== this.lastTrendRefreshMs;
    if (!isNewRefresh) {
      // Park switch / re-render — keep existing carets for this poll cycle.
      return;
    }

    this.recomputeWaitTrendsFromBaseline();
    this.snapshotWaitBaseline();
    this.lastTrendRefreshMs = refreshMs;
  }

  /** Build up/down map from previousWaits vs current live operating rides. */
  private recomputeWaitTrendsFromBaseline(): void {
    this.waitTrendById = this.computeTrendsAgainst(this.previousWaits);
  }

  private computeTrendsAgainst(
    baseline: Map<string, number | null> | Map<string, number>
  ): Record<string, 'up' | 'down'> {
    const trends: Record<string, 'up' | 'down'> = {};
    if (!baseline.size || !this.allParksState?.parks.length) {
      return trends;
    }

    for (const park of this.allParksState.parks) {
      for (const item of park.liveData) {
        if (item.entityType !== 'ATTRACTION' || item.status !== 'OPERATING') {
          continue;
        }

        const wait = getStandbyWait(item);
        if (wait === null || !baseline.has(item.id)) {
          continue;
        }

        const previous = baseline.get(item.id);
        if (previous === undefined || previous === null) {
          continue;
        }

        if (wait > previous) {
          trends[item.id] = 'up';
        } else if (wait < previous) {
          trends[item.id] = 'down';
        }
      }
    }

    return trends;
  }

  private snapshotWaitBaseline(): void {
    for (const park of this.allParksState?.parks ?? []) {
      for (const item of park.liveData) {
        if (item.entityType !== 'ATTRACTION' || item.status !== 'OPERATING') {
          continue;
        }
        this.previousWaits.set(item.id, getStandbyWait(item));
      }
    }
  }
}

function emptyInsights(): BoardInsights {
  return {
    openRideCount: 0,
    downRideCount: 0,
    closedRideCount: 0,
    averageWait: null,
    medianWait: null,
    busiestRide: null,
    shortestRide: null,
    under15Count: 0,
    majorCount: 0,
    moderateCount: 0,
    lightCount: 0,
  };
}
