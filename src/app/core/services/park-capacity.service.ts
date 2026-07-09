import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  combineLatest,
  filter,
  forkJoin,
  interval,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  take,
} from 'rxjs';
import {
  REFRESH_INTERVAL_MS,
  RESORT_WEATHER_LOCATIONS,
  ResortId,
  getParksForResort,
} from '../constants/park.constants';
import { ScheduleEntry } from '../models/theme-parks.models';
import { ParkLightningLanePricing } from '../utils/lightning-lane.utils';
import {
  ParkCapacityScore,
  ParkCapacityWeatherContext,
  buildParkCapacityHistoryContext,
  computeParkCapacityScore,
  groupCapacityHistoryByPark,
  isParkOpenNow,
} from '../utils/park-capacity.utils';

export interface ResortParkCapacityState {
  scores: Record<string, ParkCapacityScore>;
  openByPark: Record<string, boolean>;
}
import { HistoricalDataService } from './historical-data.service';
import { ThemeParksService } from './theme-parks.service';
import { WeatherService } from './weather.service';

@Injectable({ providedIn: 'root' })
export class ParkCapacityService {
  private readonly themeParksService = inject(ThemeParksService);
  private readonly historicalData = inject(HistoricalDataService);
  private readonly weatherService = inject(WeatherService);
  private readonly cache = new Map<
    ResortId,
    Observable<ResortParkCapacityBundle>
  >();

  /** Live crowd indicators and open/closed state per park for the selected resort. */
  watchResortParkCapacity(
    resort: ResortId,
    parkLightningLanePricing$: Observable<Record<string, ParkLightningLanePricing>> = of(
      {}
    )
  ): Observable<ResortParkCapacityState> {
    return combineLatest([
      this.watchResortParkCapacityBundle(resort),
      parkLightningLanePricing$.pipe(
        startWith({} as Record<string, ParkLightningLanePricing>)
      ),
      interval(30_000).pipe(startWith(0)),
    ]).pipe(
      map(([bundle, pricing]) => ({
        scores: Object.fromEntries(
          Object.entries(bundle.liveByPark).map(([parkId, liveData]) => [
            parkId,
            computeParkCapacityScore({
              parkId,
              liveData,
              weather: bundle.weather,
              history: buildParkCapacityHistoryContext(
                bundle.historyByPark[parkId] ?? [],
                bundle.timezone
              ),
              lightningLanePricing: pricing[parkId] ?? null,
            }),
          ])
        ),
        openByPark: Object.fromEntries(
          Object.entries(bundle.schedulesByPark).map(
            ([parkId, { schedule, timezone }]) => [
              parkId,
              isParkOpenNow(schedule, timezone),
            ]
          )
        ),
      }))
    );
  }

  private watchResortParkCapacityBundle(
    resort: ResortId
  ): Observable<ResortParkCapacityBundle> {
    if (!this.cache.has(resort)) {
      const parks = getParksForResort(resort);
      const parkIds = parks.map((park) => park.id);
      const timezone = RESORT_WEATHER_LOCATIONS[resort].timezone;

      const request$ = combineLatest([
        this.themeParksService.refreshTick$().pipe(startWith(undefined)),
        interval(REFRESH_INTERVAL_MS).pipe(startWith(0)),
      ]).pipe(
        switchMap(() =>
          forkJoin({
            live: forkJoin(
              parks.map((park) =>
                this.themeParksService.getLiveData(park.id).pipe(
                  map((response) => ({
                    parkId: park.id,
                    liveData: response.liveData,
                  })),
                  catchError(() =>
                    of({
                      parkId: park.id,
                      liveData: [],
                    })
                  )
                )
              )
            ),
            schedules: forkJoin(
              parks.map((park) =>
                this.themeParksService.getSchedule(park.id).pipe(
                  map((response) => ({
                    parkId: park.id,
                    schedule: response.schedule,
                    timezone: response.timezone,
                  })),
                  catchError(() =>
                    of({
                      parkId: park.id,
                      schedule: [] as ScheduleEntry[],
                      timezone,
                    })
                  )
                )
              )
            ),
            history: this.historicalData.getParkCapacityHistoryRows(
              parkIds,
              timezone
            ),
            weather: this.weatherService.watchResortWeather(resort).pipe(
              filter((state) => !state.loading),
              take(1),
              map((state) => state.weather),
              catchError(() => of(null))
            ),
          })
        ),
        map(({ live, schedules, history, weather }) => ({
          timezone,
          weather: toCapacityWeatherContext(weather),
          historyByPark: groupCapacityHistoryByPark(history),
          liveByPark: Object.fromEntries(
            live.map(({ parkId, liveData }) => [parkId, liveData])
          ),
          schedulesByPark: Object.fromEntries(
            schedules.map(({ parkId, schedule, timezone: parkTimezone }) => [
              parkId,
              { schedule, timezone: parkTimezone },
            ])
          ),
        })),
        shareReplay({ bufferSize: 1, refCount: true })
      );

      this.cache.set(resort, request$);
    }

    return this.cache.get(resort)!;
  }
}

interface ResortParkCapacityBundle {
  timezone: string;
  weather: ParkCapacityWeatherContext | null;
  historyByPark: ReturnType<typeof groupCapacityHistoryByPark>;
  liveByPark: Record<string, import('../models/theme-parks.models').LiveDataItem[]>;
  schedulesByPark: Record<
    string,
    { schedule: ScheduleEntry[]; timezone: string }
  >;
}

function toCapacityWeatherContext(
  weather: {
    temperatureF: number;
    iconVariant: ParkCapacityWeatherContext['iconVariant'];
    precipProbabilityNext3h: number | null;
  } | null
): ParkCapacityWeatherContext | null {
  if (!weather) {
    return null;
  }

  return {
    temperatureF: weather.temperatureF,
    iconVariant: weather.iconVariant,
    precipProbabilityNext3h: weather.precipProbabilityNext3h,
  };
}