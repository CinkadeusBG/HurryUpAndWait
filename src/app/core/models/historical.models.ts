/** Single wait-time snapshot stored by the background collector. */
export interface WaitTimeSnapshot {
  timestamp: string;
  attractionId: string;
  name: string;
  status: string;
  waitTime: number | null;
  entityType: string;
}

/** Per-park daily snapshot bundle (legacy shape; now assembled from Turso rows). */
export interface ParkDailyDataFile {
  parkId: string;
  parkName: string;
  date: string;
  timezone: string;
  lastCollectedAt?: string;
  entries: WaitTimeSnapshot[];
}

export interface ParkManifestEntry {
  name: string;
  shortName: string;
  dates: string[];
}

export interface DataManifest {
  lastUpdated: string | null;
  retentionDays: number;
  parks: Record<string, ParkManifestEntry>;
}

export interface HourlyAverage {
  hour: number;
  label: string;
  averageWait: number | null;
  sampleCount: number;
}

export interface DayOfWeekAverage {
  dayIndex: number;
  label: string;
  averageWait: number | null;
  sampleCount: number;
}

export interface AttractionHistoryBundle {
  attractionId: string;
  attractionName: string;
  parkId: string;
  entries: WaitTimeSnapshot[];
}

/** End-of-day Individual Lightning Lane price snapshot (WDW). */
export interface IllDailySnapshot {
  parkId: string;
  parkName: string;
  localDate: string;
  collectedAt: string;
  attractionId: string;
  attractionName: string;
  priceCents: number;
  soldOut: boolean;
  source: string;
}

export interface ParkIllAttractionSummary {
  attractionId: string;
  attractionName: string;
  history: IllDailySnapshot[];
  latest: IllDailySnapshot | null;
  averagePriceCents: number | null;
  soldOutDays: number;
}

/** End-of-day park-level Multi Pass and Premier Pass snapshot (WDW). */
export interface ParkLlDailySnapshot {
  parkId: string;
  parkName: string;
  localDate: string;
  collectedAt: string;
  multiPassCents: number | null;
  multiPassSoldOut: boolean;
  premierPassCents: number | null;
  premierPassSoldOut: boolean;
}