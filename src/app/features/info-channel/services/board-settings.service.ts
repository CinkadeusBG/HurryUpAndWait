import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import {
  BOARD_DEFAULT_ROTATION_MS,
  BOARD_MAX_ROTATION_MS,
  BOARD_MIN_ROTATION_MS,
  BOARD_SETTINGS_STORAGE_KEY,
} from '../board.constants';

/**
 * Board-only preferences (localStorage).
 * Interval-only for now; structure allows future options without migration churn.
 */
@Injectable({ providedIn: 'root' })
export class BoardSettingsService {
  private readonly rotationMsSubject = new BehaviorSubject<number>(
    this.loadRotationMs()
  );

  readonly rotationMs$: Observable<number> = this.rotationMsSubject.asObservable();

  get rotationMs(): number {
    return this.rotationMsSubject.value;
  }

  setRotationMs(valueMs: number): void {
    const clamped = clampRotationMs(valueMs);
    localStorage.setItem(BOARD_SETTINGS_STORAGE_KEY, String(clamped));
    this.rotationMsSubject.next(clamped);
  }

  private loadRotationMs(): number {
    const raw = localStorage.getItem(BOARD_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return BOARD_DEFAULT_ROTATION_MS;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return BOARD_DEFAULT_ROTATION_MS;
    }

    return clampRotationMs(parsed);
  }
}

export function clampRotationMs(valueMs: number): number {
  if (!Number.isFinite(valueMs)) {
    return BOARD_DEFAULT_ROTATION_MS;
  }

  return Math.min(
    BOARD_MAX_ROTATION_MS,
    Math.max(BOARD_MIN_ROTATION_MS, Math.round(valueMs))
  );
}
