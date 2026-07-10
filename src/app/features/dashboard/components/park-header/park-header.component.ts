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
import { RouterLink } from '@angular/router';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ParkIconComponent } from '../park-icon/park-icon.component';
import { BehaviorSubject, filter, interval, switchMap } from 'rxjs';
import {
  APP_NAME,
  ParkConfig,
  REFRESH_INTERVAL_MS,
  RESORT_THEMES,
  ResortId,
} from '../../../../core/constants/park.constants';
import {
  ParkLightningLanePricing,
  hasLightningLanePricePair,
} from '../../../../core/utils/lightning-lane.utils';
import {
  ParkCapacityScore,
  capacityLevelLabel,
} from '../../../../core/utils/park-capacity.utils';
import { ResortWeatherState } from '../../../../core/models/weather.models';
import { WeatherService } from '../../../../core/services/weather.service';
import {
  formatParkClockTime,
  formatParkTimezoneAbbr,
  formatRelativeUpdated,
} from '../../../../core/utils/attraction.utils';

@Component({
  selector: 'app-park-header',
  standalone: true,
  imports: [FormsModule, RouterLink, SelectButtonModule, ParkIconComponent],
  templateUrl: './park-header.component.html',
  styleUrl: './park-header.component.scss',
})
export class ParkHeaderComponent implements OnInit, OnChanges {
  private readonly weatherService = inject(WeatherService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly resort$ = new BehaviorSubject<ResortId | null>(null);
  private readonly refreshRingRadius = 9;
  parkLocalTime = '';
  refreshRingOffset = 2 * Math.PI * 9;
  refreshAriaLabelText = 'Waiting for first data refresh';

  weatherState: ResortWeatherState = {
    loading: true,
    error: null,
    weather: null,
  };

  @Input({ required: true }) selectedResort!: ResortId;
  @Input({ required: true }) selectedParkId!: string;
  @Input({ required: true }) parks!: ParkConfig[];
  @Input() parkLightningLanePricing: Record<string, ParkLightningLanePricing> =
    {};
  @Input() parkCapacityScores: Record<string, ParkCapacityScore> = {};
  @Input() parkOpenByPark: Record<string, boolean> = {};
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
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.syncTimeBoundValues();
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
    this.syncTimeBoundValues();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['selectedResort']) {
      this.resort$.next(this.selectedResort);
    }

    if (changes['lastRefreshed'] || changes['parkTimezone']) {
      // Defer so parent async updates don't trip dev-mode change detection.
      setTimeout(() => this.syncTimeBoundValues());
    }
  }

  get theme() {
    return RESORT_THEMES[this.selectedResort];
  }

  get showParkLightningLanePricing(): boolean {
    return this.selectedResort === 'wdw' && !this.favoritesMode;
  }

  parkLightningLanePrices(parkId: string): ParkLightningLanePricing | null {
    const pricing = this.parkLightningLanePricing[parkId];
    if (!pricing || !hasLightningLanePricePair(pricing.multiPass, pricing.premierPass)) {
      return null;
    }
    return pricing;
  }

  parkCapacityScore(parkId: string): ParkCapacityScore | null {
    if (!this.parkOpenByPark[parkId]) {
      return null;
    }

    return this.parkCapacityScores[parkId] ?? null;
  }

  parkCapacityAriaLabel(park: ParkConfig): string | null {
    const score = this.parkCapacityScore(park.id);
    if (!score || this.favoritesMode) {
      return null;
    }

    return `${park.shortName} crowd level: ${capacityLevelLabel(score.level)}. ${score.summary}`;
  }

  parkLightningLaneAriaLabel(park: ParkConfig): string | null {
    const pricing = this.parkLightningLanePrices(park.id);
    if (!pricing) {
      return null;
    }

    const parts: string[] = [];
    if (pricing.multiPass) {
      const status = pricing.multiPassSoldOut ? ', sold out' : '';
      parts.push(`Multi Pass ${pricing.multiPass}${status}`);
    }
    if (pricing.premierPass) {
      const status = pricing.premierPassSoldOut ? ', sold out' : '';
      parts.push(`Premier Pass ${pricing.premierPass}${status}`);
    }

    return `Lightning Lane at ${park.shortName} today: ${parts.join(', ')}`;
  }

  parkTimeAriaLabel(): string {
    return `Local park time ${this.parkLocalTime} ${formatParkTimezoneAbbr(this.parkTimezone)}`;
  }

  weatherAriaLabel(): string {
    const weather = this.weatherState.weather;
    if (!weather) {
      return 'Weather unavailable';
    }

    return `${weather.temperatureF} degrees Fahrenheit, ${weather.label} at ${RESORT_THEMES[weather.resort].label}`;
  }

  private syncTimeBoundValues(): void {
    this.parkLocalTime = formatParkClockTime(this.parkTimezone);
    this.refreshRingOffset = this.computeRefreshRingOffset();
    this.refreshAriaLabelText = this.buildRefreshAriaLabel();
  }

  private computeRefreshRingOffset(): number {
    if (!this.lastRefreshed) {
      return this.refreshRingCircumference;
    }

    const elapsed = Date.now() - this.lastRefreshed.getTime();
    const progress = Math.min(1, Math.max(0, elapsed / REFRESH_INTERVAL_MS));
    return this.refreshRingCircumference * (1 - progress);
  }

  private buildRefreshAriaLabel(): string {
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