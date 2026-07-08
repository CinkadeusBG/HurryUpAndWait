import {
  Chart,
  ChartConfiguration,
  ChartOptions,
  Plugin,
  TooltipItem,
} from 'chart.js';

interface WaitTrendPoint {
  x: number;
  y: number;
}
import { IllDailySnapshot, WaitTimeSnapshot } from '../models/historical.models';
import { formatIllLocalDate, formatIllPriceCents } from './ill-display.utils';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const SLOTS_PER_DAY = 24 * 4;

export function getLocalHourMinute(
  isoTimestamp: string,
  timeZone: string
): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoTimestamp));

  let hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);

  if (hour === 24) {
    hour = 0;
  }

  return { hour, minute };
}

export function formatQuarterHourLabel(hour: number, minute: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minuteLabel = minute.toString().padStart(2, '0');
  return `${hour12}:${minuteLabel} ${suffix}`;
}

function getWeekdayIndex(isoTimestamp: string, timeZone: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(isoTimestamp));

  return DAY_LABELS.indexOf(weekday as (typeof DAY_LABELS)[number]);
}

export function hasChartWaitValue(entry: WaitTimeSnapshot): boolean {
  return entry.waitTime !== null && Number.isFinite(entry.waitTime);
}

/** Nearest dataset index for linear time-scale hover (Chart.js nearest mode often misses). */
export function findNearestWaitTrendIndex(
  chart: Chart<'line'>,
  xPixel: number
): number {
  const xScale = chart.scales['x'];
  if (!xScale) {
    return -1;
  }

  const hoverMs = xScale.getValueForPixel(xPixel);
  if (hoverMs === undefined || hoverMs === null || !Number.isFinite(Number(hoverMs))) {
    return -1;
  }

  const data = chart.data.datasets[0]?.data as WaitTrendPoint[] | undefined;
  if (!data?.length) {
    return -1;
  }

  let bestIndex = -1;
  let bestDistance = Infinity;

  for (let index = 0; index < data.length; index++) {
    const pointX = data[index]?.x;
    if (pointX === undefined || !Number.isFinite(pointX)) {
      continue;
    }

    const distance = Math.abs(pointX - Number(hoverMs));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

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

/** Compact hour label for chart axes, e.g. 9a, 12p, 11p. */
export function formatCompactHourLabel(isoTimestamp: string, timeZone: string): string {
  const { hour } = getLocalHourMinute(isoTimestamp, timeZone);
  const suffix = hour >= 12 ? 'p' : 'a';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${suffix}`;
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
    if (!hasChartWaitValue(entry)) {
      continue;
    }

    const { hour } = getLocalHourMinute(entry.timestamp, timeZone);
    const values = buckets.get(hour) ?? [];
    values.push(entry.waitTime!);
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

/** Typical wait by 15-minute time-of-day slot across all collected days. */
export function computeFifteenMinuteAverages(
  entries: WaitTimeSnapshot[],
  timeZone: string
): {
  slot: number;
  label: string;
  averageWait: number | null;
  sampleCount: number;
}[] {
  const buckets = new Map<number, number[]>();

  for (const entry of entries) {
    if (!hasChartWaitValue(entry)) {
      continue;
    }

    const { hour, minute } = getLocalHourMinute(entry.timestamp, timeZone);
    const slot = hour * 4 + Math.floor(minute / 15);
    const values = buckets.get(slot) ?? [];
    values.push(entry.waitTime!);
    buckets.set(slot, values);
  }

  return Array.from({ length: SLOTS_PER_DAY }, (_, slot) => {
    const hour = Math.floor(slot / 4);
    const minute = (slot % 4) * 15;
    const values = buckets.get(slot) ?? [];
    const average =
      values.length > 0
        ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
        : null;

    return {
      slot,
      label: formatQuarterHourLabel(hour, minute),
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
    if (!hasChartWaitValue(entry)) {
      continue;
    }

    const index = getWeekdayIndex(entry.timestamp, timeZone);
    if (index < 0) {
      continue;
    }

    const values = buckets.get(index) ?? [];
    values.push(entry.waitTime!);
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

const WAIT_AXIS_MIN = 15;
const WAIT_AXIS_HEADROOM = 5;
const WAIT_AXIS_TICK_STEP = 15;

/** Upper Y bound: peak wait + headroom, rounded up to tick step (never clips the peak). */
export function computeWaitAxisMax(values: number[]): number {
  const peak = values.length > 0 ? Math.max(...values) : 0;
  const padded = peak + WAIT_AXIS_HEADROOM;
  return Math.max(
    WAIT_AXIS_MIN,
    Math.ceil(padded / WAIT_AXIS_TICK_STEP) * WAIT_AXIS_TICK_STEP
  );
}

export function buildDetailWaitTrendConfig(
  entries: WaitTimeSnapshot[],
  timeZone: string,
  palette: WaitChartPalette = DEFAULT_CHART_PALETTE
): ChartConfiguration<'line'> {
  const points = entries
    .filter(hasChartWaitValue)
    .map((entry) => ({
      x: new Date(entry.timestamp).getTime(),
      y: entry.waitTime as number,
    }))
    .sort((left, right) => left.x - right.x);

  const minX = points[0]?.x ?? Date.now();
  const maxX = points.at(-1)?.x ?? Date.now();
  const tickMin = Math.floor(minX / ONE_HOUR_MS) * ONE_HOUR_MS;
  const tickMax = Math.ceil(maxX / ONE_HOUR_MS) * ONE_HOUR_MS;
  const yMax = computeWaitAxisMax(points.map((point) => point.y));

  return {
    type: 'line',
    data: {
      datasets: [
        {
          data: points,
          borderColor: palette.line,
          backgroundColor: palette.fill,
          borderWidth: 2.5,
          pointRadius: points.length > 48 ? 0 : 3,
          pointHoverRadius: 6,
          pointHitRadius: 18,
          tension: 0.3,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: {
        mode: 'nearest',
        intersect: false,
        axis: 'x',
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: tickMin,
          max: tickMax,
          ticks: {
            stepSize: ONE_HOUR_MS,
            color: palette.text,
            font: { size: 11 },
            maxRotation: 0,
            autoSkip: false,
            maxTicksLimit: 18,
            callback: (value) =>
              formatCompactHourLabel(
                new Date(Number(value)).toISOString(),
                timeZone
              ),
          },
          grid: { color: palette.grid },
          title: {
            display: true,
            text: 'Time (ET)',
            color: palette.text,
            font: { size: 11 },
          },
        },
        y: {
          ...LINE_CHART_Y_SCALE,
          max: yMax,
          ticks: {
            stepSize: 15,
            color: palette.text,
            font: { size: 11 },
            callback: (value) => `${value}`,
          },
          grid: { color: palette.grid },
          title: {
            display: true,
            text: 'Wait (min)',
            color: palette.text,
            font: { size: 11 },
          },
        },
      },
    },
  };
}

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
  palette: WaitChartPalette = DEFAULT_CHART_PALETTE,
  options?: Partial<ChartOptions<'bar'>>
): ChartConfiguration<'bar'> {
  const { scales: scaleOverrides, plugins: pluginOverrides, ...otherOptions } = options ?? {};
  const xOverrides = scaleOverrides?.['x'];
  const yOverrides = scaleOverrides?.['y'];
  const yMax = computeWaitAxisMax(
    values.filter((value): value is number => value !== null)
  );

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
        ...pluginOverrides,
      },
      scales: {
        x: {
          ticks: {
            color: palette.text,
            font: { size: 10 },
            maxRotation: 45,
            autoSkip: true,
            ...xOverrides?.ticks,
          },
          grid: { display: false, ...xOverrides?.grid },
          ...xOverrides,
        },
        y: {
          beginAtZero: true,
          max: yMax,
          ticks: {
            stepSize: 15,
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
        },
      },
      ...otherOptions,
    },
  };
}

export function buildIllDailyBarChartConfig(
  snapshots: IllDailySnapshot[],
  palette: WaitChartPalette = DEFAULT_CHART_PALETTE
): ChartConfiguration<'bar'> {
  const labels = snapshots.map((entry) => formatIllLocalDate(entry.localDate));
  const values = snapshots.map((entry) => Math.ceil(entry.priceCents / 100));
  const backgroundColors = snapshots.map((entry) =>
    entry.soldOut ? 'rgba(148, 163, 184, 0.45)' : palette.fill
  );
  const borderColors = snapshots.map((entry) =>
    entry.soldOut ? 'rgba(248, 113, 113, 0.75)' : palette.line
  );

  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
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
              const entry = snapshots[context.dataIndex];
              if (!entry) {
                return '';
              }
              const status = entry.soldOut ? 'Sold out' : 'Available';
              return `${formatIllPriceCents(entry.priceCents)} · ${status}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: palette.text, font: { size: 10 }, maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: palette.text,
            font: { size: 10 },
            callback: (value) => `$${value}`,
          },
          grid: { color: palette.grid },
        },
      },
    },
  };
}

/** Vertical crosshair for compact sparkline hover. */
export const waitTrendCrosshairPlugin: Plugin<'line'> = {
  id: 'waitTrendCrosshair',
  afterDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active.length) {
      return;
    }

    const x = active[0].element.x;
    const { ctx, chartArea } = chart;

    ctx.save();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};

let crosshairPluginRegistered = false;

export function ensureWaitTrendCrosshairPlugin(): void {
  if (!crosshairPluginRegistered) {
    Chart.register(waitTrendCrosshairPlugin);
    crosshairPluginRegistered = true;
  }
}

export function destroyChart(chart: Chart | null | undefined): void {
  chart?.destroy();
}