import {
  Chart,
  ChartConfiguration,
  ChartOptions,
  ChartType,
  Plugin,
  TooltipItem,
} from 'chart.js';

declare module 'chart.js' {
  interface PluginOptionsByType<TType extends ChartType = ChartType> {
    weekendBarHighlight?: {
      weekendIndices?: number[];
      bandColor?: string;
    };
    weekendDayHighlight?: {
      enabled?: boolean;
      bandColor?: string;
    };
  }
}

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

/** Sun = 0 and Sat = 6 in DAY_LABELS order. */
export const WEEKEND_DAY_INDICES = [0, 6] as const;

const WEEKEND_BAND_COLOR = 'rgba(148, 163, 184, 0.11)';
const WEEKEND_TICK_COLOR = '#b7c4e8';

export interface HistoryBarChartOptions extends Partial<ChartOptions<'bar'>> {
  weekendBarIndices?: number[];
}

export function getWeekdayShortFromLocalDate(
  localDate: string,
  timeZone: string
): string {
  const [year, month, day] = localDate.split('-').map(Number);
  if (!year || !month || !day) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

export function isWeekendLocalDate(localDate: string, timeZone: string): boolean {
  const weekday = getWeekdayShortFromLocalDate(localDate, timeZone);
  return weekday === 'Sat' || weekday === 'Sun';
}

export function isWeekendTimestamp(isoTimestamp: string, timeZone: string): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(new Date(isoTimestamp));

  return weekday === 'Sat' || weekday === 'Sun';
}

export function getWeekendBarIndicesFromLocalDates(
  localDates: string[],
  timeZone: string
): number[] {
  return localDates
    .map((localDate, index) =>
      isWeekendLocalDate(localDate, timeZone) ? index : -1
    )
    .filter((index) => index >= 0);
}

function getBarBandWidth(chart: Chart<'bar'>, index: number): number {
  const bars = chart.getDatasetMeta(0).data;
  if (bars.length <= 1) {
    return chart.chartArea.width * 0.55;
  }

  const current = bars[index]?.x ?? 0;
  if (index === 0) {
    const next = bars[1]?.x ?? current;
    return Math.abs(next - current);
  }

  if (index === bars.length - 1) {
    const prev = bars[index - 1]?.x ?? current;
    return Math.abs(current - prev);
  }

  const prev = bars[index - 1]?.x ?? current;
  const next = bars[index + 1]?.x ?? current;
  return (Math.abs(current - prev) + Math.abs(next - current)) / 2;
}

function weekendBarFill(palette: WaitChartPalette): string {
  if (palette.fill.startsWith('#')) {
    const base = palette.fill.slice(0, 7);
    return `${base}55`;
  }

  if (palette.fill.startsWith('rgba')) {
    return palette.fill.replace(/[\d.]+\)$/, '0.3)');
  }

  return palette.fill;
}

function weekendBarBorder(palette: WaitChartPalette): string {
  return palette.line;
}

/** Shaded bands behind weekend category bars. */
export const weekendBarHighlightPlugin: Plugin<'bar'> = {
  id: 'weekendBarHighlight',
  beforeDatasetsDraw(chart) {
    const weekendIndices = (
      chart.options.plugins?.weekendBarHighlight?.weekendIndices ?? []
    ).filter((index): index is number => typeof index === 'number');
    if (!weekendIndices.length) {
      return;
    }

    const { ctx, chartArea } = chart;
    const meta = chart.getDatasetMeta(0);

    ctx.save();
    ctx.fillStyle =
      chart.options.plugins?.weekendBarHighlight?.bandColor ?? WEEKEND_BAND_COLOR;

    for (const index of weekendIndices) {
      const bar = meta.data[index];
      if (!bar || typeof bar.x !== 'number') {
        continue;
      }

      const width = getBarBandWidth(chart, index);
      ctx.fillRect(
        bar.x - width / 2,
        chartArea.top,
        width,
        chartArea.bottom - chartArea.top
      );
    }

    ctx.restore();
  },
};

/** Full-chart wash when a single-day line chart falls on a weekend. */
export const weekendDayHighlightPlugin: Plugin<'line'> = {
  id: 'weekendDayHighlight',
  beforeDatasetsDraw(chart) {
    if (!chart.options.plugins?.weekendDayHighlight?.enabled) {
      return;
    }

    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.fillStyle =
      chart.options.plugins?.weekendDayHighlight?.bandColor ?? WEEKEND_BAND_COLOR;
    ctx.fillRect(
      chartArea.left,
      chartArea.top,
      chartArea.width,
      chartArea.bottom - chartArea.top
    );
    ctx.restore();
  },
};

let weekendPluginsRegistered = false;

export function ensureWeekendChartPlugins(): void {
  if (!weekendPluginsRegistered) {
    Chart.register(weekendBarHighlightPlugin, weekendDayHighlightPlugin);
    weekendPluginsRegistered = true;
  }
}

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

/** Minimum plotted points before a sparkline is shown (a line needs at least two). */
export const SPARKLINE_MIN_POINTS = 2;

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
  const highlightWeekendDay =
    entries.length > 0 &&
    entries.every((entry) => isWeekendTimestamp(entry.timestamp, timeZone));

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
        weekendDayHighlight: {
          enabled: highlightWeekendDay,
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
  options?: HistoryBarChartOptions
): ChartConfiguration<'bar'> {
  const {
    weekendBarIndices = [],
    scales: scaleOverrides,
    plugins: pluginOverrides,
    ...otherOptions
  } = options ?? {};
  const xOverrides = scaleOverrides?.['x'];
  const yOverrides = scaleOverrides?.['y'];
  const yMax = computeWaitAxisMax(
    values.filter((value): value is number => value !== null)
  );
  const weekendIndexSet = new Set(weekendBarIndices);

  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: labels.map((_, index) =>
            weekendIndexSet.has(index) ? weekendBarFill(palette) : palette.fill
          ),
          borderColor: labels.map((_, index) =>
            weekendIndexSet.has(index) ? weekendBarBorder(palette) : palette.line
          ),
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
        weekendBarHighlight: {
          weekendIndices: weekendBarIndices,
        },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<'bar'>) => {
              const value = context.parsed.y;
              const weekendNote = weekendIndexSet.has(context.dataIndex)
                ? ' · Weekend'
                : '';
              return value === null
                ? 'No data'
                : `${value} min avg${weekendNote}`;
            },
          },
        },
        ...pluginOverrides,
      },
      scales: {
        x: {
          ticks: {
            color: (context) =>
              weekendIndexSet.has(context.index)
                ? WEEKEND_TICK_COLOR
                : palette.text,
            font: (context) => ({
              size: 10,
              weight: weekendIndexSet.has(context.index) ? 700 : 500,
            }),
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
  palette: WaitChartPalette = DEFAULT_CHART_PALETTE,
  timeZone = 'America/New_York'
): ChartConfiguration<'bar'> {
  const weekendBarIndices = getWeekendBarIndicesFromLocalDates(
    snapshots.map((entry) => entry.localDate),
    timeZone
  );
  const weekendIndexSet = new Set(weekendBarIndices);
  const labels = snapshots.map((entry) => {
    const formatted = formatIllLocalDate(entry.localDate);
    if (!isWeekendLocalDate(entry.localDate, timeZone)) {
      return formatted;
    }

    return `${getWeekdayShortFromLocalDate(entry.localDate, timeZone)} ${formatted}`;
  });
  const values = snapshots.map((entry) => Math.ceil(entry.priceCents / 100));
  const backgroundColors = snapshots.map((entry, index) => {
    if (entry.soldOut) {
      return 'rgba(148, 163, 184, 0.45)';
    }

    return weekendIndexSet.has(index) ? weekendBarFill(palette) : palette.fill;
  });
  const borderColors = snapshots.map((entry, index) => {
    if (entry.soldOut) {
      return 'rgba(248, 113, 113, 0.75)';
    }

    return weekendIndexSet.has(index) ? weekendBarBorder(palette) : palette.line;
  });

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
        weekendBarHighlight: {
          weekendIndices: weekendBarIndices,
        },
        tooltip: {
          callbacks: {
            label: (context: TooltipItem<'bar'>) => {
              const entry = snapshots[context.dataIndex];
              if (!entry) {
                return '';
              }
              const status = entry.soldOut ? 'Sold out' : 'Available';
              const weekendNote = weekendIndexSet.has(context.dataIndex)
                ? ' · Weekend'
                : '';
              return `${formatIllPriceCents(entry.priceCents)} · ${status}${weekendNote}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: (context) =>
              weekendIndexSet.has(context.index)
                ? WEEKEND_TICK_COLOR
                : palette.text,
            font: (context) => ({
              size: 10,
              weight: weekendIndexSet.has(context.index) ? 700 : 500,
            }),
            maxTicksLimit: 8,
          },
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