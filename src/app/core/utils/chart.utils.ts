import {
  Chart,
  ChartConfiguration,
  ChartOptions,
  TooltipItem,
} from 'chart.js';
import { WaitTimeSnapshot } from '../models/historical.models';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function formatHourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? 'PM' : 'AM';
  const hour12 = normalized % 12 === 0 ? 12 : normalized % 12;
  return `${hour12} ${suffix}`;
}

export function formatTimeLabel(isoTimestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(isoTimestamp));
}

export function getRecentEntries(
  entries: WaitTimeSnapshot[],
  hours: number,
  timeZone: string
): WaitTimeSnapshot[] {
  if (!entries.length) {
    return [];
  }

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return entries
    .filter((entry) => new Date(entry.timestamp).getTime() >= cutoff)
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    );
}

export function getTodayEntries(
  entries: WaitTimeSnapshot[],
  timeZone: string
): WaitTimeSnapshot[] {
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  return entries
    .filter((entry) => {
      const entryKey = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(entry.timestamp));
      return entryKey === todayKey;
    })
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
    );
}

export function computeHourlyAverages(
  entries: WaitTimeSnapshot[],
  timeZone: string
): { hour: number; label: string; averageWait: number | null; sampleCount: number }[] {
  const buckets = new Map<number, number[]>();

  for (const entry of entries) {
    if (entry.waitTime === null || entry.status !== 'OPERATING') {
      continue;
    }

    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        hour12: false,
      }).format(new Date(entry.timestamp))
    );

    const values = buckets.get(hour) ?? [];
    values.push(entry.waitTime);
    buckets.set(hour, values);
  }

  return Array.from({ length: 24 }, (_, hour) => {
    const values = buckets.get(hour) ?? [];
    const average =
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;

    return {
      hour,
      label: formatHourLabel(hour),
      averageWait: average,
      sampleCount: values.length,
    };
  });
}

export function computeDayOfWeekAverages(
  entries: WaitTimeSnapshot[],
  timeZone: string
): { dayIndex: number; label: string; averageWait: number | null; sampleCount: number }[] {
  const buckets = new Map<number, number[]>();

  for (const entry of entries) {
    if (entry.waitTime === null || entry.status !== 'OPERATING') {
      continue;
    }

    const dayIndex = new Date(entry.timestamp).toLocaleDateString('en-US', {
      timeZone,
      weekday: 'short',
    });
    const index = DAY_LABELS.indexOf(dayIndex as (typeof DAY_LABELS)[number]);
    if (index < 0) {
      continue;
    }

    const values = buckets.get(index) ?? [];
    values.push(entry.waitTime);
    buckets.set(index, values);
  }

  return DAY_LABELS.map((label, dayIndex) => {
    const values = buckets.get(dayIndex) ?? [];
    const average =
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;

    return {
      dayIndex,
      label,
      averageWait: average,
      sampleCount: values.length,
    };
  });
}

export function waitValueForChart(waitTime: number | null): number | null {
  return waitTime === null ? null : waitTime;
}

export interface WaitChartPalette {
  line: string;
  fill: string;
  grid: string;
  text: string;
}

export const DEFAULT_CHART_PALETTE: WaitChartPalette = {
  line: '#3b9eff',
  fill: 'rgba(59, 158, 255, 0.18)',
  grid: 'rgba(255, 255, 255, 0.08)',
  text: '#8fa0c4',
};

/** Y-axis defaults for wait-time line charts — always anchor at 0 min. */
export const LINE_CHART_Y_SCALE = {
  beginAtZero: true,
  min: 0,
  suggestedMin: 0,
} as const;

export function buildLineChartConfig(
  labels: string[],
  values: (number | null)[],
  palette: WaitChartPalette = DEFAULT_CHART_PALETTE,
  options?: Partial<ChartOptions<'line'>>
): ChartConfiguration<'line'> {
  const { scales: scaleOverrides, plugins: pluginOverrides, ...otherOptions } = options ?? {};
  const xOverrides = scaleOverrides?.['x'];
  const yOverrides = scaleOverrides?.['y'];

  return {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderColor: palette.line,
          backgroundColor: palette.fill,
          borderWidth: 2,
          pointRadius: values.length > 24 ? 0 : 2,
          pointHoverRadius: 4,
          tension: 0.35,
          fill: true,
          spanGaps: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<'line'>) => {
              const value = context.parsed.y;
              return value === null ? 'No wait data' : `${value} min`;
            },
          },
        },
        ...pluginOverrides,
      },
      scales: {
        x: {
          ticks: {
            color: palette.text,
            maxTicksLimit: 6,
            font: { size: 10 },
          },
          grid: { color: palette.grid },
          ...xOverrides,
        },
        y: {
          type: 'linear',
          ...LINE_CHART_Y_SCALE,
          ticks: {
            color: palette.text,
            font: { size: 10 },
            callback: (value) => `${value}`,
            ...yOverrides?.ticks,
          },
          grid: { color: palette.grid, ...yOverrides?.grid },
          title: {
            display: false,
            ...yOverrides?.title,
          },
          display: yOverrides?.display,
          // Re-apply after overrides so callers cannot accidentally drop the zero baseline.
          beginAtZero: true,
          min: 0,
          suggestedMin: 0,
        },
      },
      ...otherOptions,
    },
  };
}

export function buildBarChartConfig(
  labels: string[],
  values: (number | null)[],
  palette: WaitChartPalette = DEFAULT_CHART_PALETTE
): ChartConfiguration<'bar'> {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: palette.fill,
          borderColor: palette.line,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<'bar'>) => {
              const value = context.parsed.y;
              return value === null ? 'No data' : `${value} min avg`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: palette.text, font: { size: 10 } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: palette.text, font: { size: 10 } },
          grid: { color: palette.grid },
        },
      },
    },
  };
}

export function destroyChart(chart: Chart | null | undefined): void {
  chart?.destroy();
}