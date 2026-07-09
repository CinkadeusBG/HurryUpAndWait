import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  from,
  of,
  shareReplay,
} from 'rxjs';
import {
  getParkById,
  HISTORICAL_DATA_RETENTION_DAYS,
  REFRESH_INTERVAL_MS,
} from '../constants/park.constants';
import {
  AttractionHistoryBundle,
  DataManifest,
  IllDailySnapshot,
  ParkDailyDataFile,
  ParkIllAttractionSummary,
  ParkLlDailySnapshot,
  WaitTimeSnapshot,
} from '../models/historical.models';
import { averageIllPriceCents } from '../utils/ill-display.utils';
import { TursoClientService, type TursoRow } from './turso-client.service';

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

const ILL_SELECT = `
  SELECT
    park_id AS parkId,
    park_name AS parkName,
    local_date AS localDate,
    collected_at AS collectedAt,
    attraction_id AS attractionId,
    attraction_name AS attractionName,
    price_cents AS priceCents,
    sold_out AS soldOut,
    source
  FROM ill_daily_snapshots
`;

const PARK_LL_SELECT = `
  SELECT
    park_id AS parkId,
    park_name AS parkName,
    local_date AS localDate,
    collected_at AS collectedAt,
    multi_pass_cents AS multiPassCents,
    multi_pass_sold_out AS multiPassSoldOut,
    premier_pass_cents AS premierPassCents,
    premier_pass_sold_out AS premierPassSoldOut
  FROM park_ll_daily_snapshots
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
  private readonly recentTrendCache = new Map<
    string,
    { cachedAt: number; request$: Observable<WaitTimeSnapshot[]> }
  >();
  private readonly lastKnownWaitCache = new Map<
    string,
    { cachedAt: number; request$: Observable<WaitTimeSnapshot | null> }
  >();
  private readonly parkSparklineTrendsCache = new Map<
    string,
    { cachedAt: number; request$: Observable<Record<string, WaitTimeSnapshot[]>> }
  >();
  private readonly parkLastKnownWaitsCache = new Map<
    string,
    { cachedAt: number; request$: Observable<Record<string, WaitTimeSnapshot>> }
  >();
  private readonly parkIllCache = new Map<string, Observable<ParkIllAttractionSummary[]>>();
  private readonly parkLlCache = new Map<string, Observable<ParkLlDailySnapshot[]>>();
  private readonly attractionIllCache = new Map<string, Observable<IllDailySnapshot[]>>();

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

  /** Daily park-level Multi Pass / Premier Pass history for a WDW park. */
  getParkLlHistory(parkId: string): Observable<ParkLlDailySnapshot[]> {
    if (!this.parkLlCache.has(parkId)) {
      const request$ = from(this.loadParkLlHistory(parkId)).pipe(
        catchError(() => of([])),
        shareReplay(1)
      );
      this.parkLlCache.set(parkId, request$);
    }

    return this.parkLlCache.get(parkId)!;
  }

  /** Daily ILL history grouped by attraction for a WDW park. */
  getParkIllSummaries(parkId: string): Observable<ParkIllAttractionSummary[]> {
    if (!this.parkIllCache.has(parkId)) {
      const request$ = from(this.loadParkIllSummaries(parkId)).pipe(
        catchError(() => of([])),
        shareReplay(1)
      );
      this.parkIllCache.set(parkId, request$);
    }

    return this.parkIllCache.get(parkId)!;
  }

  /** Daily ILL history for one attraction. */
  getAttractionIllHistory(
    parkId: string,
    attractionId: string
  ): Observable<IllDailySnapshot[]> {
    const cacheKey = `${parkId}:${attractionId}`;
    if (!this.attractionIllCache.has(cacheKey)) {
      const request$ = from(this.loadAttractionIllHistory(parkId, attractionId)).pipe(
        catchError(() => of([])),
        shareReplay(1)
      );
      this.attractionIllCache.set(cacheKey, request$);
    }

    return this.attractionIllCache.get(cacheKey)!;
  }

  /** Sparkline data: standby waits for one attraction over the last N hours. */
  getRecentTrend(
    parkId: string,
    attractionId: string,
    hours = 6
  ): Observable<WaitTimeSnapshot[]> {
    const cacheKey = `${parkId}:${attractionId}:${hours}`;
    const cached = this.recentTrendCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cachedAt < REFRESH_INTERVAL_MS) {
      return cached.request$;
    }

    const request$ = from(this.loadRecentTrend(parkId, attractionId, hours)).pipe(
      catchError(() => of([])),
      shareReplay(1)
    );
    this.recentTrendCache.set(cacheKey, { cachedAt: now, request$ });
    return request$;
  }

  /** Recent sparkline rows for every attraction in one or more parks (batched). */
  getSparklineTrendsForParks(
    parkIds: string[],
    hours = 6
  ): Observable<Record<string, WaitTimeSnapshot[]>> {
    const normalizedIds = [...new Set(parkIds.filter(Boolean))].sort();
    if (!normalizedIds.length) {
      return of({});
    }

    const cacheKey = `${normalizedIds.join('|')}:${hours}`;
    const cached = this.parkSparklineTrendsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cachedAt < REFRESH_INTERVAL_MS) {
      return cached.request$;
    }

    const request$ = from(this.loadSparklineTrendsForParks(normalizedIds, hours)).pipe(
      catchError(() => of({})),
      shareReplay(1)
    );
    this.parkSparklineTrendsCache.set(cacheKey, { cachedAt: now, request$ });
    return request$;
  }

  /** Latest standby snapshot per attraction for one or more parks (batched). */
  getLastKnownWaitsForParks(
    parkIds: string[]
  ): Observable<Record<string, WaitTimeSnapshot>> {
    const normalizedIds = [...new Set(parkIds.filter(Boolean))].sort();
    if (!normalizedIds.length) {
      return of({});
    }

    const cacheKey = normalizedIds.join('|');
    const cached = this.parkLastKnownWaitsCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cachedAt < REFRESH_INTERVAL_MS) {
      return cached.request$;
    }

    const request$ = from(this.loadLastKnownWaitsForParks(normalizedIds)).pipe(
      catchError(() => of({})),
      shareReplay(1)
    );
    this.parkLastKnownWaitsCache.set(cacheKey, { cachedAt: now, request$ });
    return request$;
  }

  /** Most recent stored snapshot that still has a standby wait time. */
  getLastKnownWait(
    parkId: string,
    attractionId: string
  ): Observable<WaitTimeSnapshot | null> {
    const cacheKey = `${parkId}:${attractionId}`;
    const cached = this.lastKnownWaitCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.cachedAt < REFRESH_INTERVAL_MS) {
      return cached.request$;
    }

    const request$ = from(this.loadLastKnownWait(parkId, attractionId)).pipe(
      catchError(() => of(null)),
      shareReplay(1)
    );
    this.lastKnownWaitCache.set(cacheKey, { cachedAt: now, request$ });
    return request$;
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

  private async loadParkLlHistory(parkId: string): Promise<ParkLlDailySnapshot[]> {
    const rows = await this.turso.query(
      `${PARK_LL_SELECT}
       WHERE park_id = ?
       ORDER BY local_date DESC`,
      [parkId]
    );

    return rows.map((row) => this.mapParkLlRow(row));
  }

  private async loadParkIllSummaries(
    parkId: string
  ): Promise<ParkIllAttractionSummary[]> {
    const rows = await this.turso.query(
      `${ILL_SELECT}
       WHERE park_id = ?
       ORDER BY attraction_name ASC, local_date ASC`,
      [parkId]
    );

    const grouped = new Map<string, IllDailySnapshot[]>();
    for (const row of rows) {
      const snapshot = this.mapIllRow(row);
      const entries = grouped.get(snapshot.attractionId) ?? [];
      entries.push(snapshot);
      grouped.set(snapshot.attractionId, entries);
    }

    return [...grouped.entries()]
      .map(([attractionId, history]) => {
        const latest = history.at(-1) ?? null;
        return {
          attractionId,
          attractionName: latest?.attractionName ?? attractionId,
          history,
          latest,
          averagePriceCents: averageIllPriceCents(history),
          soldOutDays: history.filter((entry) => entry.soldOut).length,
        } satisfies ParkIllAttractionSummary;
      })
      .sort((left, right) =>
        left.attractionName.localeCompare(right.attractionName)
      );
  }

  private async loadAttractionIllHistory(
    parkId: string,
    attractionId: string
  ): Promise<IllDailySnapshot[]> {
    const rows = await this.turso.query(
      `${ILL_SELECT}
       WHERE park_id = ? AND attraction_id = ?
       ORDER BY local_date ASC`,
      [parkId, attractionId]
    );

    return rows.map((row) => this.mapIllRow(row));
  }

  private async loadSparklineTrendsForParks(
    parkIds: string[],
    hours: number
  ): Promise<Record<string, WaitTimeSnapshot[]>> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const placeholders = parkIds.map(() => '?').join(', ');
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id IN (${placeholders})
         AND collected_at >= ?
       ORDER BY collected_at ASC`,
      [...parkIds, cutoff]
    );

    const grouped: Record<string, WaitTimeSnapshot[]> = {};
    for (const row of rows) {
      const entry = this.mapSnapshotRow(row);
      const bucket = grouped[entry.attractionId] ?? [];
      bucket.push(entry);
      grouped[entry.attractionId] = bucket;
    }

    return grouped;
  }

  private async loadLastKnownWaitsForParks(
    parkIds: string[]
  ): Promise<Record<string, WaitTimeSnapshot>> {
    const placeholders = parkIds.map(() => '?').join(', ');
    const rows = await this.turso.query(
      `SELECT
         ws.collected_at AS timestamp,
         ws.attraction_id AS attractionId,
         ws.attraction_name AS name,
         ws.status,
         ws.wait_time AS waitTime,
         ws.entity_type AS entityType
       FROM wait_snapshots ws
       INNER JOIN (
         SELECT park_id, attraction_id, MAX(collected_at) AS max_collected
         FROM wait_snapshots
         WHERE park_id IN (${placeholders})
           AND wait_time IS NOT NULL
         GROUP BY park_id, attraction_id
       ) latest
         ON ws.park_id = latest.park_id
        AND ws.attraction_id = latest.attraction_id
        AND ws.collected_at = latest.max_collected
       WHERE ws.park_id IN (${placeholders})`,
      [...parkIds, ...parkIds]
    );

    const grouped: Record<string, WaitTimeSnapshot> = {};
    for (const row of rows) {
      const entry = this.mapSnapshotRow(row);
      grouped[entry.attractionId] = entry;
    }

    return grouped;
  }

  private async loadRecentTrend(
    parkId: string,
    attractionId: string,
    hours: number
  ): Promise<WaitTimeSnapshot[]> {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id = ?
         AND attraction_id = ?
         AND collected_at >= ?
       ORDER BY collected_at ASC`,
      [parkId, attractionId, cutoff]
    );

    return rows.map((row) => this.mapSnapshotRow(row));
  }

  private async loadLastKnownWait(
    parkId: string,
    attractionId: string
  ): Promise<WaitTimeSnapshot | null> {
    const rows = await this.turso.query(
      `${SNAPSHOT_SELECT}
       WHERE park_id = ?
         AND attraction_id = ?
         AND wait_time IS NOT NULL
       ORDER BY collected_at DESC
       LIMIT 1`,
      [parkId, attractionId]
    );

    const row = rows[0];
    return row ? this.mapSnapshotRow(row) : null;
  }

  private mapParkLlRow(row: TursoRow): ParkLlDailySnapshot {
    const multiPassCents = row['multiPassCents'];
    const premierPassCents = row['premierPassCents'];

    return {
      parkId: String(row['parkId']),
      parkName: String(row['parkName']),
      localDate: String(row['localDate']),
      collectedAt: String(row['collectedAt']),
      multiPassCents:
        multiPassCents === null || multiPassCents === undefined
          ? null
          : Number(multiPassCents),
      multiPassSoldOut: Number(row['multiPassSoldOut']) === 1,
      premierPassCents:
        premierPassCents === null || premierPassCents === undefined
          ? null
          : Number(premierPassCents),
      premierPassSoldOut: Number(row['premierPassSoldOut']) === 1,
    };
  }

  private mapIllRow(row: TursoRow): IllDailySnapshot {
    return {
      parkId: String(row['parkId']),
      parkName: String(row['parkName']),
      localDate: String(row['localDate']),
      collectedAt: String(row['collectedAt']),
      attractionId: String(row['attractionId']),
      attractionName: String(row['attractionName']),
      priceCents: Number(row['priceCents']),
      soldOut: Number(row['soldOut']) === 1,
      source: String(row['source']),
    };
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