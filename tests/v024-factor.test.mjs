import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  fitFactorAnalysis,
  factorStandardize,
  minimumFactorVariables,
  varimax,
} from '../src/app/analytics/factor-analysis.js';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { analysisDefaults } from '../src/app/analytics/data.js';
import { analysisCsv } from '../src/app/analytics/export.js';

const reference = JSON.parse(
  readFileSync(new URL('./fixtures/factor-reference.json', import.meta.url)),
);
const near = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
function matrixNear(a, b, tol = 1e-7) {
  assert.equal(a.length, b.length);
  a.forEach((row, i) => {
    assert.equal(row.length, b[i].length);
    row.forEach((v, j) => near(v, b[i][j], tol));
  });
}
function dataset() {
  return reference.datasets[0].raw.map((v, i) => ({
    id: 'sm' + (i + 1),
    title: i ? '曲' + i : '=悪意,\n"タイトル"',
    views: 100 + v[0],
    comments: 100 + v[1],
    mylists: 100 + v[2],
    likes: 100 + v[3],
    duration: 300 + v[4],
    memberships: [{ id: i < 100 ? 'a' : 'b', name: '同じ名前' }],
  }));
}
const options = (extra) => ({
  ...analysisDefaults(),
  method: 'factor',
  features: ['views', 'comments', 'mylists', 'likes', 'duration'],
  logCounts: false,
  ...extra,
});

test('factor loadings, noise, likelihood, rotations and estimated scores match independent scikit-learn fits', () => {
  for (const data of reference.datasets)
    for (const ref of data.cases) {
      const r = fitFactorAnalysis(data.raw, { count: ref.count, rotation: ref.rotation });
      assert.equal(r.converged, true);
      assert.equal(r.iterations, ref.iterations);
      matrixNear(r.loadings, ref.loadings);
      matrixNear(r.scores, ref.scores);
      matrixNear(r.reproduced, ref.covariance);
      matrixNear(r.correlation, data.correlation);
      r.noise.forEach((v, i) => near(v, ref.noise[i]));
      r.communalities.forEach((v, i) => near(v, ref.communalities[i]));
      near(r.logLikelihood.at(-1), ref.logLikelihood);
      r.logLikelihood.slice(1).forEach((v, i) => assert.ok(v >= r.logLikelihood[i] - 1e-8));
    }
});

test('Varimax preserves common covariance, communalities and factor sum of squares', () => {
  const r = fitFactorAnalysis(reference.datasets[1].raw, { count: 2 });
  for (let i = 0; i < r.loadings.length; i++)
    for (let j = 0; j < r.loadings.length; j++) {
      near(
        r.loadings[i].reduce((sum, v, k) => sum + v * r.loadings[j][k], 0),
        r.unrotated[i].reduce((sum, v, k) => sum + v * r.unrotated[j][k], 0),
      );
    }
  r.loadings.forEach((row, i) =>
    row.forEach((v, j) =>
      near(
        v,
        r.unrotated[i].reduce((sum, u, k) => sum + u * r.rotationMatrix[k][j], 0),
      ),
    ),
  );
  near(
    r.sums.reduce((a, b) => a + b),
    r.communalities.reduce((a, b) => a + b),
  );
  const limited = varimax(r.unrotated, { maxIterations: 1 });
  assert.equal(limited.converged, false);
});

test('sample scope, deduplication, missing and constant columns remain explicit without writing data', () => {
  const rows = dataset();
  rows[0].comments = null;
  rows[1].status = 'private';
  rows.push({ ...rows[2] });
  const before = JSON.stringify(rows);
  const r = runAnalysis(rows, options({ playlists: ['a'] }));
  assert.equal(r.n, 98);
  assert.equal(r.missing, 1);
  assert.equal(r.scope.available, 99);
  assert.equal(r.scope.excluded.duplicate, 1);
  assert.equal(JSON.stringify(rows), before);
  rows.forEach((v) => (v.likes = 5));
  const dropped = runAnalysis(rows, options());
  assert.deepEqual(dropped.dropped, ['likes']);
  assert.equal(dropped.keys.length, 4);
  assert.ok(dropped.points.every((p) => p.scores.length === 1 && p.y === 0));
  const log = runAnalysis(dataset(), options({ logCounts: true }));
  assert.notDeepEqual(log.loadings, r.loadings);
});

test('factor score coefficients reproduce the fitted Gaussian conditional mean, and residual RMSR excludes diagonal', () => {
  const r = fitFactorAnalysis(reference.datasets[1].raw, { count: 2 });
  r.scores.forEach((row, i) =>
    row.forEach((v, k) =>
      near(
        v,
        r.values[i].reduce((sum, z, j) => sum + z * r.scoreWeights[j][k], 0),
      ),
    ),
  );
  let sum = 0,
    n = 0;
  for (let i = 0; i < r.residuals.length; i++)
    for (let j = i + 1; j < r.residuals.length; j++) {
      sum += r.residuals[i][j] ** 2;
      n++;
    }
  near(r.rmsr, Math.sqrt(sum / n));
  assert.ok(r.scores.some((row) => Math.abs(row[0]) > 1));
});

test('factor count constraints, insufficient complete rows, near duplicate columns and invalid inputs return actionable errors', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(minimumFactorVariables), [3, 5, 6, 8, 9]);
  const raw = reference.datasets[1].raw;
  assert.throws(
    () =>
      fitFactorAnalysis(
        raw.map((v) => v.slice(0, 3)),
        { count: 2 },
      ),
    /2因子.*5個/,
  );
  assert.throws(() => fitFactorAnalysis(raw.slice(0, 19)), /20〜10000/);
  assert.throws(() => fitFactorAnalysis(raw.map((v) => [v[0], v[0], v[2]])), /不安定/);
  assert.throws(() => fitFactorAnalysis(raw, { count: 1.5 }), /整数/);
  assert.throws(() => fitFactorAnalysis(raw, { rotation: 'oblimin' }), /回転/);
  assert.throws(() => fitFactorAnalysis(raw.map((v) => [NaN, ...v.slice(1)])), /不正/);
  const scaled = factorStandardize(raw.map((v) => [v[0] * 1e200, v[1] * 1e200, 7, v[3] * 1e200]));
  assert.deepEqual(scaled.dropped, [2]);
  assert.ok(scaled.values.every((v) => v.every(Number.isFinite)));
});

test('nonconvergence, small samples and zero-degree models are not presented as reliable factor discoveries', () => {
  const raw = reference.datasets[0].raw;
  const limited = fitFactorAnalysis(raw, { maxIterations: 1 });
  assert.equal(limited.converged, false);
  assert.ok(limited.warnings.some((w) => w.includes('未収束')));
  const small = fitFactorAnalysis(raw.slice(0, 30).map((v) => v.slice(0, 3)));
  assert.equal(small.df, 0);
  assert.ok(small.warnings.some((w) => w.includes('自由度が0')));
  assert.ok(small.warnings.some((w) => w.includes('曲数が少ない')));
});

test('factor CSV includes all scores and reproducibility details with protected untrusted titles', () => {
  const r = runAnalysis(dataset(), options({ factorCount: 2 }));
  const csv = analysisCsv(r);
  for (const text of [
    '因子分析',
    '最尤法',
    'Kaiser正規化なし',
    '共通性',
    '独自分散',
    '母標準偏差',
    'F1 推定因子得点',
    'F2 推定因子得点',
    'sm180',
    '1曲あたり対数尤度',
  ])
    assert.ok(csv.includes(text), text);
  assert.match(csv, /'=悪意/);
  assert.doesNotMatch(csv, /\bundefined\b|\bNaN\b|\bInfinity\b/);
});

test('collapsed factors and near-zero unique variance receive explicit model warnings', () => {
  const orthogonal = Array.from({ length: 120 }, (_, i) =>
    [1, 2, 3].map((k) => Math.SQRT2 * Math.sin((2 * Math.PI * k * i) / 120)),
  );
  const empty = fitFactorAnalysis(orthogonal);
  assert.ok(empty.warnings.some((w) => w.includes('ほぼ0の因子')));
  const a = Math.sqrt(0.51),
    b = -0.39 / a,
    c = Math.sqrt(0.51 - b * b);
  const boundary = fitFactorAnalysis(
    orthogonal.map(([x, y, z]) => [x, 0.7 * x + a * y, 0.7 * x + b * y + c * z]),
    { maxIterations: 1000 },
  );
  assert.ok(boundary.warnings.some((w) => w.includes('境界解')));
  assert.ok(boundary.noise.some((v) => v < 0.005));
});
