/** ThemeParks.wiki API entity types. */
export type EntityType =
  | 'DESTINATION'
  | 'PARK'
  | 'ATTRACTION'
  | 'SHOW'
  | 'RESTAURANT'
  | 'AREA'
  | 'SHOP'
  | string;

export type LiveStatus =
  | 'OPERATING'
  | 'CLOSED'
  | 'DOWN'
  | 'REFURBISHMENT'
  | string;

export interface QueueStandby {
  waitTime: number | null;
}

export interface QueueReturnTime {
  state?: string;
  returnStart?: string;
  returnEnd?: string;
}

export interface LiveQueue {
  STANDBY?: QueueStandby;
  RETURN_TIME?: QueueReturnTime;
  PAID_RETURN_TIME?: QueueReturnTime & {
    price?: { amount: number; currency: string; formatted: string };
  };
}

export interface OperatingHour {
  type: string;
  startTime?: string;
  endTime?: string;
}

export interface Showtime {
  type: string;
  startTime: string;
  endTime: string;
}

export interface WaitForecast {
  time: string;
  waitTime: number;
  percentage?: number;
}

export interface LiveDataItem {
  id: string;
  name: string;
  entityType: EntityType;
  parkId: string | null;
  externalId?: string;
  status: LiveStatus;
  queue?: LiveQueue;
  showtimes?: Showtime[];
  operatingHours?: OperatingHour[];
  forecast?: WaitForecast[];
  lastUpdated: string;
  attractionType?: string;
}

export interface ParkLiveResponse {
  id: string;
  name: string;
  entityType: EntityType;
  timezone: string;
  liveData: LiveDataItem[];
}

export interface ScheduleEntry {
  date: string;
  type: string;
  openingTime?: string;
  closingTime?: string;
  description?: string;
}

export interface ParkScheduleResponse {
  id: string;
  name: string;
  entityType: EntityType;
  timezone: string;
  schedule: ScheduleEntry[];
}

export interface EntityChild {
  id: string;
  name: string;
  entityType: EntityType;
  parentId?: string;
  slug?: string | null;
  attractionType?: string;
}

export interface EntityChildrenResponse {
  id: string;
  name: string;
  entityType: EntityType;
  children: EntityChild[];
}

export interface EntityDetail {
  id: string;
  name: string;
  parkId?: string;
  parentId?: string;
  entityType: EntityType;
  attractionType?: string;
  externalId?: string;
  timezone?: string;
}

/** View model used by dashboard components. */
export interface AttractionViewModel {
  id: string;
  name: string;
  entityType: EntityType;
  status: LiveStatus;
  waitTime: number | null;
  displayStatus: 'Open' | 'Closed' | 'Down' | 'Refurbishment';
  area: string | null;
  attractionType: string | null;
  parkId?: string;
  parkName?: string;
  lastUpdated: string;
  showtimes: Showtime[];
  operatingHours: OperatingHour[];
  isFavorite: boolean;
}

export interface ParkLiveBundle {
  parkId: string;
  parkName: string;
  parkShortName: string;
  resort: string;
  timezone: string;
  liveData: LiveDataItem[];
  schedule: ScheduleEntry[];
  areaMap: Record<string, string>;
  entityMetadata: Record<string, EntityMetadata>;
}

export interface AllParksDashboardState {
  loading: boolean;
  error: string | null;
  lastRefreshed: Date | null;
  parks: ParkLiveBundle[];
}

export type SortOption =
  | 'shortest-wait'
  | 'alphabetical'
  | 'area'
  | 'type'
  | 'longest-wait';

export type EntityFilter = 'all' | 'rides' | 'shows';
export type WaitRangeFilter = 'all' | 'under-15' | '15-30' | '30-60' | 'over-60';

/** Static entity metadata from /entity/{id} used to filter non-experiences. */
export interface EntityMetadata {
  attractionType?: string;
  externalId?: string;
}

export interface ParkDashboardState {
  loading: boolean;
  error: string | null;
  lastRefreshed: Date | null;
  liveData: LiveDataItem[];
  schedule: ScheduleEntry[];
  timezone: string;
  areaMap: Record<string, string>;
  entityMetadata: Record<string, EntityMetadata>;
}