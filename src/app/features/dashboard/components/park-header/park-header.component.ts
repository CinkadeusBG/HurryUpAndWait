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
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { BehaviorSubject, filter, interval, switchMap } from 'rxjs';
import {
  APP_NAME,
  ParkConfig,
  REFRESH_INTERVAL_MS,
  RESORT_THEMES,
  ResortId,
} from '../../../../core/constants/park.constants';
import { ResortWeatherState } from '../../../../core/models/weather.models';
import { ClockService } from '../../../../core/services/clock.service';
import { WeatherService } from '../../../../core/services/weather.service';
import {
  formatParkClockTime,
  formatParkTimezoneAbbr,
  formatRelativeUpdated,
} from '../../../../core/utils/attraction.utils';

@Component({
  selector: 'app-park-header',
  standalone: true,
  imports: [FormsModule, SelectButtonModule],
  templateUrl: './park-header.component.html',
  styleUrl: './park-header.component.scss',
})
export class ParkHeaderComponent implements OnInit, OnChanges {
  private readonly clock = inject(ClockService);
  private readonly weatherService = inject(WeatherService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resort$ = new BehaviorSubject<ResortId | null>(null);
  private readonly refreshRingRadius = 9;
  private uiTick = 0;
  private progressTick = 0;

  weatherState: ResortWeatherState = {
    loading: true,
    error: null,
    weather: null,
  };

  @Input({ required: true }) selectedResort!: ResortId;
  @Input({ required: true }) selectedParkId!: string;
  @Input({ required: true }) parks!: ParkConfig[];
  @Input() lastRefreshed: Date | null = null;
  @Input() parkTimezone = 'America/New_York';
  @Input() favoritesMode = false;
  @Input() favoriteCount = 0;

  @Output() resortChange = new EventEmitter<ResortId>();
  @Output() parkChange = new EventEmitter<string>();
  @Output() favoritesModeChange = new EventEmitter<boolean>();

  readonly appName = APP_NAME;
  readonly refreshRingCircumference = 2 * Math.PI * this.refreshRingRadius;

  readonly resortOptions = [
    { label: 'Walt Disney World', value: 'wdw' as ResortId },
    { label: 'Universal Orlando', value: 'universal' as ResortId },
  ];

  constructor() {
    this.clock.tick$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((tick) => {
        this.uiTick = tick;
      });

    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.progressTick = Date.now();
      });

    this.resort$
      .pipe(
        filter((resort): resort is ResortId => resort !== null),
        switchMap((resort) => this.weatherService.watchResortWeather(resort)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((state) => {
        this.weatherState = state;
      });
  }

  ngOnInit(): void {
    this.resort$.next(this.selectedResort);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedResort']) {
      this.resort$.next(this.selectedResort);
    }
  }

  get theme() {
    return RESORT_THEMES[this.selectedResort];
  }

  parkLocalTime(): string {
    void this.uiTick;
    return formatParkClockTime(this.parkTimezone);
  }

  parkTimeAriaLabel(): string {
    return `Local park time ${this.parkLocalTime()} ${formatParkTimezoneAbbr(this.parkTimezone)}`;
  }

  weatherAriaLabel(): string {
    const weather = this.weatherState.weather;
    if (!weather) {
      return 'Weather unavailable';
    }

    return `${weather.temperatureF} degrees Fahrenheit, ${weather.label} at ${RESORT_THEMES[weather.resort].label}`;
  }

  refreshProgress(): number {
    void this.progressTick;
    if (!this.lastRefreshed) {
      return 0;
    }

    const elapsed = Date.now() - this.lastRefreshed.getTime();
    return Math.min(1, Math.max(0, elapsed / REFRESH_INTERVAL_MS));
  }

  refreshRingOffset(): number {
    return this.refreshRingCircumference * (1 - this.refreshProgress());
  }

  refreshAriaLabel(): string {
    void this.uiTick;
    if (!this.lastRefreshed) {
      return 'Waiting for first data refresh';
    }

    const elapsed = Date.now() - this.lastRefreshed.getTime();
    const remainingMs = Math.max(0, REFRESH_INTERVAL_MS - elapsed);
    const remainingMin = Math.ceil(remainingMs / 60000);
    const updated = formatRelativeUpdated(this.lastRefreshed.toISOString());

    if (remainingMs <= 0) {
      return `Updated ${updated}. Refreshing soon`;
    }

    return `Updated ${updated}. Next refresh in about ${remainingMin} minute${
      remainingMin === 1 ? '' : 's'
    }`;
  }

  onResortSelect(resort: ResortId): void {
    if (this.favoritesMode) {
      this.favoritesModeChange.emit(false);
    }
    if (resort !== this.selectedResort) {
      this.resortChange.emit(resort);
    }
  }

  onParkSelect(parkId: string): void {
    if (this.favoritesMode) {
      this.favoritesModeChange.emit(false);
    }
    if (parkId !== this.selectedParkId) {
      this.parkChange.emit(parkId);
    }
  }

  onFavoritesToggle(): void {
    this.favoritesModeChange.emit(!this.favoritesMode);
  }
}