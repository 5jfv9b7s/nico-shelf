import { SCATTER_METRICS, metricValue } from '../scatter.js';
import { scatterExclusionReason } from '../scatter-availability.js';
import { canonicalVoices } from '../../discovery.js';
import { DEFAULT_RULE_FIELDS } from './rule-data.js';

export const ANALYSIS_METHODS = {
  correlation: '相関分析',
  regression: '回帰分析',
  multiple: '重回帰分析',
  pca: '主成分分析',
  rules: '相関ルール',
  clusters: 'クラスタリング',
  tree: '決定木',
};
export const DEFAULT_FEATURES = ['views', 'comments', 'mylists'];
export const COUNT_METRICS = new Set(['views', 'comments', 'mylists', 'likes']);
export { SCATTER_METRICS as METRICS };

export function analysisDefaults() {
  return {
    method: 'correlation',
    playlist: '', // Legacy analysis callers. UI uses playlists.
    playlists: [],
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
    ruleSort: 'count',
    ruleMode: 'simple',
    ruleFields: [...DEFAULT_RULE_FIELDS],
    ruleMaxSize: 3,
    ruleMinCount: 3,
    ruleMinLift: 1.01,
    ruleLimit: 50,
    ruleConsequentField: '',
    ruleConsequentItem: '',
    ruleViewBins: '10000,100000,1000000',
    ruleYearBins: '2010,2020,2023,2027',
    ruleDurationBins: '120,180,240,300',
    ruleBinsOpen: false,
    treeTarget: 'playlist',
    treePlaylist: '',
    treeThreshold: 10000,
    treeCategories: ['voice', 'genre', 'mood'],
    treeDepth: 3,
    treeMinLeaf: 5,
    treeAlpha: 0.005,
    treeCriterion: 'gini',
    treeFolds: 5,
    treeExpansion: {},
    busy: false,
    result: null,
    error: '',
    selection: null,
  };
}

/** Unique videos, never playlist occurrences; missing availability is not deletion. */
export function eligibleRows(rows, options = {}) {
  const selectedIds =
    Array.isArray(options.playlists) && options.playlists.length
      ? new Set(options.playlists.map(String))
      : new Set(options.playlist ? [String(options.playlist)] : []);
  const seen = new Set();
  const selected = [];
  const excluded = {
    duplicate: 0,
    scope: 0,
    deleted: 0,
    private: 0,
    unconfirmed: 0,
  };
  for (const video of rows) {
    if (!video?.id || seen.has(video.id)) {
      excluded.duplicate++;
      continue;
    }
    seen.add(video.id);
    if (
      (selectedIds.size &&
        !video.memberships?.some((p) => p.present !== false && selectedIds.has(String(p.id)))) ||
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
  return {
    videos,
    values,
    n: values.length,
    missing: rows.length - values.length,
    keys,
  };
}
