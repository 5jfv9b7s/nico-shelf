import { canonicalVoices, composerNames, genreLabels, moodLabels } from '../../discovery.js';
import { array } from '../../lib.js';

export const RULE_FIELDS = Object.freeze({
  voice: '歌唱者',
  genre: 'ジャンル',
  mood: '雰囲気',
  creator: '作り手・投稿者',
  tag: 'タグ',
  views: '再生数',
  published: '投稿時期',
  duration: '動画時間',
  playlist: '所属マイリスト',
});
export const DEFAULT_RULE_FIELDS = [
  'voice',
  'genre',
  'mood',
  'views',
  'published',
  'duration',
  'playlist',
];
export const RULE_ITEM_LIMIT = 80;
const clean = (x) => (typeof x === 'string' ? x.normalize('NFKC').trim() : '');
const numeric = (x) =>
  x === null || x === undefined || (typeof x === 'string' && !x.trim()) || typeof x === 'boolean'
    ? null
    : Number.isFinite(Number(x)) && Number(x) >= 0
      ? Number(x)
      : null;

export function parseRuleBins(value, fallback, { min = 0, max = 1e12, integer = false } = {}) {
  const parts = String(value ?? fallback)
      .split(',')
      .map((x) => x.trim()),
    values = parts.map(Number);
  if (
    parts.length > 12 ||
    parts.some((x) => !x) ||
    values.some(
      (x, i) =>
        !Number.isFinite(x) ||
        x <= min ||
        x >= max ||
        (integer && !Number.isInteger(x)) ||
        (i && x <= values[i - 1]),
    )
  )
    throw new Error('区切りは小さい順の数値をカンマで指定してください（最大12個・重複不可）');
  return values;
}
const amount = (n) =>
  n >= 10000 && n % 10000 === 0 ? n / 10000 + '万' : n.toLocaleString('ja-JP');
const seconds = (n) => (n % 60 === 0 ? n / 60 + '分' : n + '秒');
function band(value, limits, format) {
  const i = limits.findIndex((x) => value < x);
  return i === 0
    ? format(null, limits[0])
    : i < 0
      ? format(limits.at(-1), null)
      : format(limits[i - 1], limits[i]);
}

/** Same categorical transactions for mining, CSV and ARFF; missing is never a zero-valued category. */
export function buildRuleDataset(rows, options = {}) {
  const mode = options.ruleMode ?? 'simple';
  if (!['simple', 'apriori'].includes(mode))
    throw new Error('相関ルールの分析方式を選択してください');
  const requested = options.ruleFields ?? DEFAULT_RULE_FIELDS;
  if (mode === 'apriori' && !Array.isArray(requested))
    throw new Error('ルールに使う属性を選択してください');
  const fields =
    mode === 'simple'
      ? ['voice', 'genre', 'mood', ...(options.ruleExtras ? ['creator', 'tag'] : [])]
      : [...new Set(requested)];
  if (!fields.length || fields.some((key) => !Object.hasOwn(RULE_FIELDS, key)))
    throw new Error('ルールに使う属性を1つ以上選択してください');
  const viewBins = parseRuleBins(
    fields.includes('views') ? options.ruleViewBins : undefined,
    '10000,100000,1000000',
  );
  const yearBins = parseRuleBins(
    fields.includes('published') ? options.ruleYearBins : undefined,
    '2010,2020,2023,2027',
    { min: 2000, max: 2101, integer: true },
  );
  const durationBins = parseRuleBins(
    fields.includes('duration') ? options.ruleDurationBins : undefined,
    '120,180,240,300',
  );
  const names = new Map(),
    nameIds = new Map();
  for (const row of rows)
    for (const p of row.memberships ?? []) {
      if (p.present === false || p.id == null || !String(p.id)) continue;
      const id = String(p.id),
        name = clean(p.name) || id;
      names.set(id, name);
      if (!nameIds.has(name)) nameIds.set(name, new Set());
      nameIds.get(name).add(id);
    }
  const catalog = new Map();
  const transactions = rows.map((row) => {
    const keys = new Set();
    const add = (field, label, identity = label) => {
      label = clean(label);
      if (!label) return;
      const key = JSON.stringify([field, identity]);
      keys.add(key);
      if (!catalog.has(key))
        catalog.set(key, {
          key,
          field,
          label: RULE_FIELDS[field] + '：' + label,
          count: 0,
        });
    };
    for (const field of fields) {
      const values =
        field === 'voice'
          ? canonicalVoices(row)
          : field === 'genre'
            ? genreLabels(row)
            : field === 'mood'
              ? moodLabels(row)
              : field === 'creator'
                ? composerNames(row)
                : field === 'tag'
                  ? array(row.tags).filter((x) => typeof x === 'string' && x.length <= 80)
                  : null;
      if (values) {
        for (const value of values) {
          const normalized = clean(value);
          if (normalized) add(field, normalized);
        }
        continue;
      }
      if (field === 'playlist')
        for (const p of row.memberships ?? []) {
          if (p.present === false || p.id == null || !String(p.id)) continue;
          const id = String(p.id),
            name = names.get(id) || id;
          add(field, nameIds.get(name)?.size > 1 ? `${name}（${id}）` : name, id);
        }
      if (field === 'views') {
        const v = numeric(row.views);
        if (v !== null)
          add(
            field,
            band(v, viewBins, (lo, hi) =>
              lo === null
                ? amount(hi) + '再生未満'
                : hi === null
                  ? amount(lo) + '再生以上'
                  : amount(lo) + '以上' + amount(hi) + '再生未満',
            ),
          );
      }
      if (field === 'duration') {
        const v = numeric(row.duration);
        if (v !== null)
          add(
            field,
            band(v, durationBins, (lo, hi) =>
              lo === null
                ? seconds(hi) + '未満'
                : hi === null
                  ? seconds(lo) + '以上'
                  : seconds(lo) + '以上' + seconds(hi) + '未満',
            ),
          );
      }
      if (field === 'published' && row.published_at) {
        const parsed = Date.parse(row.published_at),
          year = new Date(parsed).getUTCFullYear();
        if (Number.isFinite(parsed) && year >= 2000 && year <= 2100)
          add(
            field,
            band(year, yearBins, (lo, hi) => `${lo ?? 2000}〜${(hi ?? 2101) - 1}年`),
          );
      }
    }
    for (const key of keys) catalog.get(key).count++;
    return { id: row.id, title: row.title || row.id, keys: [...keys] };
  });
  const support = Number(options.support ?? 0.02),
    minimum = mode === 'simple' ? 3 : Number(options.ruleMinCount ?? 3);
  if (!Number.isFinite(support) || support <= 0 || support > 1)
    throw new Error('支持度は0より大きく100%以下にしてください');
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > 1000000)
    throw new Error('最小共起曲数は1〜100万の整数にしてください');
  const minCount = Math.max(minimum, Math.ceil(support * rows.length - 1e-12));
  const frequent = [...catalog.values()]
    .filter((item) => item.count >= minCount)
    .sort(
      (a, b) =>
        b.count - a.count || a.label.localeCompare(b.label, 'ja') || a.key.localeCompare(b.key),
    );
  const items = frequent.slice(0, RULE_ITEM_LIMIT),
    indices = new Map(items.map((item, i) => [item.key, i]));
  return {
    mode,
    fields,
    minCount,
    classified: transactions.filter((t) => t.keys.length).length,
    omittedItems: Math.max(0, frequent.length - items.length),
    items,
    transactions: transactions.map((t) => ({
      id: t.id,
      title: t.title,
      items: t.keys
        .filter((key) => indices.has(key))
        .map((key) => indices.get(key))
        .sort((a, b) => a - b),
    })),
    bins: { views: viewBins, published: yearBins, duration: durationBins },
  };
}
