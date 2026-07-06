/** Maps Open-Meteo WMO weather codes to compact badge labels and PrimeIcons. */
export function mapWeatherCode(
  code: number,
  isDay: boolean
): { label: string; iconClass: string } {
  if (code === 0) {
    return { label: 'Clear', iconClass: isDay ? 'pi pi-sun' : 'pi pi-moon' };
  }
  if (code === 1) {
    return { label: 'Mostly clear', iconClass: isDay ? 'pi pi-sun' : 'pi pi-moon' };
  }
  if (code === 2) {
    return { label: 'Partly cloudy', iconClass: 'pi pi-cloud' };
  }
  if (code === 3) {
    return { label: 'Overcast', iconClass: 'pi pi-cloud' };
  }
  if (code === 45 || code === 48) {
    return { label: 'Foggy', iconClass: 'pi pi-cloud' };
  }
  if (code >= 51 && code <= 57) {
    return { label: 'Drizzle', iconClass: 'pi pi-cloud' };
  }
  if (code >= 61 && code <= 67) {
    return { label: 'Rain', iconClass: 'pi pi-cloud' };
  }
  if (code >= 71 && code <= 77) {
    return { label: 'Snow', iconClass: 'pi pi-cloud' };
  }
  if (code >= 80 && code <= 82) {
    return { label: 'Showers', iconClass: 'pi pi-cloud' };
  }
  if (code === 85 || code === 86) {
    return { label: 'Snow showers', iconClass: 'pi pi-cloud' };
  }
  if (code >= 95 && code <= 99) {
    return { label: 'Thunderstorms', iconClass: 'pi pi-bolt' };
  }

  return { label: 'Current conditions', iconClass: 'pi pi-cloud' };
}

export function formatTemperatureF(value: number): number {
  return Math.round(value);
}