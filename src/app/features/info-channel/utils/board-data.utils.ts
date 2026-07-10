import { AttractionViewModel, ScheduleEntry } from '../../../core/models/theme-parks.models';
import {
  formatParkDateKey,
  formatScheduleEntryLabel,
  formatScheduleEntrySubtitle,
  formatShowTime,
  getRelevantShowTimes,
  isMainListAttraction,
  isPerformanceShow,
  isRideEntity,
} from '../../../core/utils/attraction.utils';
import { ResortId } from '../../../core/constants/park.constants';
import {
  RIDES_TO_AVOID_LIMIT,
  TOP_WAITS_CHART_LIMIT,
  UP_NEXT_SHOWS_LIMIT,
  WAIT_BAND_LIST_LIMIT,
  WAIT_BAND_THRESHOLDS,
  WaitBandId,
} from '../board.constants';

export function classifyWaitBand(waitTime: number | null): WaitBandId {
  if (waitTime === null || waitTime <= WAIT_BAND_THRESHOLDS.lightMax) {
    return 'light';
  }
  if (waitTime <= WAIT_BAND_THRESHOLDS.moderateMax) {
    return 'moderate';
  }
  return 'major';
}

export function operatingRides(attractions: AttractionViewModel[]): AttractionViewModel[] {
  return attractions.filter(
    (item) =>
      isRideEntity(item.entityType) &&
      item.displayStatus === 'Open' &&
      isMainListAttraction(item)
  );
}

export function openRidesWithPostedWait(
  attractions: AttractionViewModel[]
): AttractionViewModel[] {
  return operatingRides(attractions).filter((item) => item.waitTime !== null);
}

export function bandRides(
  attractions: AttractionViewModel[],
  band: WaitBandId,
  limit = WAIT_BAND_LIST_LIMIT
): AttractionViewModel[] {
  return openRidesWithPostedWait(attractions)
    .filter((item) => classifyWaitBand(item.waitTime) === band)
    .sort((a, b) => (b.waitTime ?? 0) - (a.waitTime ?? 0))
    .slice(0, limit);
}

/** Longest waits + down rides — what to skip right now. */
export function ridesToAvoid(
  attractions: AttractionViewModel[],
  limit = RIDES_TO_AVOID_LIMIT
): Array<AttractionViewModel & { reason: string }> {
  const down = attractions
    .filter((item) => isRideEntity(item.entityType) && item.displayStatus === 'Down')
    .map((item) => ({ ...item, reason: 'Down' }));

  const major = openRidesWithPostedWait(attractions)
    .filter((item) => classifyWaitBand(item.waitTime) === 'major')
    .sort((a, b) => (b.waitTime ?? 0) - (a.waitTime ?? 0))
    .map((item) => ({ ...item, reason: `${item.waitTime} min` }));

  const merged = [...down, ...major];
  const seen = new Set<string>();
  const unique: Array<AttractionViewModel & { reason: string }> = [];

  for (const item of merged) {
    if (seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
    if (unique.length >= limit) {
      break;
    }
  }

  return unique;
}

export interface UpNextShow {
  id: string;
  name: string;
  nextTime: string;
  moreCount: number;
}

export function upNextShows(
  attractions: AttractionViewModel[],
  limit = UP_NEXT_SHOWS_LIMIT
): UpNextShow[] {
  return attractions
    .filter((item) => isPerformanceShow(item))
    .map((show) => {
      const times = getRelevantShowTimes(show.showtimes);
      if (!times.length) {
        return null;
      }
      return {
        id: show.id,
        name: show.name,
        nextTime: times[0],
        moreCount: Math.max(0, times.length - 1),
      } satisfies UpNextShow;
    })
    .filter((item): item is UpNextShow => item !== null)
    .sort((a, b) => a.nextTime.localeCompare(b.nextTime))
    .slice(0, limit);
}

export interface BoardParkHours {
  label: string;
  subtitle: string | null;
  openLabel: string;
  closeLabel: string;
  type: string;
}

export function todayParkHours(
  schedule: ScheduleEntry[],
  resort: ResortId,
  timezone: string
): BoardParkHours[] {
  const today = formatParkDateKey(timezone);
  return schedule
    .filter((entry) => entry.date === today)
    .map((entry) => ({
      label: formatScheduleEntryLabel(entry, resort),
      subtitle: formatScheduleEntrySubtitle(entry, resort),
      openLabel: entry.openingTime ? formatShowTime(entry.openingTime, timezone) : '—',
      closeLabel: entry.closingTime ? formatShowTime(entry.closingTime, timezone) : '—',
      type: entry.type,
    }));
}

export interface BoardInsights {
  openRideCount: number;
  downRideCount: number;
  closedRideCount: number;
  averageWait: number | null;
  medianWait: number | null;
  busiestRide: AttractionViewModel | null;
  shortestRide: AttractionViewModel | null;
  under15Count: number;
  majorCount: number;
  moderateCount: number;
  lightCount: number;
}

export function computeBoardInsights(
  attractions: AttractionViewModel[]
): BoardInsights {
  const rides = attractions.filter((item) => isRideEntity(item.entityType));
  const open = rides.filter((item) => item.displayStatus === 'Open');
  const down = rides.filter((item) => item.displayStatus === 'Down');
  const closed = rides.filter(
    (item) => item.displayStatus === 'Closed' || item.displayStatus === 'Refurbishment'
  );
  const withWait = open
    .filter((item) => item.waitTime !== null)
    .sort((a, b) => (b.waitTime ?? 0) - (a.waitTime ?? 0));

  const waits = withWait.map((item) => item.waitTime as number);
  const averageWait =
    waits.length > 0
      ? Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length)
      : null;

  const medianWait =
    waits.length > 0
      ? (() => {
          const sorted = [...waits].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 === 0
            ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
            : sorted[mid];
        })()
      : null;

  return {
    openRideCount: open.length,
    downRideCount: down.length,
    closedRideCount: closed.length,
    averageWait,
    medianWait,
    busiestRide: withWait[0] ?? null,
    shortestRide: withWait.length
      ? [...withWait].sort((a, b) => (a.waitTime ?? 0) - (b.waitTime ?? 0))[0]
      : null,
    under15Count: waits.filter((wait) => wait < 15).length,
    majorCount: withWait.filter((item) => classifyWaitBand(item.waitTime) === 'major')
      .length,
    moderateCount: withWait.filter(
      (item) => classifyWaitBand(item.waitTime) === 'moderate'
    ).length,
    lightCount: withWait.filter((item) => classifyWaitBand(item.waitTime) === 'light')
      .length,
  };
}

export function topWaitsForChart(
  attractions: AttractionViewModel[],
  limit = TOP_WAITS_CHART_LIMIT
): AttractionViewModel[] {
  return openRidesWithPostedWait(attractions)
    .sort((a, b) => (b.waitTime ?? 0) - (a.waitTime ?? 0))
    .slice(0, limit);
}

export function shortenAttractionName(name: string, max = 28): string {
  if (name.length <= max) {
    return name;
  }
  return `${name.slice(0, max - 1).trimEnd()}…`;
}

export interface AvgWaitSeriesPoint {
  label: string;
  wait: number;
  timestampMs: number;
}

/**
 * Buckets historical operating wait rows into park-wide average wait over time
 * (15-minute slots) for the park-pulse trend chart.
 */
export function buildParkAverageWaitSeries(
  rows: Array<{ timestamp: string; waitTime: number | null; parkId?: string }>,
  parkId: string,
  timezone: string,
  hours = 6
): AvgWaitSeriesPoint[] {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const bucketMs = 15 * 60 * 1000;
  const buckets = new Map<number, number[]>();

  for (const row of rows) {
    if (row.parkId && row.parkId !== parkId) {
      continue;
    }
    if (row.waitTime === null || !Number.isFinite(row.waitTime)) {
      continue;
    }
    const ts = new Date(row.timestamp).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) {
      continue;
    }
    const key = Math.floor(ts / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ?? [];
    bucket.push(row.waitTime);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestampMs, waits]) => ({
      timestampMs,
      wait: Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length),
      label: formatShowTime(new Date(timestampMs).toISOString(), timezone).replace(
        /:00/,
        ''
      ),
    }));
}

/** Live average standby wait for open attractions in a park bundle. */
export function averageLiveWaitForRides(
  attractions: AttractionViewModel[]
): number | null {
  const waits = openRidesWithPostedWait(attractions).map(
    (item) => item.waitTime as number
  );
  if (!waits.length) {
    return null;
  }
  return Math.round(waits.reduce((sum, wait) => sum + wait, 0) / waits.length);
}
