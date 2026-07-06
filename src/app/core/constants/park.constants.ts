/** User-facing app name (repo: HurryUpAndWait). */
export const APP_NAME = 'Hurry Up and Wait';

/** Resort and park identifiers for ThemeParks.wiki API. */
export type ResortId = 'wdw' | 'universal';

export interface ParkConfig {
  id: string;
  name: string;
  shortName: string;
  resort: ResortId;
}

export const WDW_DESTINATION_ID = 'e957da41-3552-4cf6-b636-5babc5cbc4e5';
export const UNIVERSAL_DESTINATION_ID = '89db5d43-c434-4097-b71f-f6869f495a22';

export const API_BASE_URL = 'https://api.themeparks.wiki/v1';
export const WEATHER_API_BASE_URL = 'https://api.open-meteo.com/v1';
export const REFRESH_INTERVAL_MS = 3 * 60 * 1000;
export const WEATHER_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
/** Client tick for relative labels and show-time filtering without an API round-trip. */
export const UI_TICK_INTERVAL_MS = 60 * 1000;

export interface ResortWeatherLocation {
  latitude: number;
  longitude: number;
  timezone: string;
}

/** Representative coordinates for each resort's weather badge. */
export const RESORT_WEATHER_LOCATIONS: Record<ResortId, ResortWeatherLocation> = {
  wdw: {
    latitude: 28.3852,
    longitude: -81.5639,
    timezone: 'America/New_York',
  },
  universal: {
    latitude: 28.4744,
    longitude: -81.4677,
    timezone: 'America/New_York',
  },
};

/** Curated parks for Hurry Up and Wait (WDW + Universal Orlando only). */
export const PARKS: readonly ParkConfig[] = [
  {
    id: '75ea578a-adc8-4116-a54d-dccb60765ef9',
    name: 'Magic Kingdom Park',
    shortName: 'Magic Kingdom',
    resort: 'wdw',
  },
  {
    id: '47f90d2c-e191-4239-a466-5892ef59a88b',
    name: 'EPCOT',
    shortName: 'EPCOT',
    resort: 'wdw',
  },
  {
    id: '288747d1-8b4f-4a64-867e-ea7c9b27bad8',
    name: "Disney's Hollywood Studios",
    shortName: 'Hollywood Studios',
    resort: 'wdw',
  },
  {
    id: '1c84a229-8862-4648-9c71-378ddd2c7693',
    name: "Disney's Animal Kingdom Theme Park",
    shortName: 'Animal Kingdom',
    resort: 'wdw',
  },
  {
    id: 'eb3f4560-2383-4a36-9152-6b3e5ed6bc57',
    name: 'Universal Studios Florida',
    shortName: 'Studios',
    resort: 'universal',
  },
  {
    id: '267615cc-8943-4c2a-ae2c-5da728ca591f',
    name: 'Universal Islands of Adventure',
    shortName: 'Islands of Adventure',
    resort: 'universal',
  },
  {
    id: '12dbb85b-265f-44e6-bccf-f1faa17211fc',
    name: 'Universal Epic Universe',
    shortName: 'Epic Universe',
    resort: 'universal',
  },
] as const;

export const DEFAULT_PARK_ID = PARKS[0].id;

export function getParksForResort(resort: ResortId): ParkConfig[] {
  return PARKS.filter((park) => park.resort === resort);
}

export function getParkById(parkId: string): ParkConfig | undefined {
  return PARKS.find((park) => park.id === parkId);
}

export const RESORT_THEMES: Record<
  ResortId,
  { label: string; accent: string; accentMuted: string; gradient: string }
> = {
  wdw: {
    label: 'Walt Disney World',
    accent: '#1e6fd9',
    accentMuted: '#c9a227',
    gradient: 'linear-gradient(135deg, #0d3b7a 0%, #1e6fd9 50%, #c9a227 100%)',
  },
  universal: {
    label: 'Universal Orlando',
    accent: '#7b2cbf',
    accentMuted: '#e85d04',
    gradient: 'linear-gradient(135deg, #3c096c 0%, #7b2cbf 50%, #e85d04 100%)',
  },
};