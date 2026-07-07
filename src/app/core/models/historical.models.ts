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