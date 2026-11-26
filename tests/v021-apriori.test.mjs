import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRuleDataset, parseRuleBins } from '../src/app/analytics/rule-data.js';
import { mineRules, mineRuleDataset } from '../src/app/analytics/rules.js';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { analysisDefaults } from '../src/app/analytics/data.js';
import { analysisCsv, ruleSourceCsv, ruleSourceArff } from '../src/app/analytics/export.js';

const advanced = {
  method: 'rules',
  ruleMode: 'apriori',
  ruleFields: ['tag'],
  support: 0.01,
  confidence: 0,
  ruleMinLift: 0,
  ruleMinCount: 1,
  ruleLimit: 500,
  ruleMaxSize: 5,
};
const videos = (baskets) =>
  baskets.map((tags, i) => ({ id: 'sm' + (i + 1), title: '曲' + i, tags }));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const signature = (r) =>
  [r.fromKeys, r.toKeys].map((keys) => [...keys].sort().join('|')).join(' -> ');

// Exhaustive enumeration of all subsets and partitions, independently of Apriori joins/pruning.
function exhaustive(dataset, maxSize) {
  const transactions = dataset.transactions.map((t) => new Set(t.items));
  const count = (subset) => transactions.filter((t) => subset.every((i) => t.has(i))).length;
  const rules = [];
  for (let mask = 1; mask < 2 ** dataset.items.length; mask++) {
    const indices = dataset.items.map((_, i) => i).filter((i) => mask & (1 << i));
    if (indices.length < 2 || indices.length > maxSize) continue;
    const fullCount = count(indices);
    if (fullCount < dataset.minCount) continue;
    for (let split = 1; split < 2 ** indices.length - 1; split++) {
      const from = indices.filter((_, i) => split & (1 << i)),
        to = indices.filter((_, i) => !(split & (1 << i)));
      const fromItems = from.map((i) => dataset.items[i]),
        toItems = to.map((i) => dataset.items[i]);
      const display = (side) =>
        side.length === 1 ? side[0].label : '（' + side.map((i) => i.label).join(' ＆ ') + '）';
      rules.push({
        from: display(fromItems),
        to: display(toItems),
        fromKeys: fromItems.map((i) => i.key),
        toKeys: toItems.map((i) => i.key),
        count: fullCount,
        support: fullCount / transactions.length,
        confidence: fullCount / count(from),
        lift: (fullCount * transactions.length) / count(from) / count(to),
        fromCount: count(from),
        toCount: count(to),
        ids: dataset.transactions
          .filter((_, i) => indices.every((item) => transactions[i].has(item)))
          .map((t) => t.id),
      });
    }
  }
  return rules;
}

test('Apriori returns every disjoint partition through five items with exhaustive counts', () => {
  const rows = videos([
    ['A', 'B', 'C', 'D', 'E'],
    ['A', 'B', 'C'],
    ['A', 'D'],
    ['B', 'D', 'E'],
    ['A', 'B'],
    ['C', 'E'],
    [],
    [],
  ]);
  const result = mineRules(rows, advanced);
  const expected = exhaustive(result.dataset, 5);
  assert.equal(result.partial, false);
  assert.equal(result.totalRules, expected.length);
  const lookup = new Map(result.rules.map((r) => [signature(r), r]));
  assert.equal(lookup.size, expected.length);
  for (const reference of expected) {
    const actual = lookup.get(signature(reference));
    assert.ok(actual, signature(reference));
    for (const field of ['count', 'support', 'confidence', 'lift', 'fromCount', 'toCount'])
      close(actual[field], reference[field]);
    assert.deepEqual(actual.ids, reference.ids);
    assert.ok(actual.fromKeys.every((k) => !actual.toKeys.includes(k)));
  }
  assert.ok(result.rules.some((r) => r.fromKeys.length === 2 && r.toKeys.length === 2));
  assert.ok(result.rules.some((r) => r.fromKeys.length === 3 && r.toKeys.length === 2));
});

test('grocery baskets reproduce hand-calculated support, confidence and lift', () => {
  const result = mineRules(
    videos([['パン', '牛乳', '卵'], ['パン', '牛乳', '卵'], ['パン', '牛乳'], ['牛乳'], []]),
    advanced,
  );
  const r = result.rules.find(
    (r) =>
      r.fromItems.length === 2 &&
      r.fromItems.includes('タグ：パン') &&
      r.fromItems.includes('タグ：牛乳') &&
      r.to === 'タグ：卵',
  );
  assert.equal(r.count, 2);
  assert.equal(r.fromCount, 3);
  assert.equal(r.toCount, 2);
  close(r.support, 0.4);
  close(r.confidence, 2 / 3);
  close(r.lift, 5 / 3);
  assert.ok(result.rules.some((r) => r.fromItems.length === 1 && r.toItems.length === 2));
});

test('bounded top-k matches a full independent sort for all three orderings', () => {
  const tags = ['A', 'B', 'C', 'D', 'E', 'F'];
  const rows = videos([
    ...Array.from({ length: 10 }, () => tags),
    ...Array.from({ length: 31 }, (_, i) => tags.filter((_, j) => (i * 13 + 7) & (1 << j))),
    [],
  ]);
  const dataset = buildRuleDataset(rows, advanced),
    reference = exhaustive(dataset, 5);
  // Same operation order as confidence / P(B) avoids tiny floating-point ordering differences.
  for (const r of reference) r.lift = r.confidence / (r.toCount / rows.length);
  assert.ok(reference.length > 500);
  for (const sort of ['count', 'lift', 'confidence'])
    for (const limit of [1, 7, 50, 500]) {
      const expected = [...reference].sort(
        (a, b) =>
          (sort === 'lift'
            ? b.lift - a.lift || b.count - a.count
            : sort === 'confidence'
              ? b.confidence - a.confidence || b.count - a.count || b.lift - a.lift
              : b.count - a.count || b.lift - a.lift) ||
          a.from.localeCompare(b.from, 'ja') ||
          a.to.localeCompare(b.to, 'ja') ||
          a.fromKeys.join().localeCompare(b.fromKeys.join()) ||
          a.toKeys.join().localeCompare(b.toKeys.join()),
      );
      const actual = mineRuleDataset(dataset, {
        ...advanced,
        ruleSort: sort,
        ruleLimit: limit,
      });
      assert.deepEqual(actual.rules.map(signature), expected.slice(0, limit).map(signature));
      assert.equal(actual.totalRules, expected.length);
    }
});

test('simple mode retains pair-only rules, minimum three occurrences and strict lift > 1', () => {
  const rows = videos([['A', 'A', 'B'], ['A', 'B'], ['A', 'B'], ['A'], ['B'], [], [], [], [], []]);
  const result = mineRules(rows, {
    ruleExtras: true,
    support: 0.01,
    confidence: 0,
  });
  assert.equal(result.maximum, 2);
  assert.equal(result.minCount, 3);
  assert.equal(result.limit, 50);
  assert.equal(result.rules.length, 2);
  close(result.rules[0].lift, 1.875);
  assert.ok(result.rules.every((r) => r.fromKeys.length === 1 && r.toKeys.length === 1));
  assert.equal(
    mineRules(videos(Array.from({ length: 5 }, () => ['A', 'B'])), {
      ruleExtras: true,
    }).rules.length,
    0,
  );
});

test('threshold boundaries and maximum size agree with exhaustive filtering', () => {
  const rows = videos([
    ['A', 'B', 'C', 'D'],
    ['A', 'B', 'C'],
    ['A', 'B'],
    ['A'],
    ['B'],
    [],
    [],
    [],
    [],
    [],
  ]);
  for (const maximum of [2, 3, 4, 5]) {
    const result = mineRules(rows, {
      ...advanced,
      ruleMaxSize: maximum,
      confidence: 0.5,
      ruleMinLift: 1.25,
      support: 0.2,
      ruleMinCount: 2,
    });
    const expected = exhaustive(result.dataset, maximum).filter(
      (r) => r.confidence + 1e-12 >= 0.5 && r.lift + 1e-12 >= 1.25,
    );
    assert.deepEqual(new Set(result.rules.map(signature)), new Set(expected.map(signature)));
    assert.ok(result.rules.every((r) => r.fromItems.length + r.toItems.length <= maximum));
  }
});

test('attribute and exact-item consequent filters apply to multi-item right-hand sides', () => {
  const rows = videos([['A', 'B', 'C'], ['A', 'B', 'C'], ['B'], [], []]).map((row) => ({
    ...row,
    views: 100,
  }));
  const options = {
    ...advanced,
    ruleFields: ['tag', 'views'],
    ruleConsequentField: 'views',
  };
  const result = mineRules(rows, options);
  assert.ok(result.rules.length);
  assert.ok(result.rules.every((r) => r.toKeys.some((k) => JSON.parse(k)[0] === 'views')));
  const item = result.dataset.items.find((i) => i.label === 'タグ：A');
  const exact = mineRules(rows, {
    ...options,
    ruleConsequentField: 'tag',
    ruleConsequentItem: item.key,
  });
  assert.ok(exact.rules.length && exact.rules.every((r) => r.toKeys.includes(item.key)));
  assert.ok(exact.rules.some((r) => r.toKeys.length > 1));
});

test('budgets discard an unfinished Apriori level and report rule-generation truncation', () => {
  const dataset = buildRuleDataset(
    videos(Array.from({ length: 5 }, () => ['A', 'B', 'C', 'D', 'E', 'F'])),
    advanced,
  );
  const result = mineRuleDataset(dataset, advanced, { joins: 16 });
  assert.equal(result.partial, true);
  assert.equal(result.completeSize, 2);
  assert.ok(result.warnings[0].includes('未完了'));
  assert.ok(result.rules.every((r) => r.fromKeys.length + r.toKeys.length === 2));
  assert.deepEqual(
    result.itemsetsBySize.map((l) => l.size),
    [1, 2],
  );
  for (const budget of [{ candidates: 0 }, { intersections: 0 }, { frequent: 6 }]) {
    const limited = mineRuleDataset(dataset, advanced, budget);
    assert.equal(limited.partial, true);
    assert.equal(limited.rules.length, 0);
    assert.equal(limited.completeSize, 1);
  }
  const limited = mineRuleDataset(dataset, advanced, { ruleCandidates: 5 });
  assert.equal(limited.partial, true);
  assert.equal(limited.totalRules, 5);
  assert.ok(limited.warnings.some((w) => w.includes('生成の上限')));
});

test('band boundaries use original counts/seconds and missing does not become zero', () => {
  const rows = [
    { views: 0, duration: 0, published_at: '2022-12-31T23:59:59Z' },
    { views: 10000, duration: 180, published_at: '2023-01-01T00:00:00Z' },
    { views: null, duration: '', published_at: 'invalid' },
    { views: undefined, duration: false },
    { views: 9999, duration: 120, published_at: '2026-11-26T00:00:00Z' },
  ].map((r, i) => ({ id: 'sm' + i, ...r }));
  const dataset = buildRuleDataset(rows, {
    ...advanced,
    ruleFields: ['views', 'duration', 'published'],
  });
  const labels = (i) => dataset.transactions[i].items.map((j) => dataset.items[j].label);
  assert.ok(labels(0).includes('再生数：1万再生未満'));
  assert.ok(labels(0).includes('動画時間：2分未満'));
  assert.ok(labels(0).includes('投稿時期：2020〜2022年'));
  assert.ok(labels(1).includes('再生数：1万以上10万再生未満'));
  assert.ok(labels(1).includes('動画時間：3分以上4分未満'));
  assert.ok(labels(1).includes('投稿時期：2023〜2026年'));
  assert.deepEqual(labels(2), []);
  assert.deepEqual(labels(3), []);
  const custom = buildRuleDataset(rows, {
    ...advanced,
    ruleFields: ['views'],
    ruleViewBins: '100,10000',
  });
  assert.ok(custom.items.some((i) => i.label === '再生数：100再生未満'));
});

test('playlist union filtering stays separate from active memberships used as rule items', () => {
  const rows = videos([['A'], ['A'], ['B'], [], []]).map((r, i) => ({
    ...r,
    memberships:
      i === 4
        ? [{ id: '1', name: '同名', present: false }]
        : [
            { id: i < 3 ? '1' : '2', name: '同名' },
            ...(i === 0 ? [{ id: '2', name: '同名' }] : []),
          ],
  }));
  rows.push(
    { ...rows[0] },
    { id: 'sm90', memberships: [{ id: '1', name: '同名' }], status: 'deleted' },
  );
  const result = runAnalysis(rows, {
    ...advanced,
    playlists: ['1'],
    ruleFields: ['tag', 'playlist'],
  });
  assert.equal(result.n, 3);
  assert.ok(result.dataset.items.some((i) => i.key === '["playlist","2"]'));
  assert.equal(result.scope.excluded.duplicate, 1);
  assert.equal(result.scope.excluded.deleted, 1);
  assert.equal(result.scope.excluded.scope, 2);
  const memberships = result.dataset.items.filter((i) => i.field === 'playlist');
  assert.equal(new Set(memberships.map((i) => i.label)).size, 2);
  assert.equal(
    result.dataset.transactions[0].items.filter((i) => result.dataset.items[i].field === 'playlist')
      .length,
    2,
  );
});

test('80-item cap and minimum support/count are shared by mining and source data', () => {
  const rows = videos(
    Array.from({ length: 6 }, (_, i) =>
      i < 3 ? Array.from({ length: 90 }, (_, j) => 'T' + j) : [],
    ),
  );
  const result = mineRules(rows, {
    ...advanced,
    ruleMaxSize: 2,
    ruleMinCount: 3,
    support: 0.5,
  });
  assert.equal(result.minCount, 3);
  assert.equal(result.items, 80);
  assert.equal(result.omittedItems, 10);
  assert.equal(result.dataset.transactions[3].items.length, 0);
  assert.equal(result.n, 6);
  const noItems = mineRules(rows, { ...advanced, support: 0.51 });
  assert.equal(noItems.minCount, 4);
  assert.equal(noItems.items, 0);
  assert.deepEqual(noItems.rules, []);
});

test('invalid settings are rejected; inactive bands do not block simple analysis', () => {
  const rows = videos([['A', 'B'], ['A'], []]);
  for (const patch of [
    { ruleMaxSize: 6 },
    { ruleMaxSize: 2.5 },
    { ruleLimit: 0 },
    { ruleLimit: 501 },
    { ruleMinCount: 0 },
    { ruleMinLift: -1 },
    { ruleMinLift: Infinity },
    { support: 0 },
    { support: 1.1 },
    { confidence: NaN },
    { confidence: 1.1 },
    { ruleFields: [] },
    { ruleFields: ['unknown'] },
    { ruleConsequentField: 'views' },
    { ruleConsequentItem: 'gone' },
    { ruleMode: 'unknown' },
  ])
    assert.throws(() => mineRules(rows, { ...advanced, ...patch }));
  for (const value of [
    '',
    '1,1',
    '3,2',
    '0,1',
    'NaN',
    '1,Infinity',
    '1,',
    Array(14).fill(1).join(','),
  ])
    assert.throws(() => parseRuleBins(value, '1'));
  assert.throws(() =>
    mineRules(rows, {
      ...advanced,
      ruleFields: ['views'],
      ruleViewBins: 'wrong',
    }),
  );
  assert.doesNotThrow(() =>
    mineRules(rows, {
      ruleExtras: true,
      ruleViewBins: 'wrong',
      ruleYearBins: '',
    }),
  );
});

test('source CSV and positive-only ARFF preserve empty transactions and escape untrusted text', () => {
  const rows = videos([["a'b\\c\n@data", '=危険'], ["a'b\\c\n@data"], []]);
  rows[0].title = '=HYPERLINK("evil")';
  const result = runAnalysis(rows, advanced);
  const csv = ruleSourceCsv(result),
    arff = ruleSourceArff(result),
    exported = analysisCsv(result);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.match(csv, /"sm3","曲2",0,0/);
  assert.ok(!arff.startsWith('\uFEFF'));
  assert.match(arff, /a\\'b\\\\c\\n@data/);
  assert.doesNotMatch(arff, /HYPERLINK|sm1|\{present,absent\}/);
  assert.equal(arff.split('\n').filter((l) => l.startsWith('@attribute')).length, result.items);
  assert.match(arff, /\n\?,\?\n$/);
  assert.match(exported, /条件Aの項目（JSON）/);
  assert.match(exported, /最低共起曲数/);
  assert.match(exported, /Apriori/);
  assert.throws(() => ruleSourceArff({ ...result, dataset: { ...result.dataset, items: [] } }));
});

test('analysis snapshots clone attribute selections and defaults stay independent', () => {
  const a = analysisDefaults(),
    b = analysisDefaults();
  a.ruleFields.pop();
  assert.notDeepEqual(a.ruleFields, b.ruleFields);
  assert.deepEqual(a.features, ['views', 'comments', 'mylists']);
  const opts = { ...advanced, ruleFields: ['tag'] };
  const r = runAnalysis(videos([['A'], ['B'], []]), opts);
  opts.ruleFields.push('views');
  assert.deepEqual(r.options.ruleFields, ['tag']);
});
