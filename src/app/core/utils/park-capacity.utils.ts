import { LiveDataItem, ScheduleEntry } from '../models/theme-parks.models';
import { WaitTimeSnapshot } from '../models/historical.models';
import {
  ParkLightningLanePricing,
  hasLightningLanePricePair,
} from './lightning-lane.utils';
import { getLocalHourMinute } from './chart.utils';
import { formatParkDateKey } from './attraction.utils';
import { isOmittedAttraction } from './omitted-attractions.utils';
import { WeatherIconVariant } from './weather.utils';

export type ParkCapacityLevel = 'low' | 'moderate' | 'high' | 'unknown';

export interface ParkCapacityWeatherContext {
  temperatureF: number;
  iconVariant: WeatherIconVariant;
  /** Max hourly precipitation probability over the next few hours (0–100). */
  precipProbabilityNext3h: number | null;
}

export interface ParkCapacityHistoryContext {
  baselineMedianWait: number | null;
  baselineSampleCount: number;
  trendDelta: number | null;
}

export interface ParkCapacityScore {
  parkId: string;
  level: ParkCapacityLevel;
  /** Composite crowd pressure index (0 = empty, 100 = slammed). */
  score: number;
  confidence: 'low' | 'medium' | 'high';
  summary: string;
}

interface WaitSampleMetrics {
  p50: number;
  p75: number;
  p90: number;
  heavyRatio: number;
  lightRatio: number;
  sampleCount: number;
  operatingRideCount: number;
}

const BASELINE_LOOKBACK_WEEKS = 6;
const BASELINE_HOUR_WINDOW = 1;
const TREND_LOOKBACK_HOURS = 3;
const TREND_RECENT_MINUTES = 45;
const TREND_EARLIER_START_HOURS = 2.5;
const TREND_EARLIER_END_HOURS = 3.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax === inMin) {
    return (outMin + outMax) / 2;
  }

  const ratio = (value - inMin) / (inMax - inMin);
  return outMin + ratio * (outMax - outMin);
}

function percentile(sortedValues: number[], percentileValue: number): number {
  if (!sortedValues.length) {
    return 0;
  }

  const index = (sortedValues.length - 1) * percentileValue;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function median(values: number[]): number | null {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  return percentile(sorted, 0.5);
}

function getStandbyWait(item: LiveDataItem): number | null {
  const wait = item.queue?.STANDBY?.waitTime;
  return typeof wait === 'number' && Number.isFinite(wait) ? wait : null;
}

function extractLiveWaitMetrics(liveData: LiveDataItem[]): WaitSampleMetrics | null {
  const rides = liveData.filter(
    (item) =>
      item.entityType === 'ATTRACTION' &&
      !isOmittedAttraction(item) &&
      item.status === 'OPERATING'
  );

  const waits = rides
    .map((item) => getStandbyWait(item))
    .filter((wait): wait is number => wait !== null)
    .sort((left, right) => left - right);

  if (waits.length < 4) {
    return null;
  }

  return {
    p50: percentile(waits, 0.5),
    p75: percentile(waits, 0.75),
    p90: percentile(waits, 0.9),
    heavyRatio: waits.filter((wait) => wait >= 60).length / waits.length,
    lightRatio: waits.filter((wait) => wait < 15).length / waits.length,
    sampleCount: waits.length,
    operatingRideCount: rides.length,
  };
}

function scoreLivePressure(metrics: WaitSampleMetrics): number {
  const p75Score = mapRange(metrics.p75, 12, 75, 18, 92);
  const p90Score = mapRange(metrics.p90, 20, 95, 20, 95);
  const heavyScore = mapRange(metrics.heavyRatio, 0, 0.45, 15, 92);
  const lightRelief = mapRange(metrics.lightRatio, 0, 0.55, 55, 18);

  return clamp(p75Score * 0.42 + p90Score * 0.28 + heavyScore * 0.2 + lightRelief * 0.1, 0, 100);
}

function scoreHistoricalRelative(
  currentP75: number,
  baselineMedianWait: number | null,
  baselineSampleCount: number
): number {
  if (!baselineMedianWait || baselineMedianWait <= 0 || baselineSampleCount < 20) {
    return 50;
  }

  const ratio = currentP75 / baselineMedianWait;
  return clamp(mapRange(ratio, 0.72, 1.35, 18, 88), 0, 100);
}

function scoreTrend(trendDelta: number | null): number {
  if (trendDelta === null) {
    return 50;
  }

  return clamp(mapRange(trendDelta, -18, 22, 22, 86), 0, 100);
}

function scoreWeatherAdjustment(
  weather: ParkCapacityWeatherContext | null | undefined,
  currentP75: number
): number {
  if (!weather) {
    return 0;
  }

  let adjustment = 0;
  const pleasant =
    (weather.iconVariant === 'clear-day' ||
      weather.iconVariant === 'partly-cloudy-day') &&
    weather.temperatureF >= 68 &&
    weather.temperatureF <= 88;
  const rainy =
    weather.iconVariant === 'rain' ||
    weather.iconVariant === 'thunder' ||
    (weather.precipProbabilityNext3h ?? 0) >= 55;
  const thunder = weather.iconVariant === 'thunder';
  const heatWave = weather.temperatureF >= 92;
  const cool = weather.temperatureF <= 58;

  if (pleasant) {
    adjustment += 7;
  }
  if (rainy) {
    adjustment -= currentP75 >= 45 ? 4 : 9;
  }
  if (thunder) {
    adjustment -= 6;
  }
  if (heatWave) {
    adjustment += 4;
  }
  if (cool) {
    adjustment -= 3;
  }
  if ((weather.precipProbabilityNext3h ?? 0) >= 70) {
    adjustment -= 5;
  } else if ((weather.precipProbabilityNext3h ?? 0) >= 40) {
    adjustment -= 2;
  }

  return clamp(adjustment, -12, 12);
}

function scoreDemandSignals(pricing: ParkLightningLanePricing | null | undefined): number {
  if (!pricing || !hasLightningLanePricePair(pricing.multiPass, pricing.premierPass)) {
    return 0;
  }

  let boost = 0;
  if (pricing.premierPassSoldOut) {
    boost += 10;
  }
  if (pricing.multiPassSoldOut) {
    boost += 6;
  }

  const multiPassAmount = parsePriceAmount(pricing.multiPass);
  if (multiPassAmount !== null) {
    boost += mapRange(multiPassAmount, 22, 48, 0, 8);
  }

  return clamp(boost, 0, 14);
}

function parsePriceAmount(price: string | null): number | null {
  if (!price) {
    return null;
  }

  const match = price.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function resolveLevel(score: number): ParkCapacityLevel {
  if (score < 42) {
    return 'low';
  }
  if (score < 64) {
    return 'moderate';
  }
  return 'high';
}

function resolveConfidence(
  metrics: WaitSampleMetrics,
  history: ParkCapacityHistoryContext
): ParkCapacityScore['confidence'] {
  if (metrics.sampleCount >= 12 && history.baselineSampleCount >= 60) {
    return 'high';
  }
  if (metrics.sampleCount >= 8 && history.baselineSampleCount >= 20) {
    return 'medium';
  }
  return 'low';
}

function buildSummary(
  level: ParkCapacityLevel,
  metrics: WaitSampleMetrics,
  history: ParkCapacityHistoryContext,
  weather: ParkCapacityWeatherContext | null | undefined
): string {
  const levelLabel =
    level === 'low'
      ? 'lighter crowds'
      : level === 'moderate'
        ? 'typical crowds'
        : level === 'high'
          ? 'heavy crowds'
          : 'unknown crowd level';

  const parts = [
    `${levelLabel} right now`,
    `median posted wait about ${Math.round(metrics.p50)} minutes`,
  ];

  if (history.baselineMedianWait) {
    const delta = Math.round(metrics.p75 - history.baselineMedianWait);
    if (delta > 8) {
      parts.push(`${delta} minutes busier than usual for this day and time`);
    } else if (delta < -8) {
      parts.push(`${Math.abs(delta)} minutes lighter than usual for this day and time`);
    }
  }

  if (history.trendDelta !== null) {
    if (history.trendDelta >= 8) {
      parts.push('waits have been climbing over the last few hours');
    } else if (history.trendDelta <= -8) {
      parts.push('waits have been easing over the last few hours');
    }
  }

  if (weather?.precipProbabilityNext3h && weather.precipProbabilityNext3h >= 50) {
    parts.push('rain in the forecast may thin crowds later');
  } else if (
    weather &&
    (weather.iconVariant === 'clear-day' || weather.iconVariant === 'partly-cloudy-day') &&
    weather.temperatureF >= 70 &&
    weather.temperatureF <= 86
  ) {
    parts.push('pleasant weather is keeping guests in the park');
  }

  return parts.join('; ');
}

/** Derives a multi-factor crowd level for one park. */
export function computeParkCapacityScore(input: {
  parkId: string;
  liveData: LiveDataItem[];
  weather?: ParkCapacityWeatherContext | null;
  history?: ParkCapacityHistoryContext;
  lightningLanePricing?: ParkLightningLanePricing | null;
}): ParkCapacityScore {
  const metrics = extractLiveWaitMetrics(input.liveData);
  if (!metrics) {
    return {
      parkId: input.parkId,
      level: 'unknown',
      score: 50,
      confidence: 'low',
      summary: 'Not enough live standby data to estimate crowd level',
    };
  }

  const history: ParkCapacityHistoryContext = input.history ?? {
    baselineMedianWait: null,
    baselineSampleCount: 0,
    trendDelta: null,
  };

  const liveScore = scoreLivePressure(metrics);
  const relativeScore = scoreHistoricalRelative(
    metrics.p75,
    history.baselineMedianWait,
    history.baselineSampleCount
  );
  const trendScore = scoreTrend(history.trendDelta);
  const weatherAdjustment = scoreWeatherAdjustment(input.weather, metrics.p75);
  const demandBoost = scoreDemandSignals(input.lightningLanePricing);

  const composite =
    liveScore * 0.36 +
    relativeScore * 0.28 +
    trendScore * 0.16 +
    mapRange(metrics.heavyRatio, 0, 0.4, 20, 90) * 0.12 +
    weatherAdjustment +
    demandBoost * 0.08;

  const score = clamp(composite, 0, 100);
  const level = resolveLevel(score);

  return {
    parkId: input.parkId,
    level,
    score: Math.round(score),
    confidence: resolveConfidence(metrics, history),
    summary: buildSummary(level, metrics, history, input.weather),
  };
}

export function getComparableLocalDatesForCapacity(
  timezone: string,
  now = new Date(),
  weeks = BASELINE_LOOKBACK_WEEKS
): string[] {
  const dayOfWeek = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  })
    .format(now)
    .trim();
  const dayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(dayOfWeek);
  return getComparableLocalDates(timezone, Math.max(dayIndex, 0), weeks, now);
}

function getComparableLocalDates(
  timezone: string,
  dayOfWeek: number,
  weeks: number,
  now: Date
): string[] {
  const dates: string[] = [];

  for (let dayOffset = 1; dayOffset <= weeks * 7 && dates.length < weeks; dayOffset++) {
    const probe = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(probe);
    const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
    const month = parts.find((part) => part.type === 'month')?.value ?? '01';
    const day = parts.find((part) => part.type === 'day')?.value ?? '01';
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
    }).format(probe);
    const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      weekday
    );

    if (weekdayIndex === dayOfWeek) {
      dates.push(`${year}-${month}-${day}`);
    }
  }

  return dates;
}

function isWithinHourWindow(
  timestamp: string,
  timezone: string,
  targetHour: number,
  windowHours: number
): boolean {
  const { hour } = getLocalHourMinute(timestamp, timezone);
  const delta = Math.abs(hour - targetHour);
  const wrapped = Math.min(delta, 24 - delta);
  return wrapped <= windowHours;
}

function aggregateParkMedianWaits(
  rows: WaitTimeSnapshot[],
  timezone: string,
  filter: (timestamp: string) => boolean
): number | null {
  const waits = rows
    .filter((row) => row.waitTime !== null && filter(row.timestamp))
    .map((row) => row.waitTime as number);

  return median(waits);
}

/** Builds baseline and trend context from Turso snapshot rows. */
export function buildParkCapacityHistoryContext(
  rows: WaitTimeSnapshot[],
  timezone: string,
  now = new Date()
): ParkCapacityHistoryContext {
  const { hour: currentHour } = getLocalHourMinute(now.toISOString(), timezone);
  const comparableDates = new Set(getComparableLocalDatesForCapacity(timezone, now));

  const baselineWaits = rows
    .filter((row) => {
      if (row.waitTime === null) {
        return false;
      }

      const localDate = formatParkDateKey(
        timezone,
        new Date(row.timestamp).getTime()
      );
      return (
        comparableDates.has(localDate) &&
        isWithinHourWindow(row.timestamp, timezone, currentHour, BASELINE_HOUR_WINDOW)
      );
    })
    .map((row) => row.waitTime as number);

  const nowMs = now.getTime();
  const recentCutoff = nowMs - TREND_RECENT_MINUTES * 60 * 1000;
  const earlierStart = nowMs - TREND_EARLIER_END_HOURS * 60 * 60 * 1000;
  const earlierEnd = nowMs - TREND_EARLIER_START_HOURS * 60 * 60 * 1000;
  const trendCutoff = nowMs - TREND_LOOKBACK_HOURS * 60 * 60 * 1000;

  const recentMedian = aggregateParkMedianWaits(rows, timezone, (timestamp) => {
    const ms = new Date(timestamp).getTime();
    return ms >= recentCutoff;
  });
  const earlierMedian = aggregateParkMedianWaits(rows, timezone, (timestamp) => {
    const ms = new Date(timestamp).getTime();
    return ms >= earlierStart && ms <= earlierEnd;
  });

  const trendDelta =
    recentMedian !== null &&
    earlierMedian !== null &&
    rows.some((row) => new Date(row.timestamp).getTime() >= trendCutoff)
      ? recentMedian - earlierMedian
      : null;

  return {
    baselineMedianWait: median(baselineWaits),
    baselineSampleCount: baselineWaits.length,
    trendDelta,
  };
}

/** Groups raw Turso rows by park id for capacity history analysis. */
export function groupCapacityHistoryByPark(
  rows: Array<WaitTimeSnapshot & { parkId: string }>
): Record<string, WaitTimeSnapshot[]> {
  const grouped: Record<string, WaitTimeSnapshot[]> = {};

  for (const row of rows) {
    const { parkId, ...snapshot } = row;
    const bucket = grouped[parkId] ?? [];
    bucket.push(snapshot);
    grouped[parkId] = bucket;
  }

  return grouped;
}

export function capacityLevelLabel(level: ParkCapacityLevel): string {
  switch (level) {
    case 'low':
      return 'Lighter crowds';
    case 'moderate':
      return 'Typical crowds';
    case 'high':
      return 'Heavy crowds';
    default:
      return 'Crowd level unknown';
  }
}

export function capacityLevelShortLabel(level: ParkCapacityLevel): string {
  switch (level) {
    case 'low':
      return 'Light';
    case 'moderate':
      return 'Moderate';
    case 'high':
      return 'Heavy';
    default:
      return 'Unknown';
  }
}

/** True when today's OPERATING schedule window includes the current moment. */
export function isParkOpenNow(
  schedule: ScheduleEntry[],
  timezone: string,
  now = Date.now()
): boolean {
  const today = formatParkDateKey(timezone, now);
  const operating = schedule.find(
    (entry) => entry.date === today && entry.type === 'OPERATING'
  );

  if (!operating?.openingTime || !operating?.closingTime) {
    return false;
  }

  const start = new Date(operating.openingTime).getTime();
  const end = new Date(operating.closingTime).getTime();

  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    now >= start &&
    now < end
  );
}