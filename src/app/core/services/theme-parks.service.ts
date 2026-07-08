import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  catchError,
  combineLatest,
  forkJoin,
  interval,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  throwError,
} from 'rxjs';
import {
  API_BASE_URL,
  PARKS,
  REFRESH_INTERVAL_MS,
  getParksForResort,
} from '../constants/park.constants';
import {
  getParkLightningLanePricing,
  type ParkLightningLanePricing,
} from '../utils/lightning-lane.utils';
import {
  AllParksDashboardState,
  EntityChildrenResponse,
  EntityDetail,
  EntityMetadata,
  LiveDataItem,
  ParkDashboardState,
  ParkLiveBundle,
  ParkLiveResponse,
  ParkScheduleResponse,
} from '../models/theme-parks.models';

@Injectable({ providedIn: 'root' })
export class ThemeParksService {
  private readonly childrenCache = new Map<string, Observable<EntityChildrenResponse>>();
  private readonly areaMapCache = new Map<string, Observable<Record<string, string>>>();
  private readonly entityCache = new Map<string, Observable<EntityDetail>>();

  private readonly manualRefresh$ = new BehaviorSubject<void>(undefined);

  constructor(private readonly http: HttpClient) {}

  /** Polls live + schedule data every 3 minutes with manual refresh support. */
  watchPark(parkId: string): Observable<ParkDashboardState> {
    return combineLatest([
      this.manualRefresh$.pipe(startWith(undefined)),
      interval(REFRESH_INTERVAL_MS).pipe(startWith(0)),
    ]).pipe(
      switchMap((_, pollIndex) =>
        this.fetchParkState(parkId, pollIndex === 0)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  /** Polls live data for every supported park (used by the cross-park favorites view). */
  watchAllParks(): Observable<AllParksDashboardState> {
    return combineLatest([
      this.manualRefresh$.pipe(startWith(undefined)),
      interval(REFRESH_INTERVAL_MS).pipe(startWith(0)),
    ]).pipe(
      switchMap((_, pollIndex) =>
        this.fetchAllParksState(pollIndex === 0)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  refreshNow(): void {
    this.manualRefresh$.next();
  }

  /** Today's Multi Pass and Premier Pass prices per WDW park. */
  watchWdwParkLightningLanePricing(): Observable<
    Record<string, ParkLightningLanePricing>
  > {
    const wdwParks = getParksForResort('wdw');

    return combineLatest([
      this.manualRefresh$.pipe(startWith(undefined)),
      interval(REFRESH_INTERVAL_MS).pipe(startWith(0)),
    ]).pipe(
      switchMap(() =>
        forkJoin(
          wdwParks.map((park) =>
            this.getSchedule(park.id).pipe(
              map(
                (response) =>
                  [
                    park.id,
                    getParkLightningLanePricing(
                      response.schedule,
                      response.timezone
                    ),
                  ] as const
              ),
              catchError(() =>
                of([
                  park.id,
                  {
                    multiPass: null,
                    premierPass: null,
                    multiPassSoldOut: false,
                    premierPassSoldOut: false,
                  },
                ] as const)
              )
            )
          )
        )
      ),
      map((entries) => Object.fromEntries(entries)),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getLiveData(parkId: string): Observable<ParkLiveResponse> {
    return this.http
      .get<ParkLiveResponse>(`${API_BASE_URL}/entity/${parkId}/live`)
      .pipe(catchError((error) => throwError(() => error)));
  }

  getSchedule(parkId: string): Observable<ParkScheduleResponse> {
    return this.http
      .get<ParkScheduleResponse>(`${API_BASE_URL}/entity/${parkId}/schedule`)
      .pipe(catchError((error) => throwError(() => error)));
  }

  getEntity(entityId: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`${API_BASE_URL}/entity/${entityId}`);
  }

  /** Fetches and caches static metadata used to distinguish real experiences from landmarks. */
  getEntityMetadataMap(
    liveData: LiveDataItem[]
  ): Observable<Record<string, EntityMetadata>> {
    const ids = [
      ...new Set(
        liveData
          .filter(
            (item) =>
              item.entityType === 'ATTRACTION' || item.entityType === 'SHOW'
          )
          .map((item) => item.id)
      ),
    ];

    if (!ids.length) {
      return of({});
    }

    return forkJoin(
      ids.map((id) =>
        this.getEntityCached(id).pipe(
          map(
            (entity): [string, EntityMetadata] => [
              id,
              {
                attractionType: entity.attractionType,
                externalId: entity.externalId,
              },
            ]
          ),
          catchError(() => of<[string, EntityMetadata]>([id, {}]))
        )
      )
    ).pipe(map((entries) => Object.fromEntries(entries)));
  }

  private getEntityCached(entityId: string): Observable<EntityDetail> {
    if (!this.entityCache.has(entityId)) {
      const request$ = this.getEntity(entityId).pipe(shareReplay(1));
      this.entityCache.set(entityId, request$);
    }

    return this.entityCache.get(entityId)!;
  }

  /** Builds a lookup of entity id -> area/land name for sorting and display. */
  getAreaMap(parkId: string): Observable<Record<string, string>> {
    if (!this.areaMapCache.has(parkId)) {
      const request$ = this.getParkChildren(parkId).pipe(
        map((response) => this.buildAreaMap(response.children, parkId)),
        shareReplay(1)
      );
      this.areaMapCache.set(parkId, request$);
    }

    return this.areaMapCache.get(parkId)!;
  }

  private fetchParkState(
    parkId: string,
    showInitialLoading: boolean
  ): Observable<ParkDashboardState> {
    const emptyState: ParkDashboardState = {
      loading: true,
      error: null,
      lastRefreshed: null,
      liveData: [],
      schedule: [],
      timezone: 'America/New_York',
      areaMap: {},
      entityMetadata: {},
    };

    const request$ = forkJoin({
      live: this.getLiveData(parkId),
      schedule: this.getSchedule(parkId),
      areaMap: this.getAreaMap(parkId),
    }).pipe(
      switchMap(({ live, schedule, areaMap }) =>
        this.getEntityMetadataMap(live.liveData).pipe(
          map(
            (entityMetadata): ParkDashboardState => ({
              loading: false,
              error: null,
              lastRefreshed: new Date(),
              liveData: live.liveData,
              schedule: schedule.schedule,
              timezone: live.timezone,
              areaMap,
              entityMetadata,
            })
          )
        )
      ),
      catchError(
        (error: unknown): Observable<ParkDashboardState> =>
          of({
            loading: false,
            error: this.toErrorMessage(error),
            lastRefreshed: null,
            liveData: [],
            schedule: [],
            timezone: 'America/New_York',
            areaMap: {},
            entityMetadata: {},
          })
      )
    );

    return showInitialLoading ? request$.pipe(startWith(emptyState)) : request$;
  }

  private fetchAllParksState(
    showInitialLoading: boolean
  ): Observable<AllParksDashboardState> {
    const emptyState: AllParksDashboardState = {
      loading: true,
      error: null,
      lastRefreshed: null,
      parks: [],
    };

    const request$ = forkJoin(PARKS.map((park) => this.loadParkBundle(park.id))).pipe(
      map(
        (parks): AllParksDashboardState => ({
          loading: false,
          error: null,
          lastRefreshed: new Date(),
          parks,
        })
      ),
      catchError(
        (error: unknown): Observable<AllParksDashboardState> =>
          of({
            loading: false,
            error: this.toErrorMessage(error),
            lastRefreshed: null,
            parks: [],
          })
      )
    );

    return showInitialLoading ? request$.pipe(startWith(emptyState)) : request$;
  }

  private loadParkBundle(parkId: string): Observable<ParkLiveBundle> {
    const park = PARKS.find((entry) => entry.id === parkId);
    if (!park) {
      return throwError(() => new Error(`Unknown park: ${parkId}`));
    }

    return forkJoin({
      live: this.getLiveData(parkId),
      schedule: this.getSchedule(parkId),
      areaMap: this.getAreaMap(parkId),
    }).pipe(
      switchMap(({ live, schedule, areaMap }) =>
        this.getEntityMetadataMap(live.liveData).pipe(
          map(
            (entityMetadata): ParkLiveBundle => ({
              parkId: park.id,
              parkName: park.name,
              parkShortName: park.shortName,
              resort: park.resort,
              timezone: live.timezone,
              liveData: live.liveData,
              schedule: schedule.schedule,
              areaMap,
              entityMetadata,
            })
          )
        )
      )
    );
  }

  private getParkChildren(parkId: string): Observable<EntityChildrenResponse> {
    if (!this.childrenCache.has(parkId)) {
      const request$ = this.http
        .get<EntityChildrenResponse>(`${API_BASE_URL}/entity/${parkId}/children`)
        .pipe(shareReplay(1));
      this.childrenCache.set(parkId, request$);
    }

    return this.childrenCache.get(parkId)!;
  }

  private buildAreaMap(
    children: EntityChildrenResponse['children'],
    parkId: string
  ): Record<string, string> {
    const byId = new Map(children.map((child) => [child.id, child]));
    const areaNames = new Set(['AREA', 'LAND', 'ZONE', 'DISTRICT', 'PAVILION']);
    const map: Record<string, string> = {};

    for (const child of children) {
      if (!areaNames.has(child.entityType)) {
        continue;
      }

      for (const descendant of children) {
        if (descendant.parentId === child.id) {
          map[descendant.id] = child.name;
        }
      }
    }

    // Fallback: direct parent name when parent is not the park itself.
    for (const child of children) {
      if (map[child.id]) {
        continue;
      }
      const parent = child.parentId ? byId.get(child.parentId) : undefined;
      if (parent && parent.id !== parkId && areaNames.has(parent.entityType)) {
        map[child.id] = parent.name;
      }
    }

    return map;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return 'Unable to load park data. Please try again.';
  }
}