import { eligibleRows, ANALYSIS_METHODS, analysisDefaults } from './data.js';
import { correlationMatrix } from './correlation.js';
import { regressionAnalysis } from './regression.js';
import { pcaAnalysis } from './pca.js';
import { mineRules } from './rules.js';
import { clusterAnalysis } from './clusters.js';

/** Pure dispatcher, also used by reference-data tests; no network or DB access. */
export function runAnalysis(rows, options) {
  const defaults = analysisDefaults();
  options = Object.fromEntries(
    Object.keys(defaults)
      .filter((key) => !['result', 'busy', 'error', 'selection'].includes(key))
      .map((key) => [key, options[key] ?? defaults[key]]),
  );
  if (!Object.hasOwn(ANALYSIS_METHODS, options.method))
    throw new Error('分析方法を選択してください');
  const source = eligibleRows(rows, options);
  const functions = {
    correlation: correlationMatrix,
    regression: (r, o) => regressionAnalysis(r, o, false),
    multiple: (r, o) => regressionAnalysis(r, o, true),
    pca: pcaAnalysis,
    rules: mineRules,
    clusters: clusterAnalysis,
  };
  const result = functions[options.method](source.rows, options);
  return {
    ...result,
    scope: { total: source.total, available: source.rows.length, excluded: source.excluded },
    options: { ...options, features: [...options.features] },
  };
}
