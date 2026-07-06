import { Injectable } from '@angular/core';
import { Observable, interval, map, shareReplay, startWith } from 'rxjs';
import { UI_TICK_INTERVAL_MS } from '../constants/park.constants';

/** Emits an incrementing tick so time-sensitive UI can refresh without reloading. */
@Injectable({ providedIn: 'root' })
export class ClockService {
  readonly tick$: Observable<number> = interval(UI_TICK_INTERVAL_MS).pipe(
    map((tick) => tick + 1),
    startWith(1),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}