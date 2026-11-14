import test from 'node:test';
import assert from 'node:assert/strict';
import { correlationMatrix } from '../src/app/analytics/correlation.js';
import { eligibleRows, completeData } from '../src/app/analytics/data.js';
import { fitOLS, regressionAnalysis } from '../src/app/analytics/regression.js';
import { principalComponents } from '../src/app/analytics/pca.js';
import { mineRules } from '../src/app/analytics/rules.js';
import { kmeans, hierarchical } from '../src/app/analytics/clusters.js';
import { readFile } from 'node:fs/promises';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { analysisDefaults } from '../src/app/analytics/data.js';
import { analysisCsv } from '../src/app/analytics/export.js';

const reference = JSON.parse(
  await readFile(new URL('./fixtures/analytics-reference.json', import.meta.url), 'utf8'),
);

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, a + ' != ' + b);
test('2. 単回帰は既知の切片・傾き・R²を復元し、欠損を0にしない', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: 'sm' + (i + 1),
    views: i,
    likes: 2 + 3 * i,
  }));
  rows.push({ id: 'sm99', views: null, likes: 100 });
  const r = regressionAnalysis(rows, { x: 'views', y: 'likes', logCounts: false });
  close(r.coefficients[0].value, 2);
  close(r.coefficients[1].value, 3);
  close(r.r2, 1);
  assert.equal(r.missing, 1);
  assert.equal(r.n, 10);
  assert.throws(() => fitOLS([[1], [1], [1]], [1, 2, 3]), /一定/);
  assert.throws(() => fitOLS([[1], [2]], [2, 4]), /有効曲/);
});
test('3. 重回帰は複数の係数を復元し、共線性で識別できない係数を出さない', () => {
  const x = Array.from({ length: 30 }, (_, i) => [i, i % 4]);
  const y = x.map(([a, b]) => 1.5 + 2 * a - 0.75 * b);
  const r = fitOLS(x, y);
  close(r.coefficients[0].value, 1.5);
  close(r.coefficients[1].value, 2);
  close(r.coefficients[2].value, -0.75);
  close(r.adjustedR2, 1);
  assert.ok(r.coefficients.every((c) => c.se >= 0));
  assert.throws(
    () =>
      fitOLS(
        x.map(([a]) => [a, 2 * a]),
        y,
      ),
    /ほぼ同じ/,
  );
});
test('5. 主成分分析は完全相関列を1軸へ集約し、得点を中心化する', () => {
  const r = principalComponents([
    [1, 2, 9],
    [2, 4, 9],
    [3, 6, 9],
    [4, 8, 9],
  ]);
  close(r.explained[0], 1);
  close(r.eigenvalues[0], 2);
  assert.deepEqual(r.dropped, [2]);
  close(
    r.scores.reduce((sum, row) => sum + row[0], 0),
    0,
  );
  close(r.loadings[0][0], 1);
  close(r.loadings[1][0], 1);
});
test('9. 相関ルールは全曲を分母に支持度・確信度・リフトを算出する', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    id: 'sm' + (i + 1),
    tags: i < 3 ? ['A', 'B', 'A'] : i < 5 ? ['A'] : i < 6 ? ['B'] : [],
  }));
  const result = mineRules(rows, { ruleExtras: true, support: 0.2, confidence: 0.5 });
  const rule = result.rules.find((r) => r.from === 'タグ：A' && r.to === 'タグ：B');
  assert.equal(rule.count, 3);
  close(rule.support, 0.3);
  close(rule.confidence, 0.6);
  close(rule.lift, 1.5);
  assert.equal(rule.ids.length, 3);
  assert.equal(result.n, 10);
});
test('10. k-meansは再現可能で、空群を作らず、分離した群を復元する', () => {
  const values = [
    [0, 0],
    [0, 1],
    [1, 0],
    [20, 20],
    [20, 21],
    [21, 20],
  ];
  const a = kmeans(values, 2),
    b = kmeans(values, 2);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.labels.slice(0, 3)).size, 1);
  assert.equal(new Set(a.labels.slice(3)).size, 1);
  assert.notEqual(a.labels[0], a.labels[3]);
  close(a.inertia, 8 / 3);
  assert.throws(
    () =>
      kmeans(
        [
          [0, 0],
          [0, 0],
          [1, 1],
        ],
        3,
      ),
    /異なる特徴/,
  );
});
test('10. 階層型は平均連結で統合し、指定群数で切った樹形図を返す', () => {
  const r = hierarchical([[0], [1], [10], [12]], 2);
  assert.equal(r.labels[0], r.labels[1]);
  assert.equal(r.labels[2], r.labels[3]);
  assert.notEqual(r.labels[0], r.labels[2]);
  assert.deepEqual(r.linkage.slice(0, 2), [
    [0, 1, 1, 2],
    [2, 3, 2, 2],
  ]);
  close(r.linkage[2][2], 10.5);
  assert.equal(r.tree.left.size + r.tree.right.size, 4);
});
test('回帰の係数・標準誤差・VIF・R²が独立したNumPy計算と一致する', () => {
  const actual = fitOLS(reference.x, reference.y);
  actual.coefficients.forEach((c, i) => {
    close(c.value, reference.coefficients[i], 1e-8);
    close(c.se, reference.se[i], 1e-8);
    if (i) close(c.vif, reference.vif[i - 1], 1e-8);
  });
  close(actual.r2, reference.r2);
});
test('主成分の固有値・軸・得点が独立したNumPy SVDと一致する', () => {
  const actual = principalComponents(reference.x);
  actual.eigenvalues.forEach((v, i) => close(v, reference.pca.eigenvalues[i]));
  actual.vectors.forEach((row, i) => row.forEach((v, j) => close(v, reference.pca.vectors[i][j])));
  actual.scores.forEach((row, i) => row.forEach((v, j) => close(v, reference.pca.scores[i][j])));
});
test('平均連結法の統合順と距離が独立したSciPy計算と一致する', () => {
  const normalized = principalComponents(reference.x).values;
  const actual = hierarchical(normalized.slice(0, 9), 3);
  actual.linkage.forEach((row, i) => row.forEach((v, j) => close(v, reference.linkage[i][j])));
});
test('6方式すべてを対象選択・欠損処理・CSVまで実行できる', () => {
  const rows = reference.x.map(([a, b, c], i) => ({
    id: 'sm' + (i + 1),
    title: i ? '曲' + i : '=HYPERLINK("https://bad.example")',
    views: a * 100,
    likes: b + 2,
    comments: c + 1,
    mylists: reference.y[i],
    duration: 60 + i * i,
    memberships: [{ id: 'a' }],
    tags: i < 10 ? ['TEST-A', 'TEST-B'] : ['TEST-C'],
  }));
  for (const method of ['correlation', 'regression', 'multiple', 'pca', 'rules', 'clusters']) {
    const options = {
      ...analysisDefaults(),
      method,
      features: ['views', 'likes', 'comments'],
      y: 'mylists',
      k: 3,
      ruleExtras: true,
    };
    const result = runAnalysis(rows, options);
    assert.equal(result.method, method);
    assert.equal(result.scope.available, 30);
    const csv = analysisCsv(result);
    assert.ok(csv.startsWith('\uFEFF'));
    assert.doesNotMatch(csv, /(?:^|\r\n)"=HYPERLINK/);
    if (['regression', 'multiple', 'pca', 'clusters'].includes(method))
      assert.ok(csv.includes("'=HYPERLINK"));
  }
});
test('階層型の300曲標本は入力順に依存せず、標本外件数を報告する', () => {
  const rows = Array.from({ length: 330 }, (_, i) => ({
    id: 'sm' + (i + 1),
    views: i + 1,
    comments: (i % 7) + 1,
  }));
  const options = {
    ...analysisDefaults(),
    method: 'clusters',
    clusterMethod: 'hierarchical',
    features: ['views', 'comments'],
    k: 3,
  };
  const first = runAnalysis(rows, options);
  const second = runAnalysis([...rows].reverse(), options);
  assert.equal(first.n, 300);
  assert.equal(first.sampled, 30);
  assert.deepEqual(
    first.points.map((p) => p.id),
    second.points.map((p) => p.id),
  );
  assert.deepEqual(first.groups, second.groups);
});
test('1. 相関はペアごとの欠損除外、同順位、定数列を処理する', () => {
  const rows = [
    { id: 'sm1', views: 1, likes: 2, duration: 60 },
    { id: 'sm2', views: 2, likes: 4, duration: 60 },
    { id: 'sm3', views: 2, likes: 4, duration: 60 },
    { id: 'sm4', views: 4, likes: null, duration: 60 },
  ];
  const result = correlationMatrix(rows, {
    features: ['views', 'likes', 'duration'],
    correlation: 'spearman',
  });
  close(result.cells[0][1].r, 1);
  assert.equal(result.cells[0][1].n, 3);
  assert.equal(result.cells[0][0].n, 4);
  assert.equal(result.cells[0][2].r, null);
  const p = correlationMatrix(rows, {
    features: ['views', 'likes'],
    correlation: 'pearson',
    logCounts: false,
  });
  close(p.cells[0][1].r, 1);
});
test('共通の分析対象は動画ID単位で重複除外し、所属と公開状態を検査する', () => {
  const rows = [
    { id: 'sm1', views: 0, memberships: [{ id: 'a' }] },
    { id: 'sm1', views: 100, memberships: [{ id: 'a' }] },
    { id: 'sm2', status: 'deleted', memberships: [{ id: 'a' }] },
    { id: 'sm3', memberships: [{ id: 'b' }] },
  ];
  const data = eligibleRows(rows, { playlist: 'a' });
  assert.equal(data.rows.length, 1);
  assert.equal(data.excluded.duplicate, 1);
  assert.equal(data.excluded.deleted, 1);
  assert.equal(data.excluded.scope, 1);
  const complete = completeData(data.rows, ['views'], true);
  assert.deepEqual(complete.values, [[0]]);
});
