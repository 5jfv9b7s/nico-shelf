import { createSearchPreset, MAX_SAVED_SEARCHES } from './app/saved-searches.js';

/** Helpers kept independent of browser/Supabase so they can be unit tested. */
export const VIDEO_ID = /^(?:sm|nm|so)\d{1,12}$/i;
export function videoId(value) {
  const s = String(value ?? '').trim();
  const match =
    s.match(/(?:^|\/watch\/|\?|&)(sm|nm|so)\d{1,12}(?=$|[/?#&\s])/i) ||
    s.match(/^(sm|nm|so)\d{1,12}$/i);
  return match ? match[0].replace(/^\/watch\/|^[?&]/, '').toLowerCase() : null;
}
export function esc(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
export function array(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const v = JSON.parse(value);
      if (Array.isArray(v)) return v;
    } catch {
      /* ignore */
    }
    return value.trim()
      ? value
          .split(/[,、;|]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  }
  return [];
}
export function formatCount(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('ja-JP').format(Number(n) || 0);
}
export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return '—';
  const v = Math.max(0, Math.round(Number(sec)));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
export function formatDate(x) {
  if (!x) return '—';
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ja-JP');
}
export function groupsFor(videoId, entries, playlistById) {
  return entries
    .filter((x) => x.video_id === videoId && x.present !== false)
    .map((x) => playlistById.get(x.playlist_id)?.name || x.playlist_id);
}
export function membershipMap(entries, playlists) {
  const p = new Map(playlists.map((x) => [x.id, x.name]));
  const m = new Map();
  for (const e of entries) {
    if (e.present === false) continue;
    if (!m.has(e.video_id)) m.set(e.video_id, []);
    m.get(e.video_id).push({
      id: e.playlist_id,
      name: p.get(e.playlist_id) || e.playlist_id,
      position: e.position,
      added_at: e.added_at,
    });
  }
  return m;
}
export function sortRows(rows, key = 'views', order = 'desc', playlistId = '') {
  const sign = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let av, bv;
    if (key === 'registration') {
      const ai = a.memberships.find((x) => x.id === playlistId),
        bi = b.memberships.find((x) => x.id === playlistId);
      av = ai?.position;
      bv = bi?.position;
      // Existing import records position 1 as the first item in the acquired playlist view (typically newest first).
      // This is display-list order, not a guaranteed historical registration time.
    } else if (key === 'title' || key === 'uploader' || key === 'id') {
      av = String(a[key] || '');
      bv = String(b[key] || '');
      return av.localeCompare(bv, 'ja') * sign || a.id.localeCompare(b.id);
    } else if (key === 'published_at') {
      av = a[key] ? Date.parse(a[key]) : null;
      bv = b[key] ? Date.parse(b[key]) : null;
    } else {
      av = a[key] == null ? null : Number(a[key]);
      bv = b[key] == null ? null : Number(b[key]);
    }
    if (av == null || Number.isNaN(av))
      return bv == null || Number.isNaN(bv) ? a.id.localeCompare(b.id) : 1;
    if (bv == null || Number.isNaN(bv)) return -1;
    if (av === bv) return a.id.localeCompare(b.id);
    return (av > bv ? 1 : -1) * sign;
  });
}
export function filteredRows(
  rows,
  {
    q = '',
    playlist = '',
    duplicates = false,
    favorites = false,
    sort = 'views',
    order = 'desc',
  } = {},
) {
  const needle = q.trim().toLocaleLowerCase();
  return rows
    .filter((v) => {
      if (playlist && !v.memberships.some((m) => m.id === playlist)) return false;
      if (duplicates && v.memberships.length < 2) return false;
      if (favorites && !v.userMeta?.favorite) return false;
      if (!needle) return true;
      return [
        v.id,
        v.title,
        v.uploader,
        v.description,
        ...array(v.voices),
        ...array(v.producers),
        ...array(v.tags),
        v.userMeta?.memo,
        v.userMeta?.personal_tags,
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle);
    })
    .sort((a, b) => (sortRows([a, b], sort, order, playlist)[0] === a ? -1 : 1));
}
export function singerStats(rows, limit = 12) {
  const cnt = new Map();
  for (const v of rows)
    for (const x of new Set(array(v.voices).map(String).filter(Boolean)))
      cnt.set(x, (cnt.get(x) || 0) + 1);
  return [...cnt].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
export function autoPlaylist(
  playlists,
  entries,
  { exclude = /最近のお気に入り/i, capacity = 500 } = {},
) {
  const counts = new Map();
  for (const e of entries)
    if (e.present !== false) counts.set(e.playlist_id, (counts.get(e.playlist_id) || 0) + 1);
  // A numeric suffix is useful for "ぼかうた1 -> ぼかうた2 -> ぼかうた3". All other lists sort by name.
  const candidates = playlists
    .filter((p) => !exclude.test(p.name))
    .sort((a, b) => {
      const ai = Number(a.name.match(/(\d+)$/)?.[1] ?? NaN),
        bi = Number(b.name.match(/(\d+)$/)?.[1] ?? NaN);
      return Number.isFinite(ai) && Number.isFinite(bi)
        ? ai - bi
        : a.name.localeCompare(b.name, 'ja');
    });
  return candidates.find((p) => (counts.get(p.id) || 0) < capacity) || null;
}
export function csvParse(text) {
  const s = String(text).replace(/^\uFEFF/, '');
  let row = [],
    rows = [],
    field = '',
    quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      if (field === '') quoted = true;
      else field += c;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      field = '';
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error('CSVのダブルクォートが閉じていません');
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  if (!rows.length) return [];
  const heads = rows.shift().map((x) => x.trim());
  return rows.map((r) => Object.fromEntries(heads.map((h, i) => [h, r[i] ?? ''])));
}
export const arrays = [
  'voices',
  'producers',
  'composers',
  'arrangers',
  'lyricists',
  'tags',
  'vocadb_tags',
];
export function normalizeImport(obj) {
  if (
    !obj ||
    !Array.isArray(obj.playlists) ||
    !Array.isArray(obj.videos) ||
    !Array.isArray(obj.entries)
  )
    throw new Error(
      'NICO SHELF形式のJSONではありません（playlists / videos / entries が必要です）',
    );
  const playlists = obj.playlists.map((x) => ({
    id: String(x.id || ''),
    name: String(x.name || x.id || ''),
    last_sync: x.last_sync || null,
    sync_status: x.sync_status || null,
  }));
  const videos = obj.videos.map((x) => ({
    id: videoId(x.id),
    title: String(x.title || x.id || ''),
    description: String(x.description || ''),
    uploader: String(x.uploader || ''),
    uploader_id: String(x.uploader_id || ''),
    published_at: x.published_at || null,
    duration: x.duration == null ? null : Number(x.duration),
    views: x.views == null ? null : Number(x.views),
    comments: x.comments == null ? null : Number(x.comments),
    mylists: x.mylists == null ? null : Number(x.mylists),
    likes: x.likes == null ? null : Number(x.likes),
    thumb: String(x.thumb || ''),
    genre: x.genre || null,
    kind: x.kind || null,
    ...Object.fromEntries(arrays.map((f) => [f, array(x[f])])),
    vocadb_id: x.vocadb_id || null,
    status: x.status || null,
    metadata_updated_at: x.metadata_updated_at || null,
  }));
  const entries = obj.entries.map((x) => ({
    playlist_id: String(x.playlist_id || ''),
    video_id: videoId(x.video_id),
    position: Number(x.position) || 0,
    added_at: x.added_at || null,
    present: x.present !== false && x.present !== 0 && x.present !== '0',
  }));
  const meta = (Array.isArray(obj.user_meta) ? obj.user_meta : []).map((x) => ({
    video_id: videoId(x.video_id),
    rating: Math.min(5, Math.max(0, Number(x.rating) || 0)),
    favorite: Boolean(x.favorite) && x.favorite !== '0',
    memo: String(x.memo || ''),
    personal_tags: String(x.personal_tags || ''),
    verified_voice: String(x.verified_voice || ''),
    verified_composer: String(x.verified_composer || ''),
    updated_at: x.updated_at || null,
  }));
  const rawSavedSearches = Array.isArray(obj.saved_searches) ? obj.saved_searches : [];
  if (rawSavedSearches.length > MAX_SAVED_SEARCHES)
    throw new Error('保存検索の件数が上限を超えています');
  const savedSearches = rawSavedSearches.map((item) =>
    createSearchPreset({
      name: item.name,
      view: item.view,
      filters: item.filters,
      cardMode: item.card_mode,
    }),
  );
  if (new Set(savedSearches.map((item) => item.name)).size !== savedSearches.length) {
    throw new Error('インポート内に同名の保存検索があります');
  }
  validateImport({ playlists, videos, entries, meta });
  return { playlists, videos, entries, meta, savedSearches };
}
export function csvToImport(csv) {
  const rows = csvParse(csv);
  if (!rows.length) throw new Error('CSVにデータがありません');
  const pick = (r, ...keys) => {
    for (const key of keys)
      if (r[key] != null && String(r[key]).trim()) return String(r[key]).trim();
    return '';
  };
  const playlists = new Map(),
    videos = new Map(),
    entries = new Map();
  for (const [i, r] of rows.entries()) {
    const pid = pick(r, 'playlist_id', 'マイリストID', 'list_id') || 'imported';
    const pname = pick(r, 'playlist_name', 'マイリスト名', 'リスト名') || pid;
    const vid = videoId(pick(r, 'video_id', '動画ID', 'id', '動画URL'));
    if (!vid) throw new Error(`CSV ${i + 2}行目: 動画IDが正しくありません`);
    playlists.set(pid, { id: pid, name: pname, last_sync: null, sync_status: 'CSVからインポート' });
    if (!videos.has(vid))
      videos.set(vid, {
        id: vid,
        title: pick(r, 'title', 'タイトル', '動画タイトル') || vid,
        uploader: pick(r, 'uploader', '投稿者', '投稿者名'),
        voices: array(pick(r, 'voices', '歌唱者')),
        views: pick(r, 'views', '再生数') ? Number(pick(r, 'views', '再生数')) : null,
        tags: array(pick(r, 'tags', 'タグ')),
      });
    const key = `${pid}\u001f${vid}`;
    entries.set(key, {
      playlist_id: pid,
      video_id: vid,
      position: Number(pick(r, 'position', '順番', 'リスト内順番')) || i + 1,
      added_at: null,
      present: true,
    });
  }
  return normalizeImport({
    playlists: [...playlists.values()],
    videos: [...videos.values()],
    entries: [...entries.values()],
  });
}
function validateImport({ playlists, videos, entries, meta }) {
  if (playlists.length > 1000 || videos.length > 200000 || entries.length > 500000)
    throw new Error('インポート件数の上限を超えています');
  const unique = (xs, fn) => new Set(xs.map(fn)).size === xs.length;
  if (
    !unique(playlists, (x) => x.id) ||
    !unique(videos, (x) => x.id) ||
    !unique(entries, (x) => `${x.playlist_id}:${x.video_id}`)
  )
    throw new Error('インポートデータに重複したIDがあります');
  const ps = new Set(playlists.map((x) => x.id)),
    vs = new Set(videos.map((x) => x.id));
  if (
    playlists.some((x) => !x.id || !x.name) ||
    videos.some((x) => !x.id) ||
    entries.some((x) => !ps.has(x.playlist_id) || !vs.has(x.video_id)) ||
    meta.some((x) => !vs.has(x.video_id))
  )
    throw new Error('インポートデータに不正な動画IDまたは参照が存在します');
}
