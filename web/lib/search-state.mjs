// Session-scoped and tab-local: persist search controls and page only, never catalog items.
const STORAGE_KEY = 'filtrox.search-state.v1';
const TEXT_FIELDS = [
  'query', 'requiredText', 'optionalText', 'excludedText', 'exactText',
  'includedEquivalentsText', 'excludedEquivalentsText', 'language', 'country',
];

function getSessionStorage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isCriteria(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (TEXT_FIELDS.some((field) => typeof value[field] !== 'string')) return false;
  if (!Array.isArray(value.includeTags) || !value.includeTags.every((tag) => typeof tag === 'string')) return false;
  if (!Array.isArray(value.excludeTags) || !value.excludeTags.every((tag) => typeof tag === 'string')) return false;
  if (value.includeTagsMode !== 'and' && value.includeTagsMode !== 'or') return false;
  if (value.sort !== 'recent' && value.sort !== 'most_viewed') return false;
  if (value.sortSecondary !== '' && value.sortSecondary !== 'recent' && value.sortSecondary !== 'most_viewed') return false;
  return typeof value.hideWatched === 'boolean';
}

export function readSearchState() {
  const storage = getSessionStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !isCriteria(saved.criteria)) return null;
    if (!Number.isSafeInteger(saved.page) || saved.page < 1) return null;
    return { criteria: saved.criteria, page: saved.page };
  } catch {
    return null;
  }
}

export function saveSearchState(criteria, page) {
  const storage = getSessionStorage();
  if (!storage || !isCriteria(criteria) || !Number.isSafeInteger(page) || page < 1) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, criteria, page }));
  } catch {
    // Storage can be disabled or full; the in-memory search remains usable.
  }
}

export function clearSearchState() {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Logout must remain usable if browser storage is unavailable.
  }
}
