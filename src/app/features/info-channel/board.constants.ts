/** Defaults and bounds for the fullscreen info-channel board. */
export const BOARD_DEFAULT_ROTATION_MS = 40_000;
export const BOARD_MIN_ROTATION_MS = 15_000;
export const BOARD_MAX_ROTATION_MS = 120_000;
export const BOARD_ROTATION_STEP_MS = 5_000;

export const BOARD_SETTINGS_STORAGE_KEY = 'orlando-park-pulse-board-rotation-ms';

/** Wait bands for the hotel-board wait columns. */
export type WaitBandId = 'major' | 'moderate' | 'light';

export const WAIT_BAND_THRESHOLDS = {
  /** Major: over this many minutes (exclusive of moderate max). */
  moderateMax: 60,
  /** Light: at or below this many minutes. */
  lightMax: 30,
} as const;

export const WAIT_BAND_META: Record<
  WaitBandId,
  { label: string; hint: string; cssClass: string }
> = {
  major: {
    label: 'Major',
    hint: 'Over 60 min',
    cssClass: 'band-major',
  },
  moderate: {
    label: 'Moderate',
    hint: '31–60 min',
    cssClass: 'band-moderate',
  },
  light: {
    label: 'Light',
    hint: '30 min or less',
    cssClass: 'band-light',
  },
};

/** How many items to show per wait band column. */
export const WAIT_BAND_LIST_LIMIT = 8;
export const RIDES_TO_AVOID_LIMIT = 6;
export const UP_NEXT_SHOWS_LIMIT = 6;
export const TOP_WAITS_CHART_LIMIT = 8;
