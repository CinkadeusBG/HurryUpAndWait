import { ScheduleEntry } from '../models/theme-parks.models';
import { formatParkDateKey } from './attraction.utils';
import {
  ParkLightningLanePricing,
  findNextScheduledMultiPassPrice,
  findNextScheduledPremierPassPrice,
} from './lightning-lane.utils';

const STORAGE_KEY_PREFIX = 'orlando-park-pulse-park-ll-seen';

interface ParkLlSeenCache {
  localDate: string;
  multiPass: string | null;
  premierPass: string | null;
}

function storageKey(parkId: string): string {
  return `${STORAGE_KEY_PREFIX}:${parkId}`;
}

function readParkLlSeenCache(
  parkId: string,
  localDate: string
): ParkLlSeenCache | null {
  try {
    const raw = localStorage.getItem(storageKey(parkId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as ParkLlSeenCache;
    if (parsed.localDate !== localDate) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeParkLlSeenCache(parkId: string, cache: ParkLlSeenCache): void {
  try {
    localStorage.setItem(storageKey(parkId), JSON.stringify(cache));
  } catch {
    // Ignore quota/private-mode failures.
  }
}

/**
 * When Disney sells out park-level LL products they often remove the purchase row
 * entirely. Keep the last price seen today so we can still show "sold out".
 */
export function mergeParkLightningLanePricingWithSeenToday(
  pricing: ParkLightningLanePricing,
  parkId: string,
  timezone: string,
  schedule: ScheduleEntry[] = []
): ParkLightningLanePricing {
  const localDate = formatParkDateKey(timezone);
  const cache = readParkLlSeenCache(parkId, localDate);
  const merged: ParkLightningLanePricing = { ...pricing };

  if (!merged.premierPass && cache?.premierPass) {
    merged.premierPass = cache.premierPass;
    merged.premierPassSoldOut = true;
  } else if (
    !merged.premierPass &&
    schedule.length > 0 &&
    pricing.multiPass
  ) {
    const nextPremierPass = findNextScheduledPremierPassPrice(schedule, timezone);
    if (nextPremierPass) {
      merged.premierPass = nextPremierPass;
      merged.premierPassSoldOut = true;
    }
  }

  if (!merged.multiPass && cache?.multiPass) {
    merged.multiPass = cache.multiPass;
    merged.multiPassSoldOut = true;
  } else if (
    !merged.multiPass &&
    schedule.length > 0 &&
    pricing.premierPass
  ) {
    const nextMultiPass = findNextScheduledMultiPassPrice(schedule, timezone);
    if (nextMultiPass) {
      merged.multiPass = nextMultiPass;
      merged.multiPassSoldOut = true;
    }
  }

  const nextCache: ParkLlSeenCache = {
    localDate,
    multiPass: cache?.multiPass ?? null,
    premierPass: cache?.premierPass ?? null,
  };

  if (pricing.multiPass) {
    nextCache.multiPass = pricing.multiPass;
  }

  if (pricing.premierPass) {
    nextCache.premierPass = pricing.premierPass;
  }

  writeParkLlSeenCache(parkId, nextCache);
  return merged;
}