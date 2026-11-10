/**
 * Serializable search settings shared by all devices of one Supabase user.
 * No free-form UI state, HTML or account identifiers are stored in a preset.
 */
export const MAX_SAVED_SEARCHES = 20;

const FILTER_KEYS = [
  'q', 'playlist', 'sort', 'order', 'voice', 'variant',
  'genre', 'mood', 'year', 'creator', 'status',
];

const ALLOWED_SORTS = new Set([
  'views', 'published_at', 'duration', 'comments',
  'mylists', 'title', 'registration',
]);
const ALLOWED_STATUSES = new Set([
  '', 'unlisted', 'no-voice', 'unrated', 'missing-metadata',
]);

export function normalizeSavedFilters(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = {};

  for (const key of FILTER_KEYS) {
    const maxLength = key === 'q' || key === 'creator' ? 250 : 150;
    result[key] = String(value[key] ?? '').slice(0, maxLength);
  }

  if (!ALLOWED_SORTS.has(result.sort)) result.sort = 'views';
  if (result.order !== 'asc') result.order = 'desc';
  if (!ALLOWED_STATUSES.has(result.status)) result.status = '';
  return result;
}

export function normalizeSavedView(view) {
  const raw = String(view ?? 'library');
  if (['library', 'duplicates', 'favorites'].includes(raw)) return raw;
  if (/^playlist:[\w-]{1,80}$/.test(raw)) return raw;
  return 'library';
}

export function createSearchPreset({ name, view, filters, cardMode }) {
  const cleanName = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!cleanName || cleanName.length > 80) {
    throw new Error('検索条件の名前は1〜80文字で入力してください');
  }
  return {
    name: cleanName,
    view: normalizeSavedView(view),
    filters: normalizeSavedFilters(filters),
    card_mode: cardMode === 'grid' ? 'grid' : 'list',
  };
}

export function applySearchPreset(state, preset) {
  if (!preset || typeof preset !== 'object') throw new Error('検索条件を読み込めません');
  state.view = normalizeSavedView(preset.view);
  state.filters = normalizeSavedFilters(preset.filters);
  state.cardMode = preset.card_mode === 'grid' ? 'grid' : 'list';
  state.page = 1;
  state.activeSavedSearchId = preset.id || '';
}
