import {
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
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
import { WaitTimeSnapshot } from '../../../../core/models/historical.models';
import { WaitTrendChartComponent } from '../../../../shared/components/wait-trend-chart/wait-trend-chart.component';
import { getParkById } from '../../../../core/constants/park.constants';
import {
  SHOW_TIME_PREVIEW_LIMIT,
  formatAttractionTypeLabel,
  formatDownDuration,
  formatDownSinceTime,
  formatEntityTypeLabel,
  isLocalDateToday,
  getEntityTypeIcon,
  formatWaitTime,
  getRelevantOperatingHoursLabel,
  getRelevantShowTimes,
  getWaitTimeClass,
  isContinuousExperience,
  isPerformanceShow,
  isRideEntity,
} from '../../../../core/utils/attraction.utils';
import { ClockService } from '../../../../core/services/clock.service';
import {
  SPARKLINE_MIN_POINTS,
  hasChartWaitValue,
} from '../../../../core/utils/chart.utils';

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
    '[class.is-user-hidden]': 'hidden',
  },
})
export class AttractionCardComponent implements OnInit, OnChanges {
  private readonly clock = inject(ClockService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly host = inject(ElementRef<HTMLElement>);
  private phoneQuery?: MediaQueryList;
  private swipePointerId: number | null = null;
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeTracking = false;
  private swipeAxis: 'x' | 'y' | null = null;
  private suppressClick = false;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SWIPE_LOCK_PX = 8;
  private static readonly SWIPE_COMMIT_PX = 72;
  private static readonly SWIPE_MAX_PX = 112;

  @Input({ required: true }) attraction!: AttractionViewModel;
  @Input() showParkName = false;
  @Input() parkTimezone = 'America/New_York';
  @Input() trendEntries: WaitTimeSnapshot[] = [];
  @Input() lastKnownWait: WaitTimeSnapshot | null = null;
  @Input() hidden = false;
  @Output() favoriteToggle = new EventEmitter<string>();
  @Output() hideToggle = new EventEmitter<string>();

  readonly showTimePreviewLimit = SHOW_TIME_PREVIEW_LIMIT;
  displayedWaitValue = '';
  waitValueFading = false;
  phoneLayout = false;
  swipeX = 0;
  swipeDragging = false;
  swipeNote = '';
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
    this.phoneQuery = window.matchMedia('(max-width: 720px)');
    this.phoneLayout = this.phoneQuery.matches;
    this.phoneQuery.addEventListener('change', this.onPhoneChange);
    this.host.nativeElement.addEventListener('click', this.onHostClick, true);
    this.destroyRef.onDestroy(() => {
      if (this.waitFadeTimer) {
        clearTimeout(this.waitFadeTimer);
      }
      if (this.noteTimer) {
        clearTimeout(this.noteTimer);
      }
      this.phoneQuery?.removeEventListener('change', this.onPhoneChange);
      this.host.nativeElement.removeEventListener('click', this.onHostClick, true);
    });
  }

  get swipeTransform(): string | null {
    return this.phoneLayout ? `translateX(${this.swipeX}px)` : null;
  }

  private readonly onPhoneChange = (event: MediaQueryListEvent): void => {
    this.ngZone.run(() => {
      this.phoneLayout = event.matches;
      if (!this.phoneLayout) {
        this.resetSwipe();
      }
    });
  };

  onSwipePointerDown(event: PointerEvent): void {
    if (!this.phoneLayout || event.button !== 0) {
      return;
    }

    if ((event.target as HTMLElement).closest('button')) {
      return;
    }

    this.swipePointerId = event.pointerId;
    this.swipeStartX = event.clientX;
    this.swipeStartY = event.clientY;
    this.swipeTracking = true;
    this.swipeAxis = null;
    this.swipeDragging = false;
  }

  onSwipePointerMove(event: PointerEvent): void {
    if (!this.swipeTracking || event.pointerId !== this.swipePointerId) {
      return;
    }

    const dx = event.clientX - this.swipeStartX;
    const dy = event.clientY - this.swipeStartY;
    if (!this.swipeAxis) {
      if (
        Math.abs(dx) < AttractionCardComponent.SWIPE_LOCK_PX &&
        Math.abs(dy) < AttractionCardComponent.SWIPE_LOCK_PX
      ) {
        return;
      }

      this.swipeAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (this.swipeAxis === 'y') {
        this.swipeTracking = false;
        return;
      }

      this.swipeDragging = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    if (this.swipeAxis !== 'x') {
      return;
    }

    const max = AttractionCardComponent.SWIPE_MAX_PX;
    this.swipeX = Math.max(-max, Math.min(max, dx));
  }

  onSwipePointerEnd(event: PointerEvent): void {
    if (event.pointerId !== this.swipePointerId) {
      return;
    }

    const dx = this.swipeX;
    const moved = this.swipeDragging;
    this.resetSwipe();
    if (!moved) {
      return;
    }

    this.suppressClick = true;
    if (dx >= AttractionCardComponent.SWIPE_COMMIT_PX) {
      const willFavorite = !this.attraction.isFavorite;
      this.favoriteToggle.emit(this.attraction.id);
      this.showSwipeNote(willFavorite ? 'Favorited' : 'Unfavorited');
      return;
    }

    if (dx <= -AttractionCardComponent.SWIPE_COMMIT_PX) {
      this.hideToggle.emit(this.attraction.id);
    }
  }

  private readonly onHostClick = (event: Event): void => {
    if (!this.suppressClick) {
      return;
    }

    this.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  private resetSwipe(): void {
    this.swipeTracking = false;
    this.swipeDragging = false;
    this.swipeAxis = null;
    this.swipePointerId = null;
    this.swipeX = 0;
  }

  private showSwipeNote(note: string): void {
    if (this.noteTimer) {
      clearTimeout(this.noteTimer);
    }

    this.swipeNote = note;
    this.noteTimer = setTimeout(() => {
      this.noteTimer = null;
      this.swipeNote = '';
    }, 900);
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
    const chartablePoints = this.trendEntries.filter(hasChartWaitValue).length;
    return (
      !this.isPerformanceShow &&
      !this.isContinuousExperience &&
      !!this.attraction.parkId &&
      chartablePoints >= SPARKLINE_MIN_POINTS
    );
  }

  get showLightningLanePrice(): boolean {
    return (
      this.isWdwRide &&
      !!this.attraction.lightningLanePrice &&
      !this.isPerformanceShow &&
      !this.isContinuousExperience
    );
  }

  get isWdwRide(): boolean {
    const parkId = this.attraction.parkId;
    if (!parkId) {
      return false;
    }
    return getParkById(parkId)?.resort === 'wdw' && isRideEntity(this.attraction.entityType);
  }

  get lightningLaneSoldOut(): boolean {
    return this.attraction.lightningLaneAvailable === false;
  }

  get lightningLaneAriaLabel(): string {
    const price = this.attraction.lightningLanePrice ?? '';
    if (this.lightningLaneSoldOut) {
      return `Individual Lightning Lane ${price}, sold out for today`;
    }
    return `Individual Lightning Lane ${price}`;
  }

  get showDownWaitDetail(): boolean {
    return (
      this.isDown &&
      !!this.lastKnownWait &&
      isLocalDateToday(this.lastKnownWait.timestamp, this.parkTimezone)
    );
  }

  get showNotOpenedYet(): boolean {
    return (
      this.isDown &&
      !!this.lastKnownWait &&
      !isLocalDateToday(this.lastKnownWait.timestamp, this.parkTimezone)
    );
  }

  get downSinceLabel(): string {
    void this.uiTick;
    if (!this.lastKnownWait) {
      return '';
    }
    return formatDownSinceTime(this.lastKnownWait.timestamp, this.parkTimezone);
  }

  get downDurationLabel(): string {
    void this.uiTick;
    if (!this.lastKnownWait) {
      return '';
    }
    return formatDownDuration(this.lastKnownWait.timestamp);
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

  onHideClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.hideToggle.emit(this.attraction.id);
  }
}