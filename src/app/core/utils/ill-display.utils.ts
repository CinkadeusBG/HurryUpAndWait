import { IllDailySnapshot } from '../models/historical.models';

/** Whole-dollar label rounded up from USD cents. */
export function formatIllPriceCents(cents: number): string {
  return `$${Math.ceil(cents / 100)}`;
}

export function formatOptionalIllPriceCents(
  cents: number | null | undefined
): string | null {
  if (cents == null || !Number.isFinite(cents)) {
    return null;
  }

  return formatIllPriceCents(cents);
}

export function formatIllLocalDate(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  if (!year || !month || !day) {
    return localDate;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function averageIllPriceCents(entries: IllDailySnapshot[]): number | null {
  if (!entries.length) {
    return null;
  }

  const total = entries.reduce((sum, entry) => sum + entry.priceCents, 0);
  return Math.round(total / entries.length);
}

export function illSoldOutRate(entries: IllDailySnapshot[]): number {
  if (!entries.length) {
    return 0;
  }

  const soldOutDays = entries.filter((entry) => entry.soldOut).length;
  return soldOutDays / entries.length;
}