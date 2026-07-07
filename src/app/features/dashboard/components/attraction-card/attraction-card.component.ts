import {
  Component,
  DestroyRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { OverlayPanelModule } from 'primeng/overlaypanel';
import { AttractionViewModel } from '../../../../core/models/theme-parks.models';
import { HistoricalDataService } from '../../../../core/services/historical-data.service';
import { WaitTimeSnapshot } from '../../../../core/models/historical.models';
import { WaitTrendChartComponent } from '../../../../shared/components/wait-trend-chart/wait-trend-chart.component';
import {
  SHOW_TIME_PREVIEW_LIMIT,
  formatAttractionTypeLabel,
  formatEntityTypeLabel,
  getEntityTypeIcon,
  formatWaitTime,
  getRelevantOperatingHoursLabel,
  getRelevantShowTimes,
  getWaitTimeClass,
  isContinuousExperience,
  isPerformanceShow,
} from '../../../../core/utils/attraction.utils';
import { ClockService } from '../../../../core/services/clock.service';

@Component({
  selector: 'app-attraction-card',
  standalone: true,
  imports: [CardModule, OverlayPanelModule, RouterLink, WaitTrendChartComponent],
  templateUrl: './attraction-card.component.html',
  styleUrl: './attraction-card.component.scss',
  host: {
    '[class.status-down]': 'attraction.displayStatus === "Down"',
    '[class.status-closed]': 'attraction.displayStatus === "Closed"',
    '[class.status-refurbishment]': 'attraction.displayStatus === "Refurbishment"',
  },
})
export class AttractionCardComponent implements OnInit, OnChanges {
  private readonly clock = inject(ClockService);
  private readonly historicalData = inject(HistoricalDataService);
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) attraction!: AttractionViewModel;
  @Input() showParkName = false;
  @Input() parkTimezone = 'America/New_York';
  @Output() favoriteToggle = new EventEmitter<string>();

  readonly showTimePreviewLimit = SHOW_TIME_PREVIEW_LIMIT;
  trendEntries: WaitTimeSnapshot[] = [];
  displayedWaitValue = '';
  waitValueFading = false;
  private uiTick = 0;
  private waitValueKey = '';
  private waitFadeTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly WAIT_FADE_MS = 160;

  ngOnInit(): void {
    this.syncDisplayedWait(false);
    this.clock.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tick) => {
        this.uiTick = tick;
      });
    this.destroyRef.onDestroy(() => {
      if (this.waitFadeTimer) {
        clearTimeout(this.waitFadeTimer);
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['attraction']) {
      const previous = changes['attraction'].previousValue as
        | AttractionViewModel
        | undefined;
      const isNewAttraction =
        !!previous && previous.id !== this.attraction.id;
      this.syncDisplayedWait(
        !changes['attraction'].firstChange && !isNewAttraction
      );
      this.loadTrendData();
    }
  }

  get detailLink(): string[] | null {
    const parkId = this.attraction.parkId;
    if (!parkId) {
      return null;
    }
    return ['/ride', parkId, this.attraction.id];
  }

  get showTrendChart(): boolean {
    return (
      !this.isPerformanceShow &&
      !this.isContinuousExperience &&
      !!this.attraction.parkId
    );
  }

  private loadTrendData(): void {
    const parkId = this.attraction.parkId;
    if (!parkId) {
      this.trendEntries = [];
      return;
    }

    this.historicalData
      .getRecentTrend(parkId, this.attraction.id, 6)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((entries) => {
        this.trendEntries = entries;
      });
  }

  get isContinuousExperience(): boolean {
    return isContinuousExperience(this.attraction);
  }

  get isPerformanceShow(): boolean {
    return isPerformanceShow(this.attraction);
  }

  get isOpen(): boolean {
    return this.attraction.displayStatus === 'Open';
  }

  get isDown(): boolean {
    return this.attraction.displayStatus === 'Down';
  }

  get statusChipClass(): string {
    switch (this.attraction.displayStatus) {
      case 'Down':
        return 'status-chip-down';
      case 'Refurbishment':
        return 'status-chip-refurbishment';
      default:
        return 'status-chip-closed';
    }
  }

  get entityTypeLabel(): string {
    return formatEntityTypeLabel(this.attraction.entityType, this.attraction);
  }

  get entityTypeIcon(): string {
    return getEntityTypeIcon(this.attraction.entityType, this.attraction);
  }

  get showStatusChip(): boolean {
    return !this.isOpen && !this.isDown;
  }

  get showAttractionType(): boolean {
    const type = this.attraction.attractionType?.trim();
    return !!type && type.toUpperCase() !== 'UNKNOWN';
  }

  get attractionTypeLabel(): string {
    return formatAttractionTypeLabel(this.attraction.attractionType ?? '');
  }

  get waitClass(): string {
    return getWaitTimeClass(this.attraction.waitTime, this.isOpen);
  }

  get waitDisplay(): string {
    return formatWaitTime(this.attraction.waitTime, this.isOpen);
  }

  private getWaitValueKey(): string {
    return `${this.attraction.displayStatus}|${this.attraction.waitTime ?? 'null'}`;
  }

  private getWaitValueText(): string {
    return this.isDown ? 'Down' : this.waitDisplay;
  }

  private syncDisplayedWait(animate: boolean): void {
    if (this.waitFadeTimer) {
      clearTimeout(this.waitFadeTimer);
      this.waitFadeTimer = null;
    }

    const nextKey = this.getWaitValueKey();
    const nextText = this.getWaitValueText();

    if (!animate || nextKey === this.waitValueKey) {
      this.waitValueFading = false;
      this.displayedWaitValue = nextText;
      this.waitValueKey = nextKey;
      return;
    }

    this.waitValueFading = true;
    this.waitFadeTimer = setTimeout(() => {
      this.waitFadeTimer = null;
      this.displayedWaitValue = nextText;
      this.waitValueKey = nextKey;
      this.waitValueFading = false;
    }, AttractionCardComponent.WAIT_FADE_MS);
  }

  get operatingHoursLabel(): string | null {
    void this.uiTick;
    return getRelevantOperatingHoursLabel(this.attraction);
  }

  get relevantShowTimes(): string[] {
    void this.uiTick;
    return getRelevantShowTimes(this.attraction.showtimes);
  }

  get previewShowTimes(): string[] {
    return this.relevantShowTimes.slice(0, this.showTimePreviewLimit);
  }

  get hiddenShowTimeCount(): number {
    return Math.max(0, this.relevantShowTimes.length - this.showTimePreviewLimit);
  }

  get hasMoreShowTimes(): boolean {
    return this.hiddenShowTimeCount > 0;
  }

  onFavoriteClick(): void {
    this.favoriteToggle.emit(this.attraction.id);
  }
}