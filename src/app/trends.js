/**
 * Trends are calculated entirely from the signed-in user's local library rows.
 *
 * There are three distinct axes:
 * - playlist: compare named lists (not dates)
 * - position: compare quarters of the current order in one list
 * - published: compare the original video's publication year
 *
 * IMPORTANT: imported position is a snapshot of list display order, not proof
 * of the date on which the user discovered or saved a song.
 */
import { canonicalVoices, composerNames, genreLabels, moodLabels } from '../discovery.js';

export const TREND_AXES = Object.freeze({
  playlist: 'マイリスト別',
  position: 'リスト内の表示順',
  published: '動画の投稿年別',
});

export const TREND_FACETS = Object.freeze({
  voice: '歌唱キャラクター',
  genre: 'ジャンル（タグ・概要欄推定）',
  mood: '雰囲気（タグ・概要欄推定）',
  creator: '作り手・投稿者',
});

/** Put numbered playlists in numbered order, never treating favorites as a time period. */
export function orderTrendPlaylists(playlists, { includeOther = false } = {}) {
  const all = Array.isArray(playlists) ? playlists : [];
  const numbered = all.filter((playlist) => /\d+$/.test(String(playlist.name || '')));
  const chosen = numbered.length && !includeOther ? numbered : all;
  return [...chosen].sort((a, b) => {
    const aNumber = Number(String(a.name || '').match(/(\d+)$/)?.[1]);
    const bNumber = Number(String(b.name || '').match(/(\d+)$/)?.[1]);
    const aHasNumber = /\d+$/.test(String(a.name || ''));
    const bHasNumber = /\d+$/.test(String(b.name || ''));
    if (aHasNumber && bHasNumber && aNumber !== bNumber) return aNumber - bNumber;
    if (aHasNumber !== bHasNumber) return aHasNumber ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), 'ja');
  });
}

/** Every category is counted at most once per video, even if several tags match. */
export function labelsForFacet(video, facet) {
  switch (facet) {
    case 'voice':
      return canonicalVoices(video);
    case 'genre':
      return genreLabels(video);
    case 'mood':
      return moodLabels(video);
    case 'creator':
      return composerNames(video);
    default:
      return [];
  }
}

function makeGroup(key, label, videos) {
  return { key, label, videos, total: videos.length };
}

function liveEntries(library) {
  return (library.entries || []).filter((entry) => entry.present !== false);
}

function playlistVideos(rowsById, entries, playlistId) {
  const seen = new Set();
  return entries
    .filter((entry) => entry.playlist_id === playlistId)
    .map((entry) => entry.video_id)
    .filter((id) => !seen.has(id) && seen.add(id))
    .map((id) => rowsById.get(id))
    .filter(Boolean);
}

/** Build disjoint membership slices or overlapping named-playlist groups. */
export function createTrendGroups(
  library,
  rows,
  { axis = 'playlist', playlistId = '', includeOther = false } = {},
) {
  const rowById = new Map(rows.map((video) => [video.id, video]));
  const entries = liveEntries(library);
  const playlists = orderTrendPlaylists(library.playlists, { includeOther });

  if (axis === 'playlist') {
    return playlists.map((playlist) =>
      makeGroup(
        `playlist:${playlist.id}`,
        playlist.name,
        playlistVideos(rowById, entries, playlist.id),
      ),
    );
  }

  if (axis === 'position') {
    const selected = playlists.find((playlist) => playlist.id === playlistId) ?? playlists[0];
    if (!selected) return [];
    const seen = new Set();
    const ordered = entries
      .filter((entry) => entry.playlist_id === selected.id)
      .map((entry, originalIndex) => ({ entry, originalIndex }))
      .filter(({ entry }) => !seen.has(entry.video_id) && seen.add(entry.video_id))
      .sort((a, b) => {
        const aPosition = Number(a.entry.position);
        const bPosition = Number(b.entry.position);
        const aValid = Number.isFinite(aPosition) && aPosition > 0;
        const bValid = Number.isFinite(bPosition) && bPosition > 0;
        if (aValid && bValid && aPosition !== bPosition) return aPosition - bPosition;
        if (aValid !== bValid) return aValid ? -1 : 1;
        return a.originalIndex - b.originalIndex;
      });
    if (!ordered.length) return [];

    const groupCount = Math.min(4, ordered.length);
    return Array.from({ length: groupCount }, (_, index) => {
      const start = Math.floor((index * ordered.length) / groupCount);
      const end = Math.floor(((index + 1) * ordered.length) / groupCount);
      const selectedEntries = ordered.slice(start, end);
      return makeGroup(
        `quarter:${index}`,
        `${start + 1}〜${end}番目`,
        selectedEntries.map(({ entry }) => rowById.get(entry.video_id)).filter(Boolean),
      );
    });
  }

  if (axis === 'published') {
    const byYear = new Map();
    for (const video of rows) {
      const match = String(video.published_at || '').match(/^(\d{4})(?=\D|$)/);
      if (!match) continue;
      const year = Number(match[1]);
      if (year < 2000 || year > 2100) continue;
      const key = String(year);
      if (!byYear.has(key)) byYear.set(key, []);
      byYear.get(key).push(video);
    }
    return [...byYear]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, videos]) => makeGroup(`year:${year}`, `${year}年`, videos));
  }

  return [];
}

/**
 * Rates always use ALL videos in a group as denominator; lack of genre/mood
 * tags is not silently recast as a negative opinion or another genre.
 */
export function calculateTrend(library, rows, options = {}) {
  const facet = TREND_FACETS[options.facet] ? options.facet : 'voice';
  const groups = createTrendGroups(library, rows, options);
  const totals = new Map();
  const groupResults = groups.map((group) => {
    const counts = new Map();
    let classified = 0;
    for (const video of group.videos) {
      const labels = [...new Set(labelsForFacet(video, facet).filter(Boolean))];
      if (labels.length) classified++;
      for (const name of labels) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        totals.set(name, (totals.get(name) ?? 0) + 1);
      }
    }
    return { ...group, counts, classified };
  });
  const limit =
    options.limit === 'all'
      ? Infinity
      : Number.isInteger(Number(options.limit)) && Number(options.limit) > 0
        ? Math.min(Number(options.limit), 100)
        : 10;
  const categories = [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .slice(0, limit)
    .map(([name]) => name);
  const cells = groupResults.map((group) => ({
    key: group.key,
    label: group.label,
    total: group.total,
    classified: group.classified,
    values: Object.fromEntries(
      categories.map((category) => {
        const count = group.counts.get(category) ?? 0;
        return [category, { count, percent: group.total ? (100 * count) / group.total : 0 }];
      }),
    ),
  }));
  return { facet, categories, groups: groupResults, cells };
}

/** Return actual videos for a selected heatmap cell, without touching DB state. */
export function videosForTrendCell(result, groupKey, category) {
  const group = result.groups.find((item) => item.key === groupKey);
  if (!group || !result.categories.includes(category)) return [];
  return group.videos.filter((video) => labelsForFacet(video, result.facet).includes(category));
}

export function compareTrendEndpoints(result) {
  if (result.cells.length < 2) return [];
  const first = result.cells[0];
  const last = result.cells.at(-1);
  return result.categories
    .map((category) => ({
      category,
      first: first.values[category].percent,
      last: last.values[category].percent,
      delta: last.values[category].percent - first.values[category].percent,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
