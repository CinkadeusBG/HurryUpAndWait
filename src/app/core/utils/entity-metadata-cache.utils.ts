import { EntityMetadata } from '../models/theme-parks.models';

const STORAGE_KEY = 'orlando-park-pulse-entity-metadata';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CachedEntityMetadataEntry extends EntityMetadata {
  cachedAt: number;
}

type EntityMetadataCacheFile = Record<string, CachedEntityMetadataEntry>;

function readCacheFile(): EntityMetadataCacheFile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as EntityMetadataCacheFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCacheFile(cache: EntityMetadataCacheFile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore quota/private-mode failures; network fallback still works.
  }
}

function isFresh(entry: CachedEntityMetadataEntry, now = Date.now()): boolean {
  return now - entry.cachedAt < CACHE_TTL_MS;
}

/** Returns cached static metadata when still fresh. */
export function getCachedEntityMetadata(entityId: string): EntityMetadata | null {
  const entry = readCacheFile()[entityId];
  if (!entry || !isFresh(entry)) {
    return null;
  }

  return {
    attractionType: entry.attractionType,
    externalId: entry.externalId,
  };
}

/** Persists attractionType/externalId for long-lived reuse across sessions. */
export function setCachedEntityMetadata(
  entityId: string,
  metadata: EntityMetadata
): void {
  const cache = readCacheFile();
  cache[entityId] = {
    attractionType: metadata.attractionType,
    externalId: metadata.externalId,
    cachedAt: Date.now(),
  };
  writeCacheFile(cache);
}

/** Bulk-read fresh cache entries for the requested entity ids. */
export function getCachedEntityMetadataMap(
  entityIds: string[]
): Record<string, EntityMetadata> {
  const cache = readCacheFile();
  const now = Date.now();
  const result: Record<string, EntityMetadata> = {};

  for (const entityId of entityIds) {
    const entry = cache[entityId];
    if (!entry || !isFresh(entry, now)) {
      continue;
    }

    result[entityId] = {
      attractionType: entry.attractionType,
      externalId: entry.externalId,
    };
  }

  return result;
}