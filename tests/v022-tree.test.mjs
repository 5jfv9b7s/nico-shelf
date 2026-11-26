import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAnalysis } from '../src/app/analytics/engine.js';
import {
  fitDecisionTree,
  predictDecisionTree,
  impurity,
} from '../src/app/analytics/decision-tree.js';
import { binaryMetrics, stratifiedFolds } from '../src/app/analytics/classification-evaluation.js';
import {
  targetRecords,
  fitTreeFeatures,
  transformTreeFeatures,
} from '../src/app/analytics/classification-data.js';
import { analysisCsv } from '../src/app/analytics/export.js';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/decision-tree-reference.json', import.meta.url)),
);
const options = {
  method: 'tree',
  treeTarget: 'playlist',
  treePlaylist: 'p1',
  features: ['comments'],
  treeCategories: [],
};
const rows = (n = 120) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'sm' + (i + 1),
    title: '曲' + i,
    views: i * 100,
    comments: i < n / 2 ? 10 : 100,
    mylists: i + 1,
    memberships: [{ id: i < n / 2 ? 'p1' : 'p2', name: '任意の名前' }],
    userMeta: { favorite: i % 5 === 0 },
    tags: i < n / 2 ? ['A'] : ['B'],
  }));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('CART splits and fixed-alpha pruning match independent scikit-learn predictions and leaf shares', () => {
  for (const reference of fixture.cases) {
    const tree = fitDecisionTree(fixture.values, fixture.labels, {
      depth: 4,
      leaf: 3,
      alpha: reference.alpha,
      criterion: reference.criterion,
    });
    const got = fixture.probe.map((value) => predictDecisionTree(tree, value));
    assert.deepEqual(
      got.map((p) => p.predicted),
      reference.predicted,
    );
    got.forEach((p, i) => close(p.score, reference.scores[i]));
    const leaves = (node) => (node.left ? leaves(node.left) + leaves(node.right) : 1);
    assert.equal(leaves(tree), reference.leaves);
  }
});
test('binary evaluation matches independent metrics and leaves undefined precision unfilled', () => {
  const ref = fixture.metrics,
    got = binaryMetrics(ref.actual, ref.predicted);
  for (const key of ['accuracy', 'balancedAccuracy', 'precision', 'recall', 'f1'])
    close(got[key], ref[key]);
  assert.deepEqual(
    [
      [got.tn, got.fp],
      [got.fn, got.tp],
    ],
    ref.matrix,
  );
  const none = binaryMetrics([0, 1, 0, 1], [0, 0, 0, 0]);
  assert.equal(none.precision, null);
  assert.equal(none.recall, 0);
  assert.equal(none.f1, 0);
  assert.equal(binaryMetrics([], []).accuracy, null);
  assert.throws(() => binaryMetrics([1], []));
  assert.throws(() => binaryMetrics([2], [0]));
});
test('stratified folds partition video IDs once, retain both classes and ignore input order', () => {
  const records = rows().map((row) => ({ row, target: row.memberships[0].id === 'p1' ? 1 : 0 }));
  const a = stratifiedFolds(records, 5),
    b = stratifiedFolds([...records].reverse(), 5);
  assert.deepEqual(
    a.folds.map((f) => f.map((r) => r.row.id)),
    b.folds.map((f) => f.map((r) => r.row.id)),
  );
  const seen = new Set();
  for (const fold of a.folds) {
    assert.equal(new Set(fold.map((r) => r.target)).size, 2);
    for (const r of fold) {
      assert.ok(!seen.has(r.row.id));
      seen.add(r.row.id);
    }
  }
  assert.equal(seen.size, records.length);
  const small = records.slice(0, 2).concat(records.slice(-8));
  assert.equal(stratifiedFolds(small, 5).k, 2);
  assert.throws(() =>
    stratifiedFolds(
      records.filter((r) => r.target),
      5,
    ),
  );
});
test('median imputation and categorical vocabulary use training records only', () => {
  const train = Array.from({ length: 6 }, (_, i) => ({
    row: { id: 'sm' + i, comments: i === 0 ? 2 : i === 1 ? 4 : null, tags: i < 3 ? ['TRAIN'] : [] },
    target: i % 2,
  }));
  const fitted = fitTreeFeatures(train, { ...options, treeCategories: ['tag'] });
  assert.equal(fitted.features.find((f) => f.key === 'comments').median, 3);
  const transformed = transformTreeFeatures(
    [{ row: { comments: null, tags: ['HELD-OUT-ONLY'] }, target: 1 }],
    fitted,
  );
  assert.equal(transformed.imputed, 1);
  assert.deepEqual(transformed.values[0], [3, 0]);
  assert.ok(!fitted.features.some((f) => f.value === 'HELD-OUT-ONLY'));
  assert.equal(fitted.features.find((f) => f.type === 'category').value, 'TRAIN');
});
test('playlist targets use IDs, distinguish identical names and ignore removed memberships', () => {
  const source = [
    { id: 'sm1', memberships: [{ id: 'p1', name: '同名' }] },
    { id: 'sm2', memberships: [{ id: 'p2', name: '同名' }] },
    { id: 'sm3', memberships: [{ id: 'p1', name: '同名', present: false }] },
  ];
  assert.deepEqual(
    targetRecords(source, options).records.map((r) => r.target),
    [1, 0, 0],
  );
  assert.throws(() => targetRecords(source, { ...options, treePlaylist: '' }), /マイリストを選択/);
  const favorites = targetRecords(rows(40), { treeTarget: 'favorite' });
  assert.equal(favorites.records.filter((r) => r.target).length, 8);
});
test('view targets preserve zero, omit missing labels and exclude definition-derived predictors', () => {
  const source = rows(14).map((r, i) => ({
    ...r,
    views: i === 12 ? null : i === 13 ? false : [0, 9999, 10000, 15000][i % 4],
  }));
  const result = runAnalysis(source, {
    ...options,
    treeTarget: 'views',
    treeThreshold: 10000,
    features: ['views', 'mylistRate', 'commentRate', 'likeRate', 'comments'],
  });
  assert.equal(result.n, 12);
  assert.equal(result.missing, 2);
  assert.equal(result.positive, 6);
  assert.deepEqual(
    result.features.map((f) => f.key),
    ['comments'],
  );
  assert.equal(result.blocked.length, 4);
  const membership = runAnalysis(rows(), { ...options, features: ['membershipCount', 'comments'] });
  assert.deepEqual(membership.blocked, ['membershipCount']);
  assert.throws(
    () => runAnalysis(rows(), { ...options, features: ['membershipCount'] }),
    /説明変数/,
  );
});
test('cross-validation predicts every eligible video once and the separate full-data tree exposes node members', () => {
  const source = rows();
  source.push({ ...source[0] }, { id: 'sm999', status: 'deleted', memberships: [{ id: 'p1' }] });
  const result = runAnalysis(source, options);
  assert.equal(result.n, 120);
  assert.equal(result.predictions.length, 120);
  assert.equal(new Set(result.predictions.map((p) => p.id)).size, 120);
  assert.equal(result.metrics.accuracy, 1);
  assert.equal(result.baseline.accuracy, 0.5);
  assert.equal(result.scope.excluded.duplicate, 1);
  assert.equal(result.scope.excluded.deleted, 1);
  assert.equal(result.tree.n, result.tree.ids.length);
  assert.equal(result.tree.left.n + result.tree.right.n, result.tree.n);
  const predicted = new Map(result.predictions.map((p) => [p.id, p]));
  for (const row of source.slice(0, 120))
    assert.equal(predicted.get(row.id).actual, row.memberships[0].id === 'p1' ? 1 : 0);
  assert.ok(result.foldResults.every((f) => f.trainN + f.testN === 120));
});
test('fixed limits and pruning constrain tree size while allowing XOR to split through zero initial gain', () => {
  const x = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    y = [0, 1, 1, 0];
  const grown = fitDecisionTree(x, y, { depth: 2, leaf: 1, alpha: 0, criterion: 'gini' });
  assert.deepEqual(
    x.map((v) => predictDecisionTree(grown, v).predicted),
    y,
  );
  const pruned = fitDecisionTree(x, y, { depth: 2, leaf: 1, alpha: 0.2, criterion: 'gini' });
  assert.equal(pruned.left, undefined);
  assert.throws(
    () =>
      fitDecisionTree(
        x,
        y,
        { depth: 2, leaf: 1, alpha: 0, criterion: 'gini' },
        { scans: 0, limit: 0 },
      ),
    /計算量上限/,
  );
  close(impurity(2, 4, 'gini'), 0.5);
  close(impurity(2, 4, 'entropy'), 1);
});
test('one-class scopes and invalid parameters produce explicit errors; small minority reduces folds', () => {
  assert.throws(() => runAnalysis(rows(), { ...options, playlists: ['p1'] }), /それぞれ2曲/);
  for (const patch of [
    { treeDepth: 9 },
    { treeDepth: 0 },
    { treeMinLeaf: 0 },
    { treeAlpha: -1 },
    { treeAlpha: NaN },
    { treeFolds: 2 },
    { treeCriterion: 'gain-ratio' },
    { treeTarget: 'unknown' },
    { treeTarget: 'views', treeThreshold: -1 },
    { features: [], treeCategories: [] },
  ])
    assert.throws(() => runAnalysis(rows(), { ...options, ...patch }));
  const imbalanced = rows(40).map((r, i) => ({ ...r, userMeta: { favorite: i < 3 } }));
  const result = runAnalysis(imbalanced, { ...options, treeTarget: 'favorite' });
  assert.equal(result.folds, 3);
  assert.ok(result.warnings.some((w) => w.includes('偏り')));
  assert.ok(result.warnings.some((w) => w.includes('減らしました')));
});
test('constant or entirely missing predictors yield a documented majority leaf without NaN', () => {
  const result = runAnalysis(
    rows().map((r) => ({ ...r, comments: null })),
    options,
  );
  assert.equal(result.tree.left, undefined);
  assert.equal(result.metrics.precision, null);
  assert.ok(result.warnings.some((w) => w.includes('分岐のない')));
  assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
});
test('classification CSV records held-out predictions, target IDs, preprocessing and exact node membership safely', () => {
  const source = rows();
  source[0].title = '=HYPERLINK("untrusted")';
  const result = runAnalysis(source, options),
    csv = analysisCsv(result);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /分類対象マイリストID/);
  assert.match(csv, /p1/);
  assert.match(csv, /交差検証の予測/);
  assert.match(csv, /全曲で作った説明用の木/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /補完と分類項目の選択/);
  assert.ok(csv.includes('"葉内対象割合"'));
  assert.doesNotMatch(csv, /ln\(1\+x\)/);
});
