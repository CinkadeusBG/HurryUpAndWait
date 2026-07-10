import { ResortId } from '../constants/park.constants';
import { WeatherIconVariant } from '../utils/weather.utils';

export interface WeatherSnapshot {
  resort: ResortId;
  temperatureF: number;
  label: string;
  iconVariant: WeatherIconVariant;
  isDay: boolean;
  observedAt: Date;
  /** Highest hourly precipitation probability over the next few hours. */
  precipProbabilityNext3h: number | null;
}

export interface ResortWeatherState {
  loading: boolean;
  error: string | null;
  weather: WeatherSnapshot | null;
}

/** Short-horizon hourly slot for the info-channel weather strip. */
export interface WeatherHourlyPoint {
  time: string;
  temperatureF: number;
  precipProbability: number | null;
  label: string;
  iconVariant: WeatherIconVariant;
}

export interface ResortForecastState {
  loading: boolean;
  error: string | null;
  weather: WeatherSnapshot | null;
  hourly: WeatherHourlyPoint[];
}

export interface OpenMeteoCurrentResponse {
  current: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    is_day: number;
  };
  hourly?: {
    time: string[];
    precipitation_probability?: Array<number | null>;
    temperature_2m?: Array<number | null>;
    weather_code?: Array<number | null>;
  };
}