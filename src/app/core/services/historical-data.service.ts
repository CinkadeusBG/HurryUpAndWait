import { Injectable, inject } from '@angular/core';
import type { TursoRow } from './turso-client.service';
import {
  Observable,
  catchError,
  from,
  map,
  of,
  shareReplay,
} from 'rxjs';
import {
  getParkById,
  HISTORICAL_DATA_RETENTION_DAYS,
} from '../constants/park.constants';
import {
  AttractionHistoryBundle,
  DataManifest,
  ParkDailyDataFile,
  WaitTimeSnapshot,
} from '../models/historical.models';
import { TursoClientService } from './turso-client.service';

const SNAPSHOT_SELECT = `
  SELECT
    collected_at AS timestamp,
    attraction_id AS attractionId,
    attraction_name AS name,
    status,
    wait_time AS waitTime,
    entity_type AS entityType
  FROM wait_snapshots
`;

@Injectable({ providedIn: 'root' })
export class HistoricalDataService {
  private readonly turso = inject(TursoClientService);
  private readonly manifestCache = new Map<string, Observable<DataManifest>>();
  private readonly dailyFileCache = new Map<string, Observable<ParkDailyDataFile | null>>();
  private readonly attractionHistoryCache = new Map<
    string,
    Observable<AttractionHistoryBundle>
  >();
  private readonly recentTrendCache = new Map<string, Observable<WaitTimeSnapshot[]>>();

  getManifest(): Observable<DataManifest> {
    const cacheKey = 'manifest';
    if (!this.manifestCache.has(cacheKey)) {
      const request$ = from(this.loadManifest()).pipe(
        catchError(() =>
          of({
            lastUpdated: null,
            retentionDays: HISTORICAL_DATA_RETENTION_DAYS,
            parks: {},
          } satisfies DataManifest)
        ),
        shareReplay(1)
      );
      this.manifestCache.set(cacheKey, request$);
    }

    return this.manifestCache.get(cacheKey)!;
  }

  getParkDailyFile(parkId: string, date: string): Observable<ParkDailyDataFile | null> {
    const cacheKey = `${parkId}:${date}`;
    if (!this.dailyFileCache.has(cacheKey)) {
      const request$ = from(this.loadParkDailyFile(parkId, date)).pipe(
        catchError(() => of(null)),
        shareReplay(1)
      );
      this.dailyFileCache.set(cacheKey, request$);
    }

    return this.dailyFileCache.get(cacheKey)!;
  }

  /** Load all available daily snapshots for a park (up to retention window). */
  loadParkHistory(parkId: string): Observable<WaitTimeSnapshot[]> {
    return from(this.queryParkSnapshots(parkId)).pipe(
      catchError(() => of([]))
    );
  }

  getAttractionHistory(
    parkId: string,
    attractionId: string
  ): Observable<AttractionHistoryBundle> {
    const cacheKey = `${parkId}:${attractionId}`;
    if (!this.attractionHistoryCache.has(cacheKey)) {
      const request$ = from(this.loadAttractionHistory(parkId, attractionId)).pipe(
        catchError(() =>
          of({
            attractionId,
            attractionName: 'Attraction',
            parkId,
            entries: [],
          } satisfies AttractionHistoryBundle)
        ),
        shareReplay(1)
      );
      this.attractionHistoryCache.set(cacheKey, request$);
    }

    return this.attractionHistoryCache.get(cacheKey)!;
  }

  /** Sparkline data: recent hours for one attraction from today's park snapshots. */
  getRecentTrend(
    parkId: string,
    attractionId: string,
    hours = 6
  ): Observable<WaitTimeSnapshot[]> {
    const today = this.formatEasternDate(new Date());
    const cacheKey = `${parkId}:${attractionId}:${today}:${hours}`;
    if (!this.recentTrendCache.has(cacheKey)) {
      const request$ = from(
        this.loadRecentTrend(parkId, attractionId, today, hours)
      ).pipe(catchError(() => of([])), shareReplay(1));
      this.recentTrendCache.set(cacheKey, request$);
    }

    return this.recentTrendCache.get(cacheKey)!;
  }

  private async loadManifest(): Promise<DataManifest> {
    const metadataRows = await this.turso.query(
      'SELECT key, value FROM collection_metadata'
    );
    const metadata = new Map(
      metadataRows.map((row) => [String(row['key']), String(row['value'])])
    );

    const dateRows = await this.turso.query(`
      SELECT park_id, local_date
      FROM wait_snapshots
      GROUP BY park_id, local_date
      ORDER BY local_date ASC
    `);

    const parks: DataManifest['parks'] = {};
    for (const row of dateRows) {
      const parkId = String(row['park_id']);
      const date = String(row['local_date']);
      const park = getParkById(parkId);

      if (!parks[parkId]) {
        parks[parkId] = {
          name: park?.name ?? parkId,
          shortName: park?.shortName ?? parkId,
          dates: [],
        };
      }

      parks[parkId].dates.push(date);
    }

    return {
      lastUpdated: metadata.get('last_updated') ?? null,
      retentionDays: Number(metadata.get('retention_days')) || HISTORICAL_DATA_RETENTION_DAYS,
      parks,
    };
  }

  private async loadParkDailyFile(
    parkId: string,
    date: string
  ): Promise<ParkDailyDataFile | null> {
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id = ? AND local_date = ?
       ORDER BY collected_at ASC`,
      [parkId, date]
    );

    if (!rows.length) {
      return null;
    }

    const park = getParkById(parkId);
    const entries = rows.map((row) => this.mapSnapshotRow(row));
    const lastCollectedAt = entries.at(-1)?.timestamp;

    return {
      parkId,
      parkName: park?.name ?? parkId,
      date,
      timezone: 'America/New_York',
      lastCollectedAt,
      entries,
    };
  }

  private async queryParkSnapshots(parkId: string): Promise<WaitTimeSnapshot[]> {
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id = ?
       ORDER BY collected_at ASC`,
      [parkId]
    );

    return rows.map((row) => this.mapSnapshotRow(row));
  }

  private async loadAttractionHistory(
    parkId: string,
    attractionId: string
  ): Promise<AttractionHistoryBundle> {
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id = ? AND attraction_id = ?
       ORDER BY collected_at ASC`,
      [parkId, attractionId]
    );

    const entries = rows.map((row) => this.mapSnapshotRow(row));

    return {
      attractionId,
      attractionName: entries.at(-1)?.name ?? 'Attraction',
      parkId,
      entries,
    };
  }

  private async loadRecentTrend(
    parkId: string,
    attractionId: string,
    today: string,
    hours: number
  ): Promise<WaitTimeSnapshot[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id = ?
         AND attraction_id = ?
         AND local_date = ?
         AND collected_at >= ?
       ORDER BY collected_at ASC`,
      [parkId, attractionId, today, cutoff]
    );

    return rows.map((row) => this.mapSnapshotRow(row));
  }

  private mapSnapshotRow(row: TursoRow): WaitTimeSnapshot {
    const waitTime = row['waitTime'];
    return {
      timestamp: String(row['timestamp']),
      attractionId: String(row['attractionId']),
      name: String(row['name']),
      status: String(row['status']),
      waitTime:
        waitTime === null || waitTime === undefined ? null : Number(waitTime),
      entityType: String(row['entityType']),
    };
  }

  private formatEasternDate(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }
}