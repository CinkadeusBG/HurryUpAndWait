import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  forkJoin,
  map,
  of,
  shareReplay,
  switchMap,
} from 'rxjs';
import {
  AttractionHistoryBundle,
  DataManifest,
  ParkDailyDataFile,
  WaitTimeSnapshot,
} from '../models/historical.models';

@Injectable({ providedIn: 'root' })
export class HistoricalDataService {
  private readonly http = inject(HttpClient);
  private readonly manifestCache = new Map<string, Observable<DataManifest>>();
  private readonly dailyFileCache = new Map<string, Observable<ParkDailyDataFile | null>>();

  /** Resolve static data path relative to the deployed site root (GitHub Pages base href). */
  getDataBaseUrl(): string {
    const base = document.querySelector('base')?.getAttribute('href') ?? '/';
    const normalized = base.endsWith('/') ? base : `${base}/`;
    return `${normalized}data/`;
  }

  getManifest(): Observable<DataManifest> {
    const url = `${this.getDataBaseUrl()}manifest.json`;
    if (!this.manifestCache.has(url)) {
      const request$ = this.http.get<DataManifest>(url).pipe(
        catchError(() =>
          of({
            lastUpdated: null,
            retentionDays: 45,
            parks: {},
          } satisfies DataManifest)
        ),
        shareReplay(1)
      );
      this.manifestCache.set(url, request$);
    }

    return this.manifestCache.get(url)!;
  }

  getParkDailyFile(parkId: string, date: string): Observable<ParkDailyDataFile | null> {
    const cacheKey = `${parkId}:${date}`;
    if (!this.dailyFileCache.has(cacheKey)) {
      const url = `${this.getDataBaseUrl()}parks/${parkId}/${date}.json`;
      const request$ = this.http.get<ParkDailyDataFile>(url).pipe(
        catchError(() => of(null)),
        shareReplay(1)
      );
      this.dailyFileCache.set(cacheKey, request$);
    }

    return this.dailyFileCache.get(cacheKey)!;
  }

  /** Load all available daily files for a park (up to retention window). */
  loadParkHistory(parkId: string): Observable<WaitTimeSnapshot[]> {
    return this.getManifest().pipe(
      switchMap((manifest) => {
        const dates = manifest.parks[parkId]?.dates ?? [];
        if (!dates.length) {
          return of([]);
        }

        return forkJoin(
          dates.map((date) => this.getParkDailyFile(parkId, date))
        ).pipe(
          map((files) =>
            files
              .filter((file): file is ParkDailyDataFile => !!file)
              .flatMap((file) => file.entries)
          )
        );
      })
    );
  }

  getAttractionHistory(
    parkId: string,
    attractionId: string
  ): Observable<AttractionHistoryBundle> {
    return this.loadParkHistory(parkId).pipe(
      map((entries) => {
        const filtered = entries
          .filter((entry) => entry.attractionId === attractionId)
          .sort(
            (left, right) =>
              new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
          );

        return {
          attractionId,
          attractionName: filtered.at(-1)?.name ?? 'Attraction',
          parkId,
          entries: filtered,
        } satisfies AttractionHistoryBundle;
      })
    );
  }

  /** Sparkline data: recent hours for one attraction from today's park file only. */
  getRecentTrend(
    parkId: string,
    attractionId: string,
    hours = 6
  ): Observable<WaitTimeSnapshot[]> {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    return this.getParkDailyFile(parkId, today).pipe(
      map((file) => {
        if (!file) {
          return [];
        }

        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        return file.entries
          .filter(
            (entry) =>
              entry.attractionId === attractionId &&
              new Date(entry.timestamp).getTime() >= cutoff
          )
          .sort(
            (left, right) =>
              new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
          );
      })
    );
  }
}