/**
 * Pure scatter-plot calculations. A dot represents ONE unique video.
 * Missing metadata is omitted rather than silently treated as zero.
 * All logarithmic axes use log10(value + 1), so a genuine 0 is plottable.
 */
import { canonicalVoices } from '../discovery.js';

export const SCATTER_METRICS = Object.freeze({
  views: { label: '再生数', unit: '回', logarithmic: true },
  comments: { label: 'コメント数', unit: '件', logarithmic: true },
  likes: { label: 'いいね数', unit: '件', logarithmic: true },
  duration: { label: '動画時間', unit: '分', logarithmic: false },
  published: { label: '投稿時期', unit: '年', logarithmic: false },
});

export function metricValue(video, metric) {
  if (metric === 'published') {
    const date = Date.parse(video.published_at);
    if (!Number.isFinite(date)) return null;
    const d = new Date(date);
    const year = d.getUTCFullYear();
    return year >= 2000 && year <= 2100
      ? year + (date - Date.UTC(year, 0, 1)) / (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1))
      : null;
  }
  const value = video?.[metric];
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return metric === 'duration' ? number / 60 : number;
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
  for (const video of videos) {
    if (!video?.id || unique.has(video.id)) continue;
    unique.add(video.id);
    const voices = canonicalVoices(video);
    if (voice && !voices.includes(voice)) continue;
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
    x, y, voice, points, eligible, total: unique.size,
    correlation: x === y ? null : pearson(rank(points.map((p) => p.xValue)), rank(points.map((p) => p.yValue))),
  };
}

/** Grid ticks are spaced in plot coordinates, not raw-view counts. */
export function scatterTicks(low, high, metric, tickCount = 5) {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [];
  if (low === high) return [low];
  return Array.from({ length: tickCount }, (_, index) => low + index * (high - low) / (tickCount - 1));
}

export function readableMetric(value, metric) {
  if (metric === 'published') return `${Math.floor(value)}年`;
  if (metric === 'duration') return `${Number(value.toFixed(1))}分`;
  return new Intl.NumberFormat('ja-JP', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Math.round(value));
}
