import omittedAttractionsData from '../data/omitted-attractions.json';

export interface OmittedAttractionEntry {
  id?: string;
  name: string;
  note?: string;
}

interface OmittedAttractionsFile {
  description?: string;
  attractions: OmittedAttractionEntry[];
}

const omittedFile = omittedAttractionsData as OmittedAttractionsFile;

const OMITTED_IDS = new Set(
  omittedFile.attractions
    .map((entry) => entry.id?.trim())
    .filter((id): id is string => !!id)
);

const OMITTED_NAMES = new Set(
  omittedFile.attractions.map((entry) => normalizeOmittedName(entry.name))
);

function normalizeOmittedName(name: string): string {
  return name.trim().toLowerCase();
}

/** True when an entity is listed in omitted-attractions.json (by id or name). */
export function isOmittedAttraction(item: { id: string; name: string }): boolean {
  if (OMITTED_IDS.has(item.id)) {
    return true;
  }

  return OMITTED_NAMES.has(normalizeOmittedName(item.name));
}

/** Read-only list for debugging or future admin UI. */
export function getOmittedAttractions(): readonly OmittedAttractionEntry[] {
  return omittedFile.attractions;
}