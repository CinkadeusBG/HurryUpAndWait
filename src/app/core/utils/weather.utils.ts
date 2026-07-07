export type WeatherIconVariant =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy-day'
  | 'partly-cloudy-night'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'thunder';

/** Maps Open-Meteo WMO weather codes to accessible labels and icon variants. */
export function mapWeatherCode(
  code: number,
  isDay: boolean
): { label: string; iconVariant: WeatherIconVariant } {
  if (code === 0) {
    return { label: 'Clear', iconVariant: isDay ? 'clear-day' : 'clear-night' };
  }
  if (code === 1) {
    return {
      label: 'Mostly clear',
      iconVariant: isDay ? 'clear-day' : 'clear-night',
    };
  }
  if (code === 2) {
    return {
      label: 'Partly cloudy',
      iconVariant: isDay ? 'partly-cloudy-day' : 'partly-cloudy-night',
    };
  }
  if (code === 3) {
    return { label: 'Overcast', iconVariant: 'cloudy' };
  }
  if (code === 45 || code === 48) {
    return { label: 'Foggy', iconVariant: 'fog' };
  }
  if (code >= 51 && code <= 57) {
    return { label: 'Drizzle', iconVariant: 'rain' };
  }
  if (code >= 61 && code <= 67) {
    return { label: 'Rain', iconVariant: 'rain' };
  }
  if (code >= 71 && code <= 77) {
    return { label: 'Snow', iconVariant: 'snow' };
  }
  if (code >= 80 && code <= 82) {
    return { label: 'Showers', iconVariant: 'rain' };
  }
  if (code === 85 || code === 86) {
    return { label: 'Snow showers', iconVariant: 'snow' };
  }
  if (code >= 95 && code <= 99) {
    return { label: 'Thunderstorms', iconVariant: 'thunder' };
  }

  return { label: 'Current conditions', iconVariant: 'cloudy' };
}

export function formatTemperatureF(value: number): number {
  return Math.round(value);
}