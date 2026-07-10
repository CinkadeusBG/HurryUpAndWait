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
  ResortForecastState,
  ResortWeatherState,
  WeatherHourlyPoint,
  WeatherSnapshot,
} from '../models/weather.models';
import { formatTemperatureF, mapWeatherCode } from '../utils/weather.utils';

@Injectable({ providedIn: 'root' })
export class WeatherService {
  private readonly cache = new Map<ResortId, Observable<ResortWeatherState>>();
  private readonly forecastCache = new Map<ResortId, Observable<ResortForecastState>>();

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

  /** Current conditions plus a short hourly strip (info-channel board). */
  watchResortForecast(resort: ResortId): Observable<ResortForecastState> {
    if (!this.forecastCache.has(resort)) {
      const request$ = interval(WEATHER_REFRESH_INTERVAL_MS).pipe(
        startWith(0),
        switchMap((pollIndex) => this.fetchResortForecast(resort, pollIndex === 0)),
        shareReplay({ bufferSize: 1, refCount: true })
      );
      this.forecastCache.set(resort, request$);
    }

    return this.forecastCache.get(resort)!;
  }

  private fetchResortWeather(
    resort: ResortId,
    showInitialLoading: boolean
  ): Observable<ResortWeatherState> {
    return this.fetchResortForecast(resort, showInitialLoading).pipe(
      map(
        (state): ResortWeatherState => ({
          loading: state.loading,
          error: state.error,
          weather: state.weather,
        })
      )
    );
  }

  private fetchResortForecast(
    resort: ResortId,
    showInitialLoading: boolean
  ): Observable<ResortForecastState> {
    const location = RESORT_WEATHER_LOCATIONS[resort];
    const params = new HttpParams()
      .set('latitude', location.latitude)
      .set('longitude', location.longitude)
      .set('current', 'temperature_2m,weather_code,is_day')
      .set('hourly', 'temperature_2m,precipitation_probability,weather_code')
      .set('forecast_hours', '8')
      .set('temperature_unit', 'fahrenheit')
      .set('timezone', location.timezone);

    const emptyState: ResortForecastState = {
      loading: true,
      error: null,
      weather: null,
      hourly: [],
    };

    const request$ = this.http
      .get<OpenMeteoCurrentResponse>(`${WEATHER_API_BASE_URL}/forecast`, { params })
      .pipe(
        map((response): ResortForecastState => {
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
            hourly: buildHourlyPoints(response, response.current.is_day === 1),
          };
        }),
        catchError(() =>
          of({
            loading: false,
            error: 'Weather unavailable',
            weather: null,
            hourly: [],
          } satisfies ResortForecastState)
        )
      );

    return showInitialLoading ? request$.pipe(startWith(emptyState)) : request$;
  }
}

function buildHourlyPoints(
  response: OpenMeteoCurrentResponse,
  fallbackIsDay: boolean
): WeatherHourlyPoint[] {
  const times = response.hourly?.time ?? [];
  const temps = response.hourly?.temperature_2m ?? [];
  const precip = response.hourly?.precipitation_probability ?? [];
  const codes = response.hourly?.weather_code ?? [];
  const currentMs = new Date(response.current.time).getTime();
  const points: WeatherHourlyPoint[] = [];

  for (let index = 0; index < times.length; index++) {
    const time = times[index];
    const hourMs = new Date(time).getTime();
    if (hourMs < currentMs) {
      continue;
    }

    const temp = temps[index];
    if (typeof temp !== 'number' || !Number.isFinite(temp)) {
      continue;
    }

    const code = typeof codes[index] === 'number' ? (codes[index] as number) : 0;
    const hour = new Date(time).getHours();
    const isDay = hour >= 6 && hour < 20 ? true : fallbackIsDay;
    const mapped = mapWeatherCode(code, isDay);
    const precipValue = precip[index];

    points.push({
      time,
      temperatureF: formatTemperatureF(temp),
      precipProbability:
        typeof precipValue === 'number' && Number.isFinite(precipValue)
          ? precipValue
          : null,
      label: mapped.label,
      iconVariant: mapped.iconVariant,
    });

    if (points.length >= 6) {
      break;
    }
  }

  return points;
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
