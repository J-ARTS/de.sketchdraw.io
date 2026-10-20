import { DOMAIN_LIMITS } from './limits';

/** Page id used for the single page of a migrated v1 document and for elements created without a page. */
export const DEFAULT_PAGE_ID = 'page:1';
export const DEFAULT_PAGE_NAME = 'Seite 1';
/** Legacy renderer keys (schema v1 compatibility storage of the multi-page preview). */
export const LEGACY_PAGE_NAME_KEY = 'sketchdraw.page.v1.name';
export const LEGACY_PAGE_STATE_KEY = 'sketchdraw.pages.compat.v1';

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const validPageName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= DOMAIN_LIMITS.MAX_PAGE_NAME_LENGTH;

/** Copies the metadata without the legacy page keys. Hostile keys such as __proto__ stay own properties so validation rejects them. */
function withoutLegacyKeys(metadata: unknown): Raw {
  if (!isRecord(metadata)) return metadata as Raw;
  return Object.fromEntries(Object.getOwnPropertyNames(metadata).filter((key) => key !== LEGACY_PAGE_NAME_KEY && key !== LEGACY_PAGE_STATE_KEY).map((key) => [key, metadata[key]]));
}

function singlePage(input: Raw): Raw {
  const metadata = isRecord(input['metadata']) ? input['metadata'] : {};
  const stored = metadata[LEGACY_PAGE_NAME_KEY];
  const name = validPageName(stored) ? stored.trim() : DEFAULT_PAGE_NAME;
  const elements = Array.isArray(input['elements']) ? input['elements'].map((element) => (isRecord(element) ? { ...element, pageId: DEFAULT_PAGE_ID } : element)) : input['elements'];
  return { ...input, schemaVersion: 2, pages: [{ id: DEFAULT_PAGE_ID, name }], elements, metadata: withoutLegacyKeys(metadata) };
}

/** Pages of the v1 multi-page preview: the active page is `elements`, the others live in the compatibility metadata. */
function legacyPages(input: Raw): Raw | null {
  const metadata = isRecord(input['metadata']) ? input['metadata'] : null;
  const raw = metadata?.[LEGACY_PAGE_STATE_KEY];
  if (typeof raw !== 'string' || !Array.isArray(input['elements'])) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed['version'] !== 1 || typeof parsed['activePageId'] !== 'string' || !Array.isArray(parsed['pages'])) return null;
    const stored = parsed['pages'];
    if (stored.length < 1 || stored.length > DOMAIN_LIMITS.MAX_PAGES) return null;
    const pages: Raw[] = []; const elements: unknown[] = []; const seen = new Set<string>();
    for (const candidate of stored) {
      if (!isRecord(candidate) || typeof candidate['id'] !== 'string' || !candidate['id'] || seen.has(candidate['id']) || !validPageName(candidate['name'])) return null;
      seen.add(candidate['id']);
      const pageElements = candidate['id'] === parsed['activePageId'] ? input['elements'] : candidate['elements'];
      if (!Array.isArray(pageElements)) return null;
      pages.push({ id: candidate['id'], name: candidate['name'].trim() });
      for (const element of pageElements) elements.push(isRecord(element) ? { ...element, pageId: candidate['id'] } : element);
    }
    if (!seen.has(parsed['activePageId'])) return null;
    return { ...input, schemaVersion: 2, pages, elements, metadata: withoutLegacyKeys(metadata) };
  } catch { return null; }
}

/**
 * Candidates for turning a schema-v1 document into v2, best first: the multi-page preview stored in the metadata, then a
 * single page. The ids are deterministic so that peers and repeated loads migrate identically.
 */
export function migrateV1Candidates(input: Raw): Raw[] {
  const candidates: Raw[] = [];
  const pages = legacyPages(input);
  if (pages) candidates.push(pages);
  candidates.push(singlePage(input));
  return candidates;
}
