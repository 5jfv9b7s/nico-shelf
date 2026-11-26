import { targetRecords, fitTreeFeatures, transformTreeFeatures } from './classification-data.js';
import { binaryMetrics, stratifiedFolds } from './classification-evaluation.js';

export function impurity(positive, n, criterion = 'gini') {
  if (!n || !positive || positive === n) return 0;
  const p = positive / n;
  return criterion === 'entropy' ? -p * Math.log2(p) - (1 - p) * Math.log2(1 - p) : 2 * p * (1 - p);
}
function settings(options) {
  const depth = Number(options.treeDepth),
    leaf = Number(options.treeMinLeaf),
    alpha = Number(options.treeAlpha);
  if (!Number.isInteger(depth) || depth < 1 || depth > 8)
    throw new Error('最大深さは1〜8の整数にしてください');
  if (!Number.isInteger(leaf) || leaf < 1 || leaf > 1000)
    throw new Error('最小葉件数は1〜1000の整数にしてください');
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1)
    throw new Error('枝刈りの強さは0〜1にしてください');
  if (!['gini', 'entropy'].includes(options.treeCriterion))
    throw new Error('分岐基準を選択してください');
  return { depth, leaf, alpha, criterion: options.treeCriterion };
}

/** Binary CART-style greedy splits followed by fixed-alpha cost-complexity pruning. */
export function fitDecisionTree(values, labels, config, budget = { scans: 0, limit: 20000000 }) {
  let serial = 0;
  const n = labels.length,
    width = values[0]?.length || 0;
  function grow(indices, depth) {
    const positive = indices.reduce((sum, i) => sum + labels[i], 0);
    const node = {
      id: serial++,
      n: indices.length,
      positive,
      negative: indices.length - positive,
      depth,
      impurity: impurity(positive, indices.length, config.criterion),
      prediction: positive > indices.length / 2 ? 1 : 0,
      score: positive / indices.length,
    };
    if (depth >= config.depth || indices.length < config.leaf * 2 || !node.impurity) return node;
    let best = null;
    for (let feature = 0; feature < width; feature++) {
      const ordered = [...indices].sort((a, b) => values[a][feature] - values[b][feature] || a - b);
      let leftPositive = 0;
      for (let split = 0; split < ordered.length - 1; split++) {
        if (++budget.scans > budget.limit)
          throw new Error(
            '決定木の計算量上限に達しました。説明変数・深さ・分割数を減らしてください',
          );
        leftPositive += labels[ordered[split]];
        const leftN = split + 1,
          rightN = ordered.length - leftN;
        const low = values[ordered[split]][feature],
          high = values[ordered[split + 1]][feature];
        if (leftN < config.leaf || rightN < config.leaf || low === high) continue;
        const cost =
          (leftN * impurity(leftPositive, leftN, config.criterion) +
            rightN * impurity(positive - leftPositive, rightN, config.criterion)) /
          indices.length;
        if (!best || cost < best.cost - 1e-12) {
          let threshold = low / 2 + high / 2;
          if (threshold >= high) threshold = low;
          best = { cost, feature, threshold, ordered, cut: leftN };
        }
      }
    }
    if (!best || node.impurity - best.cost < -1e-12) return node;
    node.feature = best.feature;
    node.threshold = best.threshold;
    node.left = grow(best.ordered.slice(0, best.cut), depth + 1);
    node.right = grow(best.ordered.slice(best.cut), depth + 1);
    return node;
  }
  const root = grow(
    labels.map((_, i) => i),
    0,
  );
  function prune(node) {
    if (!node.left) return { cost: (node.n / n) * node.impurity + config.alpha, leaves: 1 };
    const left = prune(node.left),
      right = prune(node.right);
    const leafCost = (node.n / n) * node.impurity + config.alpha;
    if (leafCost <= left.cost + right.cost + 1e-12) {
      delete node.left;
      delete node.right;
      delete node.feature;
      delete node.threshold;
      return { cost: leafCost, leaves: 1 };
    }
    return { cost: left.cost + right.cost, leaves: left.leaves + right.leaves };
  }
  prune(root);
  return root;
}

export function predictDecisionTree(root, vector) {
  let node = root;
  while (node.left) node = vector[node.feature] <= node.threshold ? node.left : node.right;
  return { predicted: node.prediction, score: node.score, leaf: node.id };
}

export function decisionTreeAnalysis(rows, options) {
  const config = settings(options),
    target = targetRecords(rows, options),
    records = target.records;
  if (records.length < 10) throw new Error('決定木の分析には分類対象が分かる曲が10曲以上必要です');
  if (records.length > 10000) throw new Error('決定木の上限は1万曲です。対象範囲を絞ってください');
  // Stable order also stabilizes tied split choices and leaf membership lists.
  records.sort((a, b) => String(a.row.id).localeCompare(String(b.row.id)));
  const { folds, k, reduced } = stratifiedFolds(records, options.treeFolds);
  const budget = { scans: 0, limit: 20000000 },
    predictions = [],
    foldResults = [];
  for (let fold = 0; fold < k; fold++) {
    const test = folds[fold],
      train = folds.filter((_, i) => i !== fold).flat();
    const fitted = fitTreeFeatures(train, options),
      training = transformTreeFeatures(train, fitted),
      testing = transformTreeFeatures(test, fitted);
    const labels = train.map((r) => r.target),
      model = fitDecisionTree(training.values, labels, config, budget);
    const baseline = labels.filter(Boolean).length > labels.length / 2 ? 1 : 0;
    const output = test.map((record, i) => ({
      id: record.row.id,
      title: record.row.title || record.row.id,
      actual: record.target,
      ...predictDecisionTree(model, testing.values[i]),
      fold: fold + 1,
      baseline,
    }));
    predictions.push(...output);
    foldResults.push({
      fold: fold + 1,
      trainN: train.length,
      testN: test.length,
      features: fitted.features.length,
      metrics: binaryMetrics(
        output.map((r) => r.actual),
        output.map((r) => r.predicted),
      ),
      imputed: testing.imputed,
    });
  }
  predictions.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const fitted = fitTreeFeatures(records, options),
    data = transformTreeFeatures(records, fitted);
  const tree = fitDecisionTree(
      data.values,
      records.map((r) => r.target),
      config,
      budget,
    ),
    nodes = [];
  function collect(node) {
    node.ids = [];
    nodes.push(node);
    if (node.left) {
      node.label = fitted.features[node.feature].label;
      node.featureKey = fitted.features[node.feature].key;
      node.featureType = fitted.features[node.feature].type;
      node.unit = fitted.features[node.feature].unit || '';
      collect(node.left);
      collect(node.right);
    }
  }
  collect(tree);
  records.forEach((record, i) => {
    let node = tree;
    while (true) {
      node.ids.push(record.row.id);
      if (!node.left) break;
      node = data.values[i][node.feature] <= node.threshold ? node.left : node.right;
    }
  });
  const actual = predictions.map((r) => r.actual),
    warnings = [];
  if (reduced) warnings.push('少数側の件数に合わせ、交差検証を' + k + '分割に減らしました。');
  if (records.length < 100)
    warnings.push('対象が100曲未満です。評価値は分割に左右されやすい目安です。');
  const positive = actual.filter(Boolean).length;
  if (Math.min(positive, records.length - positive) / records.length < 0.1)
    warnings.push(
      '対象・対象外の件数に偏りがあります。正解率だけでなく、バランス正解率・再現率と多数派の基準を確認してください。',
    );
  if (!tree.left)
    warnings.push(
      'この条件では分岐のない木になりました。説明変数、最小葉件数、枝刈りの強さを見直せます。',
    );
  return {
    method: 'tree',
    n: records.length,
    missing: target.missingTarget,
    target: { ...target, records: undefined },
    positive,
    negative: records.length - positive,
    tree,
    nodes,
    features: fitted.features,
    blocked: fitted.blocked,
    dropped: fitted.dropped,
    omittedCategories: fitted.omitted,
    imputed: data.imputed,
    folds: k,
    foldResults,
    predictions,
    metrics: binaryMetrics(
      actual,
      predictions.map((r) => r.predicted),
    ),
    baseline: binaryMetrics(
      actual,
      predictions.map((r) => r.baseline),
    ),
    warnings,
    scans: budget.scans,
    depth: Math.max(...nodes.map((node) => node.depth)),
    leaves: nodes.filter((node) => !node.left).length,
  };
}
