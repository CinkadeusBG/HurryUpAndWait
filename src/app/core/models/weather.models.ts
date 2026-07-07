import { ResortId } from '../constants/park.constants';
import { WeatherIconVariant } from '../utils/weather.utils';

export interface WeatherSnapshot {
  resort: ResortId;
  temperatureF: number;
  label: string;
  iconVariant: WeatherIconVariant;
  isDay: boolean;
  observedAt: Date;
}

export interface ResortWeatherState {
  loading: boolean;
  error: string | null;
  weather: WeatherSnapshot | null;
}

export interface OpenMeteoCurrentResponse {
  current: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    is_day: number;
  };
}