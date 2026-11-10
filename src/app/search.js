import { filteredDiscovery } from '../discovery.js';
import { sortRows } from '../lib.js';
import { buildLibraryRows } from './library.js';

/** Resolve the same search for the UI, CSV export and random discovery. */
export function selectLibraryResults(state) {
  const isPlaylist = state.view.startsWith('playlist:');
  const playlist = isPlaylist ? state.view.slice('playlist:'.length) : state.filters.playlist;
  const selected = filteredDiscovery(buildLibraryRows(state.library), {
    ...state.filters,
    playlist,
    duplicates: state.view === 'duplicates',
    favorites: state.view === 'favorites',
  });
  return {
    rows: sortRows(selected, state.filters.sort, state.filters.order, playlist),
    playlist,
  };
}

export function chooseRandomVideo(rows, random = Math.random) {
  if (!rows.length) return null;
  const value = Number(random());
  const index = Number.isFinite(value)
    ? Math.max(0, Math.min(rows.length - 1, Math.floor(value * rows.length)))
    : 0;
  return rows[index];
}
