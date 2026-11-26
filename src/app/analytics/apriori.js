import { buildRuleDataset, RULE_FIELDS } from './rule-data.js';
const LIMITS = Object.freeze({
  candidates: 100000,
  joins: 200000,
  frequent: 15000,
  intersections: 20000000,
  ruleCandidates: 300000,
});
const keyFor = (items) => items.join(',');
function integer(value, low, high, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < low || n > high)
    throw new Error(`${label}は${low}〜${high}の整数にしてください`);
  return n;
}
export function compareRules(sort) {
  return (a, b) =>
    (sort === 'lift'
      ? b.lift - a.lift || b.count - a.count
      : sort === 'confidence'
        ? b.confidence - a.confidence || b.count - a.count || b.lift - a.lift
        : b.count - a.count || b.lift - a.lift) ||
    a.from.localeCompare(b.from, 'ja') ||
    a.to.localeCompare(b.to, 'ja') ||
    a.fromKeys.join().localeCompare(b.fromKeys.join()) ||
    a.toKeys.join().localeCompare(b.toKeys.join());
}
function topRules(limit, compare) {
  const heap = [];
  const down = () => {
    let i = 0;
    while (true) {
      let c = i * 2 + 1;
      if (c >= heap.length) break;
      if (c + 1 < heap.length && compare(heap[c + 1], heap[c]) > 0) c++;
      if (compare(heap[c], heap[i]) <= 0) break;
      [heap[i], heap[c]] = [heap[c], heap[i]];
      i = c;
    }
  };
  return {
    add(rule) {
      if (heap.length < limit) {
        heap.push(rule);
        let i = heap.length - 1;
        while (i) {
          const p = (i - 1) >> 1;
          if (compare(heap[i], heap[p]) <= 0) break;
          [heap[i], heap[p]] = [heap[p], heap[i]];
          i = p;
        }
      } else if (compare(rule, heap[0]) < 0) {
        heap[0] = rule;
        down();
      }
    },
    values: () => heap.sort(compare),
  };
}

/** Apriori prefix joins/subset pruning and intersections of sorted transaction IDs. */
export function mineRuleDataset(dataset, options = {}, budgets = LIMITS) {
  const limits = { ...LIMITS, ...budgets },
    n = dataset.transactions.length;
  if (n < 3) throw new Error('相関ルールの分析には3曲以上必要です');
  const advanced = dataset.mode === 'apriori';
  const maximum = advanced ? integer(options.ruleMaxSize ?? 3, 2, 5, '最大項目集合サイズ') : 2;
  const limit = advanced ? integer(options.ruleLimit ?? 50, 1, 500, '表示件数') : 50;
  const confidence = Number(options.confidence ?? 0.5),
    minLift = advanced ? Number(options.ruleMinLift ?? 1.01) : 1;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
    throw new Error('確信度は0〜100%にしてください');
  if (!Number.isFinite(minLift) || minLift < 0 || minLift > 1000000)
    throw new Error('最低リフトは0〜100万にしてください');
  const consequentField = advanced ? options.ruleConsequentField || '' : '';
  const consequentItem = advanced ? options.ruleConsequentItem || '' : '';
  if (
    consequentField &&
    (!Object.hasOwn(RULE_FIELDS, consequentField) || !dataset.fields.includes(consequentField))
  )
    throw new Error('結論部の属性を、ルールに使う属性から選択してください');
  if (consequentItem && !dataset.items.some((item) => item.key === consequentItem))
    throw new Error('結論部の項目が現在の頻出上位80項目にありません。条件を見直してください');
  const sort = ['count', 'lift', 'confidence'].includes(options.ruleSort)
    ? options.ruleSort
    : 'count';
  const counts = new Map(),
    levels = [],
    warnings = [];
  let previous = dataset.items.map((_, i) => ({ indices: [i], tids: [] }));
  dataset.transactions.forEach((transaction, row) =>
    transaction.items.forEach((i) => previous[i].tids.push(row)),
  );
  previous.forEach((set) => counts.set(keyFor(set.indices), set.tids.length));
  levels.push(previous);
  let candidates = 0,
    joins = 0,
    intersections = 0,
    frequent = previous.length,
    completeSize = 1,
    partial = false;
  for (let size = 2; size <= maximum; size++) {
    const next = [],
      previousKeys = new Set(previous.map((set) => keyFor(set.indices)));
    let interrupted = false;
    outer: for (let i = 0; i < previous.length; i++)
      for (let j = i + 1; j < previous.length; j++) {
        const a = previous[i],
          b = previous[j];
        if (a.indices.slice(0, -1).some((v, k) => v !== b.indices[k])) break;
        if (++joins > limits.joins) {
          interrupted = true;
          break outer;
        }
        const indices = [...a.indices, b.indices.at(-1)];
        if (indices.some((_, k) => !previousKeys.has(keyFor(indices.filter((__, p) => p !== k)))))
          continue;
        if (++candidates > limits.candidates) {
          interrupted = true;
          break outer;
        }
        const tids = [];
        let x = 0,
          y = 0;
        while (x < a.tids.length && y < b.tids.length) {
          if (++intersections > limits.intersections) {
            interrupted = true;
            break outer;
          }
          if (a.tids[x] === b.tids[y]) {
            tids.push(a.tids[x]);
            x++;
            y++;
          } else if (a.tids[x] < b.tids[y]) x++;
          else y++;
        }
        if (tids.length >= dataset.minCount) {
          if (frequent + next.length + 1 > limits.frequent) {
            interrupted = true;
            break outer;
          }
          next.push({ indices, tids });
        }
      }
    if (interrupted) {
      partial = true;
      warnings.push(
        `探索上限に達しました。${size}項目以上の探索は未完了です。計算済みの${completeSize}項目以下から表示しています。支持度を上げるか、属性・最大項目数を減らして再分析できます。`,
      );
      break;
    }
    next.sort((a, b) => {
      for (let i = 0; i < a.indices.length; i++)
        if (a.indices[i] !== b.indices[i]) return a.indices[i] - b.indices[i];
      return 0;
    });
    next.forEach((set) => counts.set(keyFor(set.indices), set.tids.length));
    frequent += next.length;
    levels.push(next);
    completeSize = size;
    previous = next;
    if (!next.length) {
      completeSize = maximum;
      break;
    }
  }
  let ruleCandidates = 0,
    totalRules = 0;
  const retained = topRules(limit, compareRules(sort)),
    side = (indices) => indices.map((i) => dataset.items[i]);
  const display = (items) =>
    items.length > 1 ? '（' + items.map((i) => i.label).join(' ＆ ') + '）' : items[0].label;
  rules: for (const level of levels.slice(1))
    for (const set of level) {
      const fullMask = (1 << set.indices.length) - 1;
      for (let mask = 1; mask < fullMask; mask++) {
        if (++ruleCandidates > limits.ruleCandidates) {
          partial = true;
          warnings.push('ルール生成の上限に達しました。表示は生成済みルールの範囲での上位です。');
          break rules;
        }
        const left = [],
          right = [];
        set.indices.forEach((i, k) => (mask & (1 << k) ? left : right).push(i));
        const fromItems = side(left),
          toItems = side(right);
        if (consequentField && !toItems.some((item) => item.field === consequentField)) continue;
        if (consequentItem && !toItems.some((item) => item.key === consequentItem)) continue;
        const fromCount = counts.get(keyFor(left)),
          toCount = counts.get(keyFor(right));
        const conf = set.tids.length / fromCount,
          lift = conf / (toCount / n);
        if (conf + 1e-12 < confidence || (advanced ? lift + 1e-12 < minLift : lift <= 1 + 1e-12))
          continue;
        totalRules++;
        retained.add({
          from: display(fromItems),
          to: display(toItems),
          fromItems: fromItems.map((item) => item.label),
          toItems: toItems.map((item) => item.label),
          fromKeys: fromItems.map((item) => item.key),
          toKeys: toItems.map((item) => item.key),
          count: set.tids.length,
          support: set.tids.length / n,
          confidence: conf,
          lift,
          fromCount,
          toCount,
          tids: set.tids,
        });
      }
    }
  const idLists = new Map();
  const rules = retained.values().map(({ tids, ...rule }) => {
    if (!idLists.has(tids))
      idLists.set(
        tids,
        tids.map((row) => dataset.transactions[row].id),
      );
    return { ...rule, ids: idLists.get(tids) };
  });
  return {
    method: 'rules',
    mode: dataset.mode,
    n,
    classified: dataset.classified,
    minCount: dataset.minCount,
    minLift,
    items: dataset.items.length,
    omittedItems: dataset.omittedItems,
    totalRules,
    sort,
    limit,
    maximum,
    completeSize,
    partial,
    warnings,
    itemsetsBySize: levels.map((level, i) => ({
      size: i + 1,
      count: level.length,
    })),
    candidates,
    joins,
    intersections,
    ruleCandidates,
    rules,
    dataset,
  };
}
export function mineRules(rows, options = {}) {
  return mineRuleDataset(buildRuleDataset(rows, options), options);
}
