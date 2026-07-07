import { ResortId } from '../constants/park.constants';
import {
  AttractionViewModel,
  EntityFilter,
  EntityMetadata,
  LiveDataItem,
  LiveStatus,
  ScheduleEntry,
  Showtime,
  SortOption,
  WaitRangeFilter,
} from '../models/theme-parks.models';

const RIDE_ENTITY_TYPES = new Set(['ATTRACTION']);
const SHOW_ENTITY_TYPES = new Set(['SHOW']);

export function isShowEntity(entityType: string): boolean {
  return SHOW_ENTITY_TYPES.has(entityType);
}

export function isRideEntity(entityType: string): boolean {
  return RIDE_ENTITY_TYPES.has(entityType);
}

/** Rides that are down stay in the main list so guests know they exist. */
export function isMainListAttraction(item: AttractionViewModel): boolean {
  if (item.displayStatus === 'Open') {
    return true;
  }

  return item.displayStatus === 'Down' && isRideEntity(item.entityType);
}

export function isClosedSectionAttraction(item: AttractionViewModel): boolean {
  if (isMainListAttraction(item)) {
    return false;
  }

  return item.displayStatus !== 'Open';
}

type ExperienceTimingSource = Pick<
  AttractionViewModel,
  'entityType' | 'showtimes' | 'operatingHours'
>;

const PERFORMANCE_SHOWTIME_TYPES = new Set(['Performance Time', 'Performance']);

function getTimingWindows(
  item: ExperienceTimingSource
): Array<{ type: string; startTime?: string; endTime?: string }> {
  if (item.showtimes.length) {
    return item.showtimes;
  }
  return item.operatingHours;
}

/** Character meets and other queue-based experiences posted as SHOW with operating windows. */
export function isContinuousExperience(item: ExperienceTimingSource): boolean {
  if (!isShowEntity(item.entityType)) {
    return false;
  }

  const windows = getTimingWindows(item);
  if (!windows.length) {
    return false;
  }

  const hasPerformanceTimes = windows.some((window) =>
    PERFORMANCE_SHOWTIME_TYPES.has(window.type)
  );
  if (hasPerformanceTimes) {
    return false;
  }

  return windows.some((window) => window.type === 'Operating');
}

export function isPerformanceShow(item: ExperienceTimingSource): boolean {
  return isShowEntity(item.entityType) && !isContinuousExperience(item);
}

export function formatEntityTypeLabel(
  entityType: string,
  item?: ExperienceTimingSource & { name?: string }
): string {
  if (item && isContinuousExperience(item)) {
    if (item.name && /^Meet\b/i.test(item.name)) {
      return 'Meet';
    }
    return 'Experience';
  }

  if (entityType === 'ATTRACTION') {
    return 'Attraction';
  }
  if (entityType === 'SHOW') {
    return 'Show';
  }
  return entityType.charAt(0) + entityType.slice(1).toLowerCase();
}

/** Formats API attraction types (e.g. RIDE, DARK_RIDE) for meta chips. */
export function formatAttractionTypeLabel(attractionType: string): string {
  return attractionType
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/** Maps API status to a user-facing badge label. */
export function mapDisplayStatus(status: LiveStatus): AttractionViewModel['displayStatus'] {
  switch (status) {
    case 'OPERATING':
      return 'Open';
    case 'DOWN':
      return 'Down';
    case 'REFURBISHMENT':
      return 'Refurbishment';
    default:
      return 'Closed';
  }
}

/** Extracts standby wait time; null means unavailable or walk-on. */
export function getStandbyWait(item: LiveDataItem): number | null {
  const wait = item.queue?.STANDBY?.waitTime;
  return wait === undefined || wait === null ? null : wait;
}

/** Builds a view model from raw live data plus optional metadata. */
export interface AttractionViewContext {
  parkId?: string;
  parkName?: string;
}

export function toAttractionViewModel(
  item: LiveDataItem,
  areaMap: Record<string, string>,
  favoriteIds: Set<string>,
  metadataMap: Record<string, EntityMetadata> = {},
  context: AttractionViewContext = {}
): AttractionViewModel {
  const area = areaMap[item.id] ?? null;
  const metadata = metadataMap[item.id];

  return {
    id: item.id,
    name: item.name,
    entityType: item.entityType,
    status: item.status,
    waitTime: getStandbyWait(item),
    displayStatus: mapDisplayStatus(item.status),
    area,
    attractionType: metadata?.attractionType ?? item.attractionType ?? null,
    parkId: context.parkId,
    parkName: context.parkName,
    lastUpdated: item.lastUpdated,
    showtimes: item.showtimes ?? [],
    operatingHours: item.operatingHours ?? [],
    isFavorite: favoriteIds.has(item.id),
  };
}

/**
 * Filters live data down to guest-facing rides and shows.
 * Uses API delineation: entityType, externalId, attractionType, and live queue signals.
 */
export function isTrackableEntity(
  item: LiveDataItem,
  parkId: string,
  metadataMap: Record<string, EntityMetadata> = {}
): boolean {
  if (item.id === parkId) {
    return false;
  }

  const metadata = metadataMap[item.id];
  const attractionType = metadata?.attractionType ?? item.attractionType;
  const externalId = item.externalId ?? metadata?.externalId;

  if (SHOW_ENTITY_TYPES.has(item.entityType)) {
    // Disney/Universal publish real shows as Entertainment entities.
    return externalId?.includes('entityType=Entertainment') ?? false;
  }

  if (RIDE_ENTITY_TYPES.has(item.entityType)) {
    if (isLandmarkAttraction(item, attractionType)) {
      return false;
    }

    if (isStreetTransport(item, attractionType)) {
      return false;
    }

    return true;
  }

  return false;
}

/** Icons/structures (e.g. Cinderella Castle): UNKNOWN attractionType with no queue data. */
function isLandmarkAttraction(
  item: LiveDataItem,
  attractionType?: string
): boolean {
  if (attractionType !== 'UNKNOWN' || item.queue) {
    return false;
  }

  return /\bCastle\b/i.test(item.name) || /\bTree of Life\b/i.test(item.name);
}

/** Street transports posted as rides without real wait-time tracking (e.g. Main St Vehicles). */
function isStreetTransport(
  item: LiveDataItem,
  attractionType?: string
): boolean {
  if (attractionType !== 'RIDE' || !/\bVehicles\b/i.test(item.name)) {
    return false;
  }

  const hasForecast = (item.forecast?.length ?? 0) > 0;
  const hasReturnQueue =
    !!item.queue?.RETURN_TIME || !!item.queue?.PAID_RETURN_TIME;
  const hasNumericWait =
    item.queue?.STANDBY?.waitTime !== undefined &&
    item.queue?.STANDBY?.waitTime !== null;

  return !hasForecast && !hasReturnQueue && !hasNumericWait;
}

export function filterAttractions(
  items: AttractionViewModel[],
  search: string,
  entityFilter: EntityFilter,
  waitRange: WaitRangeFilter
): AttractionViewModel[] {
  const query = search.trim().toLowerCase();

  return items.filter((item) => {
    if (
      entityFilter === 'rides' &&
      !RIDE_ENTITY_TYPES.has(item.entityType) &&
      !(isContinuousExperience(item) && item.waitTime !== null)
    ) {
      return false;
    }
    if (entityFilter === 'shows' && !isPerformanceShow(item)) {
      return false;
    }

    if (waitRange !== 'all' && item.displayStatus === 'Open' && isRideEntity(item.entityType)) {
      const wait = item.waitTime ?? 0;
      switch (waitRange) {
        case 'under-15':
          if (wait >= 15) return false;
          break;
        case '15-30':
          if (wait < 15 || wait > 30) return false;
          break;
        case '30-60':
          if (wait < 30 || wait > 60) return false;
          break;
        case 'over-60':
          if (wait <= 60) return false;
          break;
      }
    }

    if (!query) {
      return true;
    }

    return (
      item.name.toLowerCase().includes(query) ||
      (item.area?.toLowerCase().includes(query) ?? false)
    );
  });
}

type SortEntityGroup = 'ride' | 'show' | 'other';

function getSortEntityGroup(item: AttractionViewModel): SortEntityGroup {
  if (isRideEntity(item.entityType)) {
    return 'ride';
  }
  if (isContinuousExperience(item) && item.waitTime !== null) {
    return 'ride';
  }
  if (isShowEntity(item.entityType)) {
    return 'show';
  }
  return 'other';
}

/** Keeps all rides together; shows always follow the ride block. */
function compareEntityGroups(
  a: AttractionViewModel,
  b: AttractionViewModel
): number {
  const order: Record<SortEntityGroup, number> = { ride: 0, show: 1, other: 2 };
  return order[getSortEntityGroup(a)] - order[getSortEntityGroup(b)];
}

/** Open rides sort before down rides within the ride block. */
function compareRideAvailability(
  a: AttractionViewModel,
  b: AttractionViewModel
): number {
  const openA = a.displayStatus === 'Open';
  const openB = b.displayStatus === 'Open';
  if (openA === openB) {
    return 0;
  }
  return openA ? -1 : 1;
}

function compareNames(a: AttractionViewModel, b: AttractionViewModel): number {
  return a.name.localeCompare(b.name);
}

export function sortAttractions(
  items: AttractionViewModel[],
  sort: SortOption
): AttractionViewModel[] {
  const sorted = [...items];

  sorted.sort((a, b) => {
    const groupCompare = compareEntityGroups(a, b);
    if (groupCompare !== 0) {
      return groupCompare;
    }

    switch (sort) {
      case 'alphabetical':
        if (getSortEntityGroup(a) === 'ride') {
          const availability = compareRideAvailability(a, b);
          if (availability !== 0) {
            return availability;
          }
        }
        return compareNames(a, b);
      case 'area': {
        if (getSortEntityGroup(a) === 'ride') {
          const availability = compareRideAvailability(a, b);
          if (availability !== 0) {
            return availability;
          }
        }
        const areaA = a.area ?? 'ZZZ';
        const areaB = b.area ?? 'ZZZ';
        const areaCompare = areaA.localeCompare(areaB);
        return areaCompare !== 0 ? areaCompare : compareNames(a, b);
      }
      case 'type': {
        if (getSortEntityGroup(a) === 'ride') {
          const availability = compareRideAvailability(a, b);
          if (availability !== 0) {
            return availability;
          }
        }
        const typeA = a.attractionType ?? a.entityType;
        const typeB = b.attractionType ?? b.entityType;
        const typeCompare = typeA.localeCompare(typeB);
        return typeCompare !== 0 ? typeCompare : compareNames(a, b);
      }
      case 'longest-wait': {
        if (getSortEntityGroup(a) === 'show') {
          return compareNames(a, b);
        }
        const availability = compareRideAvailability(a, b);
        if (availability !== 0) {
          return availability;
        }
        const waitA =
          a.displayStatus === 'Down' ? -1 : (a.waitTime ?? -1);
        const waitB =
          b.displayStatus === 'Down' ? -1 : (b.waitTime ?? -1);
        return waitB - waitA;
      }
      case 'shortest-wait':
      default: {
        if (getSortEntityGroup(a) === 'show') {
          return compareNames(a, b);
        }
        const availability = compareRideAvailability(a, b);
        if (availability !== 0) {
          return availability;
        }
        const waitA = a.waitTime ?? Number.MAX_SAFE_INTEGER;
        const waitB = b.waitTime ?? Number.MAX_SAFE_INTEGER;
        if (waitA !== waitB) {
          return waitA - waitB;
        }
        return compareNames(a, b);
      }
    }
  });

  return sorted;
}

/** Color token for wait time display. */
export function getWaitTimeClass(waitTime: number | null, isOpen: boolean): string {
  if (!isOpen) {
    return 'wait-muted';
  }
  if (waitTime === null) {
    return 'wait-walkon';
  }
  if (waitTime <= 15) {
    return 'wait-low';
  }
  if (waitTime <= 30) {
    return 'wait-medium';
  }
  if (waitTime <= 60) {
    return 'wait-high';
  }
  return 'wait-extreme';
}

export function formatWaitTime(waitTime: number | null, isOpen: boolean): string {
  if (!isOpen) {
    return '—';
  }
  if (waitTime === null) {
    return 'Walk-on';
  }
  return `${waitTime}`;
}

/** Finds the next refurb/reopen hint from operating hours or schedule-like data. */
export function getRefurbishmentNote(item: AttractionViewModel): string | null {
  const refurbHour = item.operatingHours.find((hour) =>
    hour.type.toLowerCase().includes('refurb')
  );
  if (refurbHour?.endTime) {
    return `Expected reopening: ${formatLocalDateTime(refurbHour.endTime)}`;
  }
  if (refurbHour?.startTime) {
    return `Refurbishment started: ${formatLocalDateTime(refurbHour.startTime)}`;
  }
  return null;
}

export function formatLocalDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

const SCHEDULE_TYPE_LABELS: Record<ResortId, Record<string, string>> = {
  wdw: {
    OPERATING: 'Park Hours',
    TICKETED_EVENT: 'Ticketed Event',
    EXTRA_HOURS: 'Extra Magic Hours',
    PRIVATE_EVENT: 'Private Event',
    INFO: 'Park Info',
  },
  universal: {
    OPERATING: 'Park Hours',
    TICKETED_EVENT: 'Ticketed Event',
    EXTRA_HOURS: 'Early Park Admission',
    PRIVATE_EVENT: 'Private Event',
    INFO: 'Park Info',
  },
};

const UNIVERSAL_SCHEDULE_DESCRIPTION_LABELS: Record<string, string> = {
  'Early Entry': 'Early Park Admission',
};

/** Human-readable label for a park schedule row. */
export function formatScheduleEntryLabel(
  entry: ScheduleEntry,
  resort: ResortId = 'wdw'
): string {
  const description = entry.description?.trim();
  if (description) {
    if (resort === 'universal') {
      return UNIVERSAL_SCHEDULE_DESCRIPTION_LABELS[description] ?? description;
    }
    return description;
  }

  return (
    SCHEDULE_TYPE_LABELS[resort][entry.type] ??
    entry.type
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ')
  );
}

/** Subtitle when description adds detail beyond the primary label. */
export function formatScheduleEntrySubtitle(
  entry: ScheduleEntry,
  resort: ResortId = 'wdw'
): string | null {
  const description = entry.description?.trim();
  if (!description) {
    return null;
  }

  const label = formatScheduleEntryLabel(entry, resort);
  const rawDescription =
    resort === 'universal'
      ? (UNIVERSAL_SCHEDULE_DESCRIPTION_LABELS[description] ?? description)
      : description;
  return label === rawDescription ? null : description;
}

/** Current clock time in a park timezone (e.g. "2:45p"). */
export function formatParkClockTime(timezone: string, now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(new Date(now));

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 12);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  const dayPeriod = parts.find((part) => part.type === 'dayPeriod')?.value ?? 'AM';
  const period = dayPeriod.toUpperCase().startsWith('P') ? 'p' : 'a';

  return `${hour}:${minute.toString().padStart(2, '0')}${period}`;
}

/** Short timezone label for accessibility (e.g. "EDT"). */
export function formatParkTimezoneAbbr(timezone: string, now = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  }).formatToParts(new Date(now));

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timezone;
}

/** Compact time labels for cards (e.g. "9:00a", "10:30p"). */
export function formatShowTime(iso: string): string {
  const date = new Date(iso);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'p' : 'a';
  hours = hours % 12 || 12;

  return `${hours}:${minutes.toString().padStart(2, '0')}${period}`;
}

export const SHOW_TIME_PREVIEW_LIMIT = 5;

/** Operating window label for character meets (e.g. "9:00 AM – 10:30 PM"). */
export function getRelevantOperatingHoursLabel(
  item: ExperienceTimingSource,
  now = Date.now()
): string | null {
  const operatingWindows = getTimingWindows(item).filter(
    (window) =>
      window.type === 'Operating' && window.startTime && window.endTime
  );

  if (!operatingWindows.length) {
    return null;
  }

  const activeWindow = operatingWindows.find((window) => {
    const start = new Date(window.startTime!).getTime();
    const end = new Date(window.endTime!).getTime();
    return now >= start && now < end;
  });

  if (activeWindow) {
    return `${formatShowTime(activeWindow.startTime!)}–${formatShowTime(activeWindow.endTime!)}`;
  }

  const nextWindow = operatingWindows
    .filter((window) => new Date(window.startTime!).getTime() > now)
    .sort(
      (a, b) =>
        new Date(a.startTime!).getTime() - new Date(b.startTime!).getTime()
    )[0];

  if (nextWindow) {
    return `Opens ${formatShowTime(nextWindow.startTime!)}`;
  }

  return 'Closed for today';
}

/** Show times at or after the current moment, sorted soonest first. */
export function getRelevantShowTimes(
  showtimes: Showtime[],
  now = Date.now()
): string[] {
  return [...showtimes]
    .filter((showtime) => new Date(showtime.startTime).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    )
    .map((showtime) => formatShowTime(showtime.startTime));
}

export function formatRelativeUpdated(iso: string, now = Date.now()): string {
  const diffMs = Math.max(0, now - new Date(iso).getTime());
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 5) {
    return 'just now';
  }
  if (diffMin < 60) {
    return diffMin === 1 ? '1 minute ago' : `${diffMin} minutes ago`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? '1 hour ago' : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
  }

  return `on ${formatLocalDateTime(iso)}`;
}