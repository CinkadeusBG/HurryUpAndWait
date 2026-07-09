import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnDestroy,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Chart } from 'chart.js/auto';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { getParkById, RESORT_THEMES } from '../../core/constants/park.constants';
import {
  AttractionHistoryBundle,
  IllDailySnapshot,
  WaitTimeSnapshot,
} from '../../core/models/historical.models';
import { HistoricalDataService } from '../../core/services/historical-data.service';
import { ThemeParksService } from '../../core/services/theme-parks.service';
import {
  buildBarChartConfig,
  buildIllDailyBarChartConfig,
  computeDayOfWeekAverages,
  computeFifteenMinuteAverages,
  destroyChart,
  getRecentEntries,
  getTodayEntries,
} from '../../core/utils/chart.utils';
import {
  averageIllPriceCents,
  formatIllLocalDate,
  formatIllPriceCents,
} from '../../core/utils/ill-display.utils';
import {
  LightningLanePriceInfo,
  buildLightningLanePurchaseMap,
  getLightningLanePrice,
} from '../../core/utils/lightning-lane.utils';
import { forkJoin } from 'rxjs';
import { WaitTrendChartComponent } from '../../shared/components/wait-trend-chart/wait-trend-chart.component';

@Component({
  selector: 'app-ride-detail',
  standalone: true,
  imports: [
    RouterLink,
    CardModule,
    SkeletonModule,
    MessageModule,
    WaitTrendChartComponent,
  ],
  templateUrl: './ride-detail.component.html',
  styleUrl: './ride-detail.component.scss',
})
export class RideDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly historicalData = inject(HistoricalDataService);
  private readonly themeParksService = inject(ThemeParksService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  parkId = '';
  attractionId = '';
  parkName = '';
  resortLabel = '';
  resort: 'wdw' | 'universal' = 'wdw';
  accent = RESORT_THEMES.wdw.accent;

  loading = true;
  error: string | null = null;
  history: AttractionHistoryBundle | null = null;
  illHistory: IllDailySnapshot[] = [];
  liveIllPrice: LightningLanePriceInfo | null = null;
  illLoading = true;
  timeZone = 'America/New_York';
  hasFifteenMinuteAverages = false;
  showIllSection = false;
  todayEntries: WaitTimeSnapshot[] = [];
  recentEntries: WaitTimeSnapshot[] = [];

  private fifteenMinuteBuckets: {
    label: string;
    averageWait: number | null;
  }[] = [];

  @ViewChild('fifteenMinuteCanvas') fifteenMinuteCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('dowCanvas') dowCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('illCanvas') illCanvas?: ElementRef<HTMLCanvasElement>;

  private fifteenMinuteChart: Chart<'bar'> | null = null;
  private dowChart: Chart<'bar'> | null = null;
  private illChart: Chart<'bar'> | null = null;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const parkId = params.get('parkId');
      const attractionId = params.get('attractionId');

      if (!parkId || !attractionId) {
        void this.router.navigate(['/']);
        return;
      }

      this.parkId = parkId;
      this.attractionId = attractionId;

      const park = getParkById(parkId);
      this.parkName = park?.shortName ?? 'Park';
      this.resort = park?.resort ?? 'wdw';
      this.resortLabel = RESORT_THEMES[this.resort].label;
      this.accent = RESORT_THEMES[this.resort].accent;

      this.loadHistory();
      this.loadIllData();
    });
  }

  ngAfterViewInit(): void {
    this.destroyRef.onDestroy(() => {
      destroyChart(this.fifteenMinuteChart);
      destroyChart(this.dowChart);
      destroyChart(this.illChart);
    });
  }

  ngOnDestroy(): void {
    destroyChart(this.fifteenMinuteChart);
    destroyChart(this.dowChart);
    destroyChart(this.illChart);
  }

  get hasHistory(): boolean {
    return (this.history?.entries.length ?? 0) > 0;
  }

  get hasIllHistory(): boolean {
    return this.illHistory.length > 0;
  }

  get liveIllPriceLabel(): string | null {
    return this.liveIllPrice?.formatted ?? null;
  }

  get liveIllSoldOut(): boolean {
    return this.liveIllPrice?.available === false;
  }

  get latestIllSnapshot(): IllDailySnapshot | null {
    if (!this.illHistory.length) {
      return null;
    }

    return this.illHistory[this.illHistory.length - 1];
  }

  get latestIllPriceLabel(): string | null {
    const latest = this.latestIllSnapshot;
    return latest ? formatIllPriceCents(latest.priceCents) : null;
  }

  get latestIllDateLabel(): string | null {
    const latest = this.latestIllSnapshot;
    return latest ? formatIllLocalDate(latest.localDate) : null;
  }

  get averageIllPriceLabel(): string | null {
    const average = averageIllPriceCents(this.illHistory);
    return average != null ? formatIllPriceCents(average) : null;
  }

  get illSoldOutDays(): number {
    return this.illHistory.filter((entry) => entry.soldOut).length;
  }

  private loadHistory(): void {
    this.loading = true;
    this.error = null;
    this.history = null;
    this.todayEntries = [];
    this.recentEntries = [];
    this.hasFifteenMinuteAverages = false;
    this.fifteenMinuteBuckets = [];

    this.historicalData
      .getAttractionHistory(this.parkId, this.attractionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (bundle) => {
          this.history = bundle;
          this.todayEntries = getTodayEntries(bundle.entries, this.timeZone);
          this.recentEntries = getRecentEntries(bundle.entries, 6, this.timeZone);
          this.prepareFifteenMinuteBuckets();
          this.loading = false;
          afterNextRender(() => this.renderAggregateCharts(), {
            injector: this.injector,
          });
        },
        error: () => {
          this.error = 'Unable to load historical wait times.';
          this.loading = false;
        },
      });
  }

  private loadIllData(): void {
    this.illHistory = [];
    this.liveIllPrice = null;
    this.illLoading = true;
    this.refreshIllSection();

    if (this.resort !== 'wdw') {
      this.illLoading = false;
      return;
    }

    this.historicalData
      .getAttractionIllHistory(this.parkId, this.attractionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entries) => {
        this.illHistory = entries;
        this.illLoading = false;
        this.refreshIllSection();
        afterNextRender(() => this.renderIllChart(), { injector: this.injector });
      });

    forkJoin({
      live: this.themeParksService.getLiveData(this.parkId),
      schedule: this.themeParksService.getSchedule(this.parkId),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ live, schedule }) => {
          const item = live.liveData.find((entry) => entry.id === this.attractionId);
          if (!item) {
            this.refreshIllSection();
            return;
          }

          const purchaseMap = buildLightningLanePurchaseMap(
            schedule.schedule,
            live.timezone
          );
          this.liveIllPrice = getLightningLanePrice(item, undefined, purchaseMap);
          this.refreshIllSection();
        },
        error: () => {
          this.liveIllPrice = null;
          this.refreshIllSection();
        },
      });
  }

  private refreshIllSection(): void {
    this.showIllSection =
      this.resort === 'wdw' &&
      (this.illHistory.length > 0 || !!this.liveIllPrice);
  }

  private prepareFifteenMinuteBuckets(): void {
    if (!this.history?.entries.length) {
      this.fifteenMinuteBuckets = [];
      this.hasFifteenMinuteAverages = false;
      return;
    }

    const fifteenMinute = computeFifteenMinuteAverages(
      this.history.entries,
      this.timeZone
    ).filter((bucket) => bucket.sampleCount > 0);

    this.fifteenMinuteBuckets = fifteenMinute;
    this.hasFifteenMinuteAverages = fifteenMinute.length > 0;
  }

  private renderIllChart(): void {
    if (!this.illCanvas || !this.illHistory.length) {
      return;
    }

    destroyChart(this.illChart);
    this.illChart = new Chart(
      this.illCanvas.nativeElement,
      buildIllDailyBarChartConfig(this.illHistory, {
        line: this.accent,
        fill: `${this.accent}33`,
        grid: 'rgba(255, 255, 255, 0.08)',
        text: '#8fa0c4',
      })
    );
  }

  private renderAggregateCharts(): void {
    if (!this.history?.entries.length) {
      return;
    }

    const palette = {
      line: this.accent,
      fill: `${this.accent}33`,
      grid: 'rgba(255, 255, 255, 0.08)',
      text: '#8fa0c4',
    };

    if (this.hasFifteenMinuteAverages) {
      this.renderFifteenMinuteChart();
    } else {
      destroyChart(this.fifteenMinuteChart);
      this.fifteenMinuteChart = null;
    }

    const dow = computeDayOfWeekAverages(this.history.entries, this.timeZone);
    const dowLabels = dow.map((bucket) => bucket.label);
    const dowValues = dow.map((bucket) => bucket.averageWait);

    if (this.dowCanvas) {
      destroyChart(this.dowChart);
      this.dowChart = new Chart(
        this.dowCanvas.nativeElement,
        buildBarChartConfig(dowLabels, dowValues, palette)
      );
    }
  }

  private renderFifteenMinuteChart(): void {
    if (!this.fifteenMinuteCanvas || !this.fifteenMinuteBuckets.length) {
      return;
    }

    const palette = {
      line: this.accent,
      fill: `${this.accent}33`,
      grid: 'rgba(255, 255, 255, 0.08)',
      text: '#8fa0c4',
    };

    destroyChart(this.fifteenMinuteChart);
    this.fifteenMinuteChart = new Chart(
      this.fifteenMinuteCanvas.nativeElement,
      buildBarChartConfig(
        this.fifteenMinuteBuckets.map((bucket) => bucket.label),
        this.fifteenMinuteBuckets.map((bucket) => bucket.averageWait),
        palette,
        {
          scales: {
            x: {
              ticks: {
                maxTicksLimit: 16,
                maxRotation: 45,
              },
            },
          },
        }
      )
    );
  }
}