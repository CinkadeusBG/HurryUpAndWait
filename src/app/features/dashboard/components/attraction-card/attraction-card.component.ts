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
import { CardModule } from 'primeng/card';
import { AttractionViewModel } from '../../../../core/models/theme-parks.models';
import {
  SHOW_TIME_PREVIEW_LIMIT,
  formatAttractionTypeLabel,
  formatEntityTypeLabel,
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
  imports: [CardModule],
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
  private readonly destroyRef = inject(DestroyRef);

  @Input({ required: true }) attraction!: AttractionViewModel;
  @Input() showParkName = false;
  @Output() favoriteToggle = new EventEmitter<string>();

  readonly showTimePreviewLimit = SHOW_TIME_PREVIEW_LIMIT;
  showAllTimes = false;
  private uiTick = 0;

  ngOnInit(): void {
    this.clock.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tick) => {
        this.uiTick = tick;
      });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['attraction']) {
      this.showAllTimes = false;
    }
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

  get operatingHoursLabel(): string | null {
    void this.uiTick;
    return getRelevantOperatingHoursLabel(this.attraction);
  }

  get relevantShowTimes(): string[] {
    void this.uiTick;
    return getRelevantShowTimes(this.attraction.showtimes);
  }

  get visibleShowTimes(): string[] {
    if (this.showAllTimes) {
      return this.relevantShowTimes;
    }
    return this.relevantShowTimes.slice(0, this.showTimePreviewLimit);
  }

  get hiddenShowTimeCount(): number {
    return Math.max(0, this.relevantShowTimes.length - this.showTimePreviewLimit);
  }

  get hasMoreShowTimes(): boolean {
    return this.hiddenShowTimeCount > 0;
  }

  toggleShowTimes(): void {
    this.showAllTimes = !this.showAllTimes;
  }

  onFavoriteClick(): void {
    this.favoriteToggle.emit(this.attraction.id);
  }
}