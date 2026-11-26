import { canonicalVoices, genreLabels, moodLabels } from '../../discovery.js';
import { array } from '../../lib.js';
import { metricValue, SCATTER_METRICS } from '../scatter.js';

export const TREE_CATEGORIES = Object.freeze({
  voice: '歌唱者',
  genre: 'ジャンル',
  mood: '雰囲気',
  tag: '保存済みタグ',
});
export function blockedTreeFeatures(target) {
  return target === 'playlist'
    ? ['membershipCount']
    : target === 'views'
      ? ['views', 'mylistRate', 'commentRate', 'likeRate']
      : [];
}
const validCount = (value) =>
  value !== null &&
  value !== undefined &&
  typeof value !== 'boolean' &&
  String(value).trim() !== '' &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0;

export function targetRecords(rows, options) {
  const kind = options.treeTarget,
    id = String(options.treePlaylist || '');
  if (!['playlist', 'favorite', 'views'].includes(kind))
    throw new Error('分類対象を選択してください');
  if (kind === 'playlist' && !id) throw new Error('分類対象のマイリストを選択してください');
  const threshold = Number(options.treeThreshold);
  if (kind === 'views' && (!validCount(options.treeThreshold) || threshold > 1e12))
    throw new Error('再生数の境界は0〜1兆の数値にしてください');
  let name = id;
  const records = [];
  for (const row of rows) {
    let target;
    if (kind === 'playlist') {
      const member = row.memberships?.find((p) => p.present !== false && String(p.id) === id);
      if (member) name = member.name || id;
      target = member ? 1 : 0;
    } else if (kind === 'favorite') target = row.userMeta?.favorite === true ? 1 : 0;
    else if (validCount(row.views)) target = Number(row.views) >= threshold ? 1 : 0;
    else continue;
    records.push({ row, target });
  }
  const label =
    kind === 'playlist'
      ? '「' + name + '」への所属'
      : kind === 'favorite'
        ? 'アプリ内のお気に入り登録'
        : threshold.toLocaleString('ja-JP') + '再生以上';
  return {
    records,
    label,
    kind,
    playlistId: kind === 'playlist' ? id : '',
    missingTarget: rows.length - records.length,
  };
}

function numeric(row, key) {
  const rates = { mylistRate: 'mylists', commentRate: 'comments', likeRate: 'likes' };
  if (rates[key] && (!validCount(row.views) || !validCount(row[rates[key]]))) return null;
  if (key === 'rating' && !validCount(row.userMeta?.rating)) return null;
  if (key === 'membershipCount')
    return Array.isArray(row.memberships)
      ? new Set(
          row.memberships
            .filter((p) => p.present !== false && p.id != null)
            .map((p) => String(p.id)),
        ).size
      : null;
  if (['views', 'comments', 'mylists', 'likes', 'duration'].includes(key) && !validCount(row[key]))
    return null;
  return metricValue(row, key);
}
function categoryItems(row, fields) {
  const items = new Map();
  for (const field of fields) {
    const values =
      field === 'voice'
        ? canonicalVoices(row)
        : field === 'genre'
          ? genreLabels(row)
          : field === 'mood'
            ? moodLabels(row)
            : array(row.tags);
    for (const raw of values) {
      if (typeof raw !== 'string' || raw.length > 100) continue;
      const value = raw.normalize('NFKC').trim();
      if (value)
        items.set(JSON.stringify([field, value]), {
          key: JSON.stringify([field, value]),
          field,
          value,
          label: TREE_CATEGORIES[field] + '：' + value,
          type: 'category',
        });
    }
  }
  return items;
}

/** Every fold fits its own numeric medians and categorical vocabulary on training rows only. */
export function fitTreeFeatures(records, options) {
  const blocked = blockedTreeFeatures(options.treeTarget);
  if (!Array.isArray(options.features) || !Array.isArray(options.treeCategories))
    throw new Error('説明変数を選択してください');
  if (
    options.features.some((key) => !Object.hasOwn(SCATTER_METRICS, key)) ||
    options.treeCategories.some((key) => !Object.hasOwn(TREE_CATEGORIES, key))
  )
    throw new Error('説明変数が不正です');
  const keys = [...new Set(options.features)].filter((key) => !blocked.includes(key));
  const fields = [...new Set(options.treeCategories)];
  if (!keys.length && !fields.length)
    throw new Error('分類対象から直接分かる項目を除いた説明変数を1つ以上選んでください');
  const features = [],
    dropped = [];
  for (const key of keys) {
    const values = records
      .map((r) => numeric(r.row, key))
      .filter((v) => v !== null && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!values.length || values[0] === values.at(-1)) {
      dropped.push(SCATTER_METRICS[key].label);
      continue;
    }
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 ? values[middle] : values[middle - 1] / 2 + values[middle] / 2;
    features.push({
      key,
      label: SCATTER_METRICS[key].label,
      unit: SCATTER_METRICS[key].unit,
      type: 'numeric',
      median,
    });
  }
  const catalog = new Map();
  for (const { row } of records)
    for (const [key, item] of categoryItems(row, fields)) {
      if (!catalog.has(key)) catalog.set(key, { ...item, count: 0 });
      catalog.get(key).count++;
    }
  const candidates = [...catalog.values()]
    .filter((item) => item.count >= 3 && item.count < records.length)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  features.push(...candidates.slice(0, 40));
  return {
    features,
    fields,
    dropped,
    omitted: Math.max(0, candidates.length - 40),
    blocked: options.features.filter((key) => blocked.includes(key)),
  };
}

export function transformTreeFeatures(records, fitted) {
  let imputed = 0;
  const values = records.map(({ row }) => {
    const categories = categoryItems(row, fitted.fields);
    return fitted.features.map((feature) => {
      if (feature.type === 'category') return categories.has(feature.key) ? 1 : 0;
      const value = numeric(row, feature.key);
      if (value !== null && Number.isFinite(value)) return value;
      imputed++;
      return feature.median;
    });
  });
  return { values, imputed };
}
