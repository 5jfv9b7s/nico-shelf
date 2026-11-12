/**
 * Pure scatter-plot calculations. A dot represents ONE unique video.
 * Missing metadata is omitted rather than silently treated as zero.
 * All logarithmic axes use log10(value + 1), so a genuine 0 is plottable.
 */
import { canonicalVoices } from '../discovery.js';
import { scatterExclusionReason } from './scatter-availability.js';

/**
 * Numeric scatter metrics. `mylists` is the video's *NicoNico-wide* mylist
 * counter; `membershipCount` is the number of this user's active lists.
 * These are different sources and must never be conflated.
 */
export const SCATTER_METRICS = Object.freeze({
  views: { label: '再生数', unit: '回', logarithmic: true, group: '動画の基本情報' },
  comments: { label: 'コメント数', unit: '件', logarithmic: true, group: '動画の基本情報' },
  mylists: { label: 'ニコニコのマイリスト数', unit: '件', logarithmic: true, group: '動画の基本情報' },
  likes: { label: 'いいね数', unit: '件', logarithmic: true, group: '動画の基本情報' },
  duration: { label: '動画時間', unit: '分', logarithmic: false, group: '動画の基本情報' },
  published: { label: '投稿時期', unit: '年', logarithmic: false, group: '動画の基本情報' },
  mylistRate: { label: 'マイリスト率（1,000再生あたり）', unit: '件', logarithmic: false, group: '再生数に対する反応' },
  commentRate: { label: 'コメント率（1,000再生あたり）', unit: '件', logarithmic: false, group: '再生数に対する反応' },
  likeRate: { label: 'いいね率（1,000再生あたり）', unit: '件', logarithmic: false, group: '再生数に対する反応' },
  membershipCount: { label: '自分の所属マイリスト数', unit: '件', logarithmic: false, integer: true, group: '自分のライブラリ' },
  rating: { label: '自分の評価（1〜5）', unit: '', logarithmic: false, integer: true, group: '自分のライブラリ' },
});

/** Missing data is `null`, NEVER zero. Rates need a positive play count. */
function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function perThousandViews(video, countField) {
  const views = nonNegativeNumber(video?.views);
  const count = nonNegativeNumber(video?.[countField]);
  if (views === null || count === null || views === 0) return null;
  return (count / views) * 1000;
}

/** @returns {number | null} The value for one plot axis. */
export function metricValue(video, metric) {
  if (!SCATTER_METRICS[metric]) return null;

  if (metric === 'published') {
    if (!video?.published_at) return null;
    const date = Date.parse(video.published_at);
    if (!Number.isFinite(date)) return null;
    const year = new Date(date).getUTCFullYear();
    return year >= 2000 && year <= 2100
      ? year + (date - Date.UTC(year, 0, 1)) / (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1))
      : null;
  }

  if (metric === 'mylistRate') return perThousandViews(video, 'mylists');
  if (metric === 'commentRate') return perThousandViews(video, 'comments');
  if (metric === 'likeRate') return perThousandViews(video, 'likes');

  if (metric === 'membershipCount') {
    if (!Array.isArray(video?.memberships)) return null;
    return new Set(video.memberships.map((entry) => entry.id).filter(Boolean)).size;
  }

  if (metric === 'rating') {
    const rating = nonNegativeNumber(video?.userMeta?.rating);
    return rating !== null && rating >= 1 && rating <= 5 ? rating : null;
  }

  const value = nonNegativeNumber(video?.[metric]);
  return metric === 'duration' && value !== null ? value / 60 : value;
}

export function transformMetric(value, metric) {
  return SCATTER_METRICS[metric]?.logarithmic ? Math.log10(value + 1) : value;
}

/** Midranks support rank correlation even when many videos have tied counts. */
function rank(values) {
  const pairs = values.map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = Array(values.length);
  for (let i = 0; i < pairs.length;) {
    let j = i + 1;
    while (j < pairs.length && pairs[j].value === pairs[i].value) j++;
    const midrank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[pairs[k].index] = midrank;
    i = j;
  }
  return ranks;
}

function pearson(x, y) {
  if (x.length < 3) return null;
  const mx = x.reduce((sum, value) => sum + value, 0) / x.length;
  const my = y.reduce((sum, value) => sum + value, 0) / y.length;
  let xx = 0; let yy = 0; let xy = 0;
  x.forEach((value, index) => {
    const dx = value - mx; const dy = y[index] - my;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  });
  return xx && yy ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null;
}

export function createScatterData(videos, { x = 'views', y = 'comments', voice = '' } = {}) {
  if (!SCATTER_METRICS[x] || !SCATTER_METRICS[y]) throw new Error('Unknown scatter metric');
  const unique = new Set();
  const points = [];
  let eligible = 0;
  const excluded = { deleted: 0, private: 0, unconfirmed: 0 };
  for (const video of videos) {
    if (!video?.id || unique.has(video.id)) continue;
    unique.add(video.id);
    const voices = canonicalVoices(video);
    if (voice && !voices.includes(voice)) continue;
    // Exclude unavailable videos before metric calculation, visualisation,
    // singer legend and Spearman correlation. The database remains unchanged.
    const reason = scatterExclusionReason(video);
    if (reason) {
      excluded[reason]++;
      continue;
    }
    eligible++;
    const xValue = metricValue(video, x);
    const yValue = metricValue(video, y);
    if (xValue === null || yValue === null) continue;
    points.push({
      video, id: video.id, voices, colorVoice: voice || voices[0] || '',
      xValue, yValue,
      xPlot: transformMetric(xValue, x), yPlot: transformMetric(yValue, y),
    });
  }
  return {
    x, y, voice, points, eligible, total: unique.size, excluded,
    correlation: x === y ? null : pearson(rank(points.map((p) => p.xValue)), rank(points.map((p) => p.yValue))),
  };
}

/** Grid ticks are spaced in plot coordinates, not raw-view counts. */
export function scatterTicks(low, high, metric, tickCount = 5) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  if (low === high) return [low];
  // User ratings and memberships are discrete: avoid ticks like 1.25 lists.
  if (SCATTER_METRICS[metric]?.integer) {
    const first = Math.ceil(low);
    const last = Math.floor(high);
    const step = Math.max(1, Math.ceil((last - first) / (tickCount - 1)));
    return first <= last
      ? Array.from({ length: Math.floor((last - first) / step) + 1 }, (_, index) => first + index * step)
      : [];
  }
  return Array.from({ length: tickCount }, (_, index) => low + index * (high - low) / (tickCount - 1));
}

/** Format plotted values in their axis-specific unit. */
export function readableMetric(value, metric) {
  if (metric === 'published') return `${Math.floor(value)}年`;
  if (metric === 'duration') return `${Number(value.toFixed(1))}分`;
  if (['mylistRate', 'commentRate', 'likeRate'].includes(metric)) {
    return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 3 }).format(value);
  }
  if (metric === 'rating') return Number(value.toFixed(1)).toString();
  return new Intl.NumberFormat('ja-JP', {
    notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1,
  }).format(Math.round(value));
}
