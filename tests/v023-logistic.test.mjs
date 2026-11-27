import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fitLogistic,
  sigmoid,
  fitLogisticScaling,
  scaleLogisticValues,
  logisticProbability,
} from '../src/app/analytics/logistic-regression.js';
import {
  probabilityMetrics,
  stratifiedFolds,
} from '../src/app/analytics/classification-evaluation.js';
import {
  fitTreeFeatures,
  transformTreeFeatures,
  targetRecords,
} from '../src/app/analytics/classification-data.js';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { analysisDefaults } from '../src/app/analytics/data.js';
import { analysisCsv } from '../src/app/analytics/export.js';

const reference = JSON.parse(
  readFileSync(new URL('./fixtures/logistic-reference.json', import.meta.url)),
);
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const options = (overrides) => ({
  ...analysisDefaults(),
  method: 'logistic',
  treeTarget: 'playlist',
  treePlaylist: 'target',
  features: ['comments', 'duration'],
  treeCategories: ['tag'],
  ...overrides,
});
export function songs(n = 90) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'sm' + (i + 1),
    title: i === 0 ? '=malicious,\n"title"' : '曲' + i,
    views: 200 + i * 331,
    comments: i % 6 === 0 ? null : 5 + ((i * 17) % 57),
    duration: 50 + i * 3,
    tags: i % 3 === 0 ? ['特徴A'] : ['特徴B'],
    voices: [],
    memberships:
      i % 4 === 0 || i % 7 === 0
        ? [{ id: 'target', name: '同じ名前', present: true }]
        : [{ id: 'other', name: '同じ名前', present: true }],
  }));
}

test('regularized coefficients, scaling and probabilities match scikit-learn on nine independent cases', () => {
  for (const ref of reference.cases) {
    const features = [
      { key: 'duration', type: 'numeric' },
      { key: 'category', type: 'category', label: 'Category' },
      { key: 'rating', type: 'numeric' },
    ];
    const scaling = fitLogisticScaling(ref.raw, features, false);
    scaling.forEach((p, i) => {
      near(p.mean, ref.mean[i], 1e-12);
      near(p.scale, ref.scale[i], 1e-12);
    });
    const values = scaleLogisticValues(ref.raw, features, scaling, false);
    const model = fitLogistic(values, ref.labels, { lambda: ref.lambda, maxIterations: 1000 });
    assert.equal(model.converged, true, ref.name);
    near(model.intercept, ref.intercept);
    model.weights.forEach((w, i) => near(w, ref.weights[i]));
    const probs = values.map((v) => logisticProbability(model, v));
    probs.forEach((p, i) => near(p, ref.probabilities[i], 1e-6));
    const metrics = probabilityMetrics(ref.labels, probs);
    near(metrics.auc, ref.auc);
    near(metrics.logLoss, ref.logLoss);
    near(metrics.brier, ref.brier);
  }
});

test('probability metrics handle score ties, exact extremes, empty and one-class inputs', () => {
  assert.equal(sigmoid(1000), 1);
  assert.equal(sigmoid(-1000), 0);
  const tied = probabilityMetrics([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]);
  near(tied.auc, 0.5);
  near(tied.logLoss, Math.log(2));
  near(tied.brier, 0.25);
  const extreme = probabilityMetrics([0, 1], [0, 1]);
  assert.ok(Number.isFinite(extreme.logLoss));
  assert.equal(extreme.auc, 1);
  assert.equal(extreme.brier, 0);
  assert.equal(extreme.bins.at(-1).high, 1);
  assert.equal(probabilityMetrics([1, 1], [0.1, 0.2]).auc, null);
  assert.equal(probabilityMetrics([], []).logLoss, null);
  assert.throws(() => probabilityMetrics([1], [NaN]), /不正/);
  assert.throws(() => probabilityMetrics([0, 1], [0.5]), /不正/);
});

test('cross validation fits medians, vocabulary and log scaling only on training records', () => {
  const rows = songs(),
    o = options(),
    records = targetRecords(rows, o).records;
  const { folds } = stratifiedFolds(records, 5),
    held = folds[0],
    training = folds.slice(1).flat();
  held.forEach((r) => {
    r.row.duration = 100000000;
    r.row.tags = ['評価側だけのタグ'];
  });
  const fitted = fitTreeFeatures(training, o),
    raw = transformTreeFeatures(training, fitted);
  assert.ok(!fitted.features.some((f) => f.label.includes('評価側だけ')));
  const scaling = fitLogisticScaling(raw.values, fitted.features, true);
  const d = fitted.features.findIndex((f) => f.key === 'duration');
  assert.ok(scaling[d].mean < 400);
  const c = fitted.features.findIndex((f) => f.key === 'comments');
  const median = fitted.features[c].median;
  const expected =
    training.reduce((sum, r) => sum + Math.log1p(r.row.comments ?? median), 0) / training.length;
  near(scaling[c].mean, expected, 1e-12);
  const transformed = scaleLogisticValues(
    transformTreeFeatures(held, fitted).values,
    fitted.features,
    scaling,
    true,
  );
  assert.ok(transformed.every((v) => v.every(Number.isFinite)));
});

test('held-out predictions are reproducible, unique, ID-based and independent of probability cutoff', () => {
  const rows = songs();
  const low = runAnalysis(rows, options({ logisticCutoff: 0.2 }));
  const high = runAnalysis([...rows].reverse(), options({ logisticCutoff: 0.8 }));
  assert.equal(low.n, 90);
  assert.equal(low.positive, rows.filter((r) => r.memberships[0].id === 'target').length);
  assert.equal(new Set(low.predictions.map((p) => p.id)).size, 90);
  assert.deepEqual(
    low.predictions.map((p) => [p.id, p.fold, p.score]),
    high.predictions.map((p) => [p.id, p.fold, p.score]),
  );
  assert.ok(low.groups[0].ids.length > high.groups[0].ids.length);
  for (const p of low.predictions) {
    const train = low.predictions.filter((other) => other.fold !== p.fold);
    near(p.baselineScore, train.filter((other) => other.actual).length / train.length, 1e-12);
  }
  assert.equal(
    low.probability.bins.reduce((sum, b) => sum + b.n, 0),
    90,
  );
  for (const c of low.coefficients) {
    const comparison = c.type === 'category' ? c.coefficient / c.scale : c.coefficient;
    near(c.oddsRatio, Math.exp(comparison), 1e-12);
  }
  assert.equal(low.scope.available, 90);
});

test('scopes, deduplication, hidden videos and target-defining features follow classifier rules', () => {
  const rows = songs();
  rows[0].status = 'deleted';
  const r = runAnalysis(
    [...rows, rows[1]],
    options({
      treeTarget: 'views',
      treeThreshold: 10000,
      features: ['views', 'commentRate', 'comments'],
    }),
  );
  assert.equal(r.scope.available, 89);
  assert.equal(r.n, 89);
  assert.deepEqual(r.blocked, ['views', 'commentRate']);
  assert.ok(!r.coefficients.some((c) => ['views', 'commentRate'].includes(c.key)));
  assert.throws(() => runAnalysis(rows, options({ playlists: ['target'] })), /それぞれ2曲/);
});

test('constant/intercept-only data, reduced folds, nonconvergence and work limits stay explicit', () => {
  const rows = songs(12).map((r) => ({ ...r, comments: 4, tags: [] }));
  const r = runAnalysis(rows, options({ features: ['comments'], treeCategories: [] }));
  assert.equal(r.coefficients.length, 0);
  assert.ok(r.warnings.some((w) => w.includes('有効な説明項目')));
  const rare = songs(12).map((r, i) => ({ ...r, memberships: i < 2 ? [{ id: 'target' }] : [] }));
  assert.equal(runAnalysis(rare, options()).folds, 2);
  const partial = runAnalysis(songs(), options({ logisticIterations: 1 }));
  assert.equal(partial.converged, false);
  assert.ok(partial.warnings.some((w) => w.includes('未収束')));
  assert.throws(() => fitLogistic([[0], [1]], [0, 1], {}, { work: 0, limit: 1 }), /計算量上限/);
  assert.throws(() => fitLogistic([[0], [1]], [0, 1], { lambda: 0 }), /正則化/);
  assert.throws(() => runAnalysis(songs(), options({ logisticCutoff: 1 })), /閾値/);
});

test('logistic CSV retains probability evaluation, coefficients, fold predictions and formula protection', () => {
  const r = runAnalysis(songs(), options());
  const csv = analysisCsv(r);
  for (const text of [
    'ロジスティック回帰',
    'L2正則化',
    '交差検証の対象確率',
    '標準化係数',
    'ROC-AUC',
    '変換後の母標準偏差',
    '未観測→観測',
  ])
    assert.ok(csv.includes(text), text);
  assert.match(csv, /'=malicious/);
  assert.doesNotMatch(csv, /\bundefined\b|\bNaN\b|\bInfinity\b/);
  assert.ok(csv.includes('sm90'));
});
