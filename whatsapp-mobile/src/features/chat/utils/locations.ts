/**
 * Location helpers — mirrors Adminstro web (`city-normalizer`, `participantLocationPrivileges`,
 * `monthlyTargetLocations`) for inbox filters and display labels.
 */

export type LocationFilterValue = 'all' | string;

const FULL_ACCESS_ROLES = ['SuperAdmin', 'Admin', 'Developer'] as const;

export function normalizeLocationKey(city: string): string {
  return city.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function toDisplayLocation(city: string): string {
  return city.trim().replace(/\s+/g, ' ');
}

function splitAllotedAreaRaw(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((v) => String(v).split(',').map((s) => s.trim())).filter(Boolean);
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parse token allotedArea into normalized lowercase keys (deduped). */
export function parseAllotedAreaKeys(raw: string | string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of splitAllotedAreaRaw(raw)) {
    const key = normalizeLocationKey(part);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** Assigned city keys only (excludes "all" / "both"). */
export function getUserScopedLocationKeys(allotedArea: string | string[] | undefined): string[] {
  return parseAllotedAreaKeys(allotedArea).filter(
    (key) => key && key !== 'all' && key !== 'both',
  );
}

export function isSuperAdminRole(role?: string): boolean {
  return (role ?? '').trim() === 'SuperAdmin';
}

export function hasFullLocationAccess(role?: string): boolean {
  const normalized = (role ?? '').trim();
  return (FULL_ACCESS_ROLES as readonly string[]).includes(normalized);
}

function canonicalDisplayForKey(
  key: string,
  monthlyTargetCities: string[] = [],
): string {
  const match = monthlyTargetCities.find((c) => normalizeLocationKey(c) === key);
  if (match) return toDisplayLocation(match);
  return formatLocationLabel(key);
}

/** Cities shown in the inbox location picker for the current user. */
export function getInboxLocationOptions(params: {
  role?: string;
  allotedArea?: string | string[];
  monthlyTargetCities?: string[];
}): string[] {
  const { role, allotedArea, monthlyTargetCities = [] } = params;

  if (isSuperAdminRole(role)) {
    const cities = monthlyTargetCities.map((c) => toDisplayLocation(c)).filter(Boolean);
    return [...new Set(cities)].sort((a, b) => a.localeCompare(b));
  }

  const keys = getUserScopedLocationKeys(allotedArea);
  const displays = keys
    .map((key) => canonicalDisplayForKey(key, monthlyTargetCities))
    .filter(Boolean);
  return [...new Set(displays)].sort((a, b) => a.localeCompare(b));
}

/** Whether the location filter control should be shown (user has at least one city). */
export function shouldShowInboxLocationFilter(params: {
  role?: string;
  allotedArea?: string | string[];
  monthlyTargetCities?: string[];
}): boolean {
  return getInboxLocationOptions(params).length > 0 || isSuperAdminRole(params.role);
}

/** Build picker rows: always includes "all" plus each allotted city. */
export function getInboxLocationFilterChoices(params: {
  role?: string;
  allotedArea?: string | string[];
  monthlyTargetCities?: string[];
}): LocationFilterValue[] {
  const cities = getInboxLocationOptions(params);
  return ['all', ...cities.map((c) => normalizeLocationKey(c))];
}

export function locationFilterToApiParam(filter: LocationFilterValue | undefined): string | undefined {
  const raw = filter?.trim();
  if (!raw || raw === 'all') return undefined;
  return toDisplayLocation(raw);
}

/** Display label with canonical casing when the city is in the known list. */
export function formatLocationLabel(
  locationKeyOrDisplay: string | undefined,
  knownDisplays: string[] = [],
): string {
  if (!locationKeyOrDisplay?.trim()) return '';
  const key = normalizeLocationKey(locationKeyOrDisplay);
  const match = knownDisplays.find((d) => normalizeLocationKey(d) === key);
  if (match) return match;
  const display = toDisplayLocation(locationKeyOrDisplay);
  if (!display) return '';
  return display.charAt(0).toUpperCase() + display.slice(1);
}

export function resolveConversationArea(
  conversation: { participantLocationKey?: string },
  fallback?: string,
): string {
  const key = conversation.participantLocationKey?.trim();
  if (key) return normalizeLocationKey(key);
  return fallback ? normalizeLocationKey(fallback) : '';
}

/** Parse GET /monthlyTargets/getLocations `locations` payload. */
export function parseMonthlyTargetLocationNames(locations: unknown): string[] {
  if (!Array.isArray(locations)) return [];

  return locations
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'city' in item) {
        return String((item as { city?: unknown }).city ?? '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

/** First allotted city key, or first monthly-target city for SuperAdmin. */
export function resolveDefaultLocationKey(params: {
  role?: string;
  allotedArea?: string | string[];
  monthlyTargetCities?: string[];
}): string {
  const options = getInboxLocationOptions(params);
  if (options.length > 0) return normalizeLocationKey(options[0]);
  return 'athens';
}
