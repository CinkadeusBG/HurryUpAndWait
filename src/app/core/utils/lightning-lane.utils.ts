import {
  EntityMetadata,
  LiveDataItem,
  PurchasePrice,
  ScheduleEntry,
  SchedulePurchase,
} from '../models/theme-parks.models';
import { formatParkDateKey } from './attraction.utils';

const PREMIER_PASS_ID_PREFIX = 'premierpass_';
const MULTI_PASS_ID_PREFIX = 'lightninglanemultipass_';
const LIGHTNING_LANE_ID_PREFIX = 'lightninglane_';

export interface ParkLightningLanePricing {
  multiPass: string | null;
  premierPass: string | null;
  multiPassSoldOut: boolean;
  premierPassSoldOut: boolean;
}

/** Round up to whole dollars and omit cents (e.g. $21.00 → $21, $21.01 → $22). */
export function formatLightningLanePriceRounded(
  price: PurchasePrice | null | undefined
): string | null {
  if (!price) {
    return null;
  }

  if (typeof price.amount === 'number' && Number.isFinite(price.amount)) {
    return `$${Math.ceil(price.amount / 100)}`;
  }

  if (price.formatted) {
    const match = price.formatted.match(/[\d.]+/);
    if (match) {
      return `$${Math.ceil(parseFloat(match[0]))}`;
    }
  }

  return null;
}

/** Today's OPERATING schedule row (holds Lightning Lane purchase prices). */
export function getTodayOperatingScheduleEntry(
  schedule: ScheduleEntry[],
  timezone: string
): ScheduleEntry | undefined {
  const today = formatParkDateKey(timezone);
  return schedule.find((entry) => entry.date === today && entry.type === 'OPERATING');
}

/** Park-level Lightning Lane Multi Pass and Premier Pass prices for today. */
export function getParkLightningLanePricing(
  schedule: ScheduleEntry[],
  timezone: string
): ParkLightningLanePricing {
  const operating = getTodayOperatingScheduleEntry(schedule, timezone);
  const purchases = operating?.purchases ?? [];

  const multi = purchases.find((purchase) =>
    purchase.id.startsWith(MULTI_PASS_ID_PREFIX)
  );
  const premier = purchases.find((purchase) =>
    purchase.id.startsWith(PREMIER_PASS_ID_PREFIX)
  );

  return {
    multiPass: formatLightningLanePriceRounded(multi?.price),
    premierPass: formatLightningLanePriceRounded(premier?.price),
    multiPassSoldOut: multi?.available === false,
    premierPassSoldOut: premier?.available === false,
  };
}

/** Premier Pass price for a park today (from schedule purchases). */
export function getPremierPassPrice(
  schedule: ScheduleEntry[],
  timezone: string
): string | null {
  return getParkLightningLanePricing(schedule, timezone).premierPass;
}

export function hasLightningLanePricePair(
  llPrice: string | null | undefined,
  premierPassPrice: string | null | undefined
): boolean {
  return !!(llPrice || premierPassPrice);
}

/** Map Disney attraction external IDs to schedule Lightning Lane purchase rows. */
export function buildLightningLanePurchaseMap(
  schedule: ScheduleEntry[],
  timezone: string
): Map<string, SchedulePurchase> {
  const operating = getTodayOperatingScheduleEntry(schedule, timezone);
  const map = new Map<string, SchedulePurchase>();

  for (const purchase of operating?.purchases ?? []) {
    if (
      purchase.type === 'ATTRACTION' &&
      purchase.id.startsWith(LIGHTNING_LANE_ID_PREFIX) &&
      (purchase.price?.amount != null || purchase.price?.formatted)
    ) {
      map.set(purchase.id.slice(LIGHTNING_LANE_ID_PREFIX.length), purchase);
    }
  }

  return map;
}

function resolveDisneyExternalId(
  item: LiveDataItem,
  metadata?: EntityMetadata
): string | null {
  const externalId = item.externalId ?? metadata?.externalId;
  if (!externalId) {
    return null;
  }

  const disneyId = externalId.split(';')[0]?.trim();
  return disneyId || null;
}

export interface LightningLanePriceInfo {
  formatted: string;
  available: boolean | null;
}

/** Individual Lightning Lane price — live PAID_RETURN_TIME first, then schedule purchase. */
export function getLightningLanePrice(
  item: LiveDataItem,
  metadata: EntityMetadata | undefined,
  purchaseMap: Map<string, SchedulePurchase>
): LightningLanePriceInfo | null {
  const paidReturn = item.queue?.PAID_RETURN_TIME;
  const paidFormatted = formatLightningLanePriceRounded(paidReturn?.price);
  if (paidFormatted) {
    return {
      formatted: paidFormatted,
      available: resolvePaidReturnAvailability(paidReturn?.state),
    };
  }

  const disneyId = resolveDisneyExternalId(item, metadata);
  if (!disneyId) {
    return null;
  }

  const purchase = purchaseMap.get(disneyId);
  const purchaseFormatted = formatLightningLanePriceRounded(purchase?.price);
  if (!purchaseFormatted) {
    return null;
  }

  return {
    formatted: purchaseFormatted,
    available: purchase?.available ?? null,
  };
}

function resolvePaidReturnAvailability(
  state: string | undefined
): boolean | null {
  if (state === 'AVAILABLE') {
    return true;
  }
  if (state === 'FINISHED' || state === 'TEMP_FULL') {
    return false;
  }
  return null;
}