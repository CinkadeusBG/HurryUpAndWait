import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Chart } from 'chart.js/auto';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { SkeletonModule } from 'primeng/skeleton';
import { getParkById, RESORT_THEMES } from '../../core/constants/park.constants';
import { AttractionHistoryBundle } from '../../core/models/historical.models';
import { HistoricalDataService } from '../../core/services/historical-data.service';
import {
  buildBarChartConfig,
  computeDayOfWeekAverages,
  computeHourlyAverages,
  destroyChart,
  getRecentEntries,
  getTodayEntries,
} from '../../core/utils/chart.utils';
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
  private readonly destroyRef = inject(DestroyRef);

  parkId = '';
  attractionId = '';
  parkName = '';
  resortLabel = '';
  accent = RESORT_THEMES.wdw.accent;

  loading = true;
  error: string | null = null;
  history: AttractionHistoryBundle | null = null;
  timeZone = 'America/New_York';

  @ViewChild('hourlyCanvas') hourlyCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('dowCanvas') dowCanvas?: ElementRef<HTMLCanvasElement>;

  private hourlyChart: Chart<'bar'> | null = null;
  private dowChart: Chart<'bar'> | null = null;

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
      const resort = park?.resort ?? 'wdw';
      this.resortLabel = RESORT_THEMES[resort].label;
      this.accent = RESORT_THEMES[resort].accent;

      this.loadHistory();
    });
  }

  ngAfterViewInit(): void {
    this.destroyRef.onDestroy(() => {
      destroyChart(this.hourlyChart);
      destroyChart(this.dowChart);
    });
  }

  ngOnDestroy(): void {
    destroyChart(this.hourlyChart);
    destroyChart(this.dowChart);
  }

  get todayEntries() {
    return this.history
      ? getTodayEntries(this.history.entries, this.timeZone)
      : [];
  }

  get recentEntries() {
    return this.history
      ? getRecentEntries(this.history.entries, 6, this.timeZone)
      : [];
  }

  get hasHistory(): boolean {
    return (this.history?.entries.length ?? 0) > 0;
  }

  private loadHistory(): void {
    this.loading = true;
    this.error = null;

    this.historicalData
      .getAttractionHistory(this.parkId, this.attractionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (bundle) => {
          this.history = bundle;
          this.loading = false;
          queueMicrotask(() => this.renderAggregateCharts());
        },
        error: () => {
          this.error = 'Unable to load historical wait times.';
          this.loading = false;
        },
      });
  }

  private renderAggregateCharts(): void {
    if (!this.history?.entries.length) {
      return;
    }

    const hourly = computeHourlyAverages(this.history.entries, this.timeZone).filter(
      (bucket) => bucket.sampleCount > 0
    );
    const hourlyLabels = hourly.map((bucket) => bucket.label);
    const hourlyValues = hourly.map((bucket) => bucket.averageWait);

    if (this.hourlyCanvas) {
      destroyChart(this.hourlyChart);
      this.hourlyChart = new Chart(
        this.hourlyCanvas.nativeElement,
        buildBarChartConfig(hourlyLabels, hourlyValues, {
          line: this.accent,
          fill: `${this.accent}33`,
          grid: 'rgba(255, 255, 255, 0.08)',
          text: '#8fa0c4',
        })
      );
    }

    const dow = computeDayOfWeekAverages(this.history.entries, this.timeZone);
    const dowLabels = dow.map((bucket) => bucket.label);
    const dowValues = dow.map((bucket) => bucket.averageWait);

    if (this.dowCanvas) {
      destroyChart(this.dowChart);
      this.dowChart = new Chart(
        this.dowCanvas.nativeElement,
        buildBarChartConfig(dowLabels, dowValues, {
          line: this.accent,
          fill: `${this.accent}33`,
          grid: 'rgba(255, 255, 255, 0.08)',
          text: '#8fa0c4',
        })
      );
    }
  }
}