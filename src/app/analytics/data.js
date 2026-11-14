import { SCATTER_METRICS, metricValue } from '../scatter.js';
import { scatterExclusionReason } from '../scatter-availability.js';
import { canonicalVoices } from '../../discovery.js';

export const ANALYSIS_METHODS = {
  correlation: '1. 相関分析',
  regression: '2. 回帰分析',
  multiple: '3. 重回帰分析',
  pca: '5. 主成分分析',
  rules: '9. 相関ルール',
  clusters: '10. クラスタリング',
};
export const DEFAULT_FEATURES = ['views', 'comments', 'mylists', 'likes', 'duration', 'published'];
export const COUNT_METRICS = new Set(['views', 'comments', 'mylists', 'likes']);
export { SCATTER_METRICS as METRICS };

export function analysisDefaults() {
  return {
    method: 'correlation',
    playlist: '',
    voice: '',
    features: [...DEFAULT_FEATURES],
    x: 'views',
    y: 'mylists',
    logCounts: true,
    correlation: 'spearman',
    clusterMethod: 'kmeans',
    k: 4,
    support: 0.02,
    confidence: 0.5,
    ruleExtras: false,
    busy: false,
    result: null,
    error: '',
    selection: null,
  };
}

/** Unique videos, never playlist occurrences; missing availability is not deletion. */
export function eligibleRows(rows, options = {}) {
  const seen = new Set();
  const selected = [];
  const excluded = { duplicate: 0, scope: 0, deleted: 0, private: 0, unconfirmed: 0 };
  for (const video of rows) {
    if (!video?.id || seen.has(video.id)) {
      excluded.duplicate++;
      continue;
    }
    seen.add(video.id);
    if (
      (options.playlist && !video.memberships?.some((p) => String(p.id) === options.playlist)) ||
      (options.voice && !canonicalVoices(video).includes(options.voice))
    ) {
      excluded.scope++;
      continue;
    }
    const reason = scatterExclusionReason(video);
    if (reason) {
      excluded[reason]++;
      continue;
    }
    selected.push(video);
  }
  return { rows: selected, excluded, total: rows.length };
}

export function valueFor(video, key, logCounts = true) {
  const value = metricValue(video, key);
  return value === null ? null : logCounts && COUNT_METRICS.has(key) ? Math.log1p(value) : value;
}
export function metricLabel(key, logCounts = true) {
  return (
    (SCATTER_METRICS[key]?.label || key) +
    (logCounts && COUNT_METRICS.has(key) ? ' [ln(1+件数)]' : '')
  );
}
export function validateFeatures(keys, minimum = 1) {
  const unique = [...new Set(keys || [])];
  if (unique.length < minimum || unique.length > 11 || unique.some((key) => !SCATTER_METRICS[key]))
    throw new Error('分析項目を' + minimum + '〜11個選択してください');
  return unique;
}
export function completeData(rows, keys, logCounts = true) {
  validateFeatures(keys);
  const videos = [],
    values = [];
  for (const video of rows) {
    const vector = keys.map((key) => valueFor(video, key, logCounts));
    if (vector.every((value) => value !== null && Number.isFinite(value))) {
      videos.push({ id: video.id, title: video.title || video.id });
      values.push(vector);
    }
  }
  return { videos, values, n: values.length, missing: rows.length - values.length, keys };
}
