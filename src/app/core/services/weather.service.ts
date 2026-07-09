import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  Observable,
  catchError,
  interval,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import {
  RESORT_WEATHER_LOCATIONS,
  ResortId,
  WEATHER_API_BASE_URL,
  WEATHER_REFRESH_INTERVAL_MS,
} from '../constants/park.constants';
import {
  OpenMeteoCurrentResponse,
  ResortWeatherState,
  WeatherSnapshot,
} from '../models/weather.models';
import { formatTemperatureF, mapWeatherCode } from '../utils/weather.utils';

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly cache = new Map<ResortId, Observable<ResortWeatherState>>();

  constructor(private readonly http: HttpClient) {}

  /** Polls current conditions for the selected resort every 15 minutes. */
  watchResortWeather(resort: ResortId): Observable<ResortWeatherState> {
    if (!this.cache.has(resort)) {
      const request$ = interval(WEATHER_REFRESH_INTERVAL_MS).pipe(
        startWith(0),
        switchMap((pollIndex) => this.fetchResortWeather(resort, pollIndex === 0)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
      this.cache.set(resort, request$);
    }

    return this.cache.get(resort)!;
  }

  private fetchResortWeather(
    resort: ResortId,
    showInitialLoading: boolean
  ): Observable<ResortWeatherState> {
    const location = RESORT_WEATHER_LOCATIONS[resort];
    const params = new HttpParams()
      .set('latitude', location.latitude)
      .set('longitude', location.longitude)
      .set('current', 'temperature_2m,weather_code,is_day')
      .set('hourly', 'precipitation_probability')
      .set('forecast_hours', '6')
      .set('temperature_unit', 'fahrenheit')
      .set('timezone', location.timezone);

    const emptyState: ResortWeatherState = {
      loading: true,
      error: null,
      weather: null,
    };

    const request$ = this.http
      .get<OpenMeteoCurrentResponse>(`${WEATHER_API_BASE_URL}/forecast`, { params })
      .pipe(
        map((response): ResortWeatherState => {
          const { label, iconVariant } = mapWeatherCode(
            response.current.weather_code,
            response.current.is_day === 1
          );

          const weather: WeatherSnapshot = {
            resort,
            temperatureF: formatTemperatureF(response.current.temperature_2m),
            label,
            iconVariant,
            isDay: response.current.is_day === 1,
            observedAt: new Date(response.current.time),
            precipProbabilityNext3h: resolvePrecipProbabilityNext3h(
              response.current.time,
              response.hourly?.time ?? [],
              response.hourly?.precipitation_probability ?? []
            ),
          };

          return {
            loading: false,
            error: null,
            weather,
          };
        }),
        catchError(() =>
          of({
            loading: false,
            error: 'Weather unavailable',
            weather: null,
          } satisfies ResortWeatherState)
        )
      );

    return showInitialLoading ? request$.pipe(startWith(emptyState)) : request$;
  }
}

function resolvePrecipProbabilityNext3h(
  currentTime: string,
  hourlyTimes: string[],
  probabilities: Array<number | null>
): number | null {
  if (!hourlyTimes.length || !probabilities.length) {
    return null;
  }

  const currentMs = new Date(currentTime).getTime();
  const horizonMs = currentMs + 3 * 60 * 60 * 1000;
  const values: number[] = [];

  for (let index = 0; index < hourlyTimes.length; index++) {
    const hourMs = new Date(hourlyTimes[index]).getTime();
    if (hourMs < currentMs || hourMs > horizonMs) {
      continue;
    }

    const probability = probabilities[index];
    if (typeof probability === 'number' && Number.isFinite(probability)) {
      values.push(probability);
    }
  }

  return values.length ? Math.max(...values) : null;
}