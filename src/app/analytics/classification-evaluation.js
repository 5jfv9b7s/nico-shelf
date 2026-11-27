const ratio = (a, b) => (b ? a / b : null);

/** Binary metrics shared by classifiers. Undefined denominators remain null. */
export function binaryMetrics(actual, predicted) {
  if (actual.length !== predicted.length) throw new Error('評価用の件数が一致しません');
  let tp = 0,
    tn = 0,
    fp = 0,
    fn = 0;
  actual.forEach((label, i) => {
    if (![0, 1].includes(label) || ![0, 1].includes(predicted[i]))
      throw new Error('分類ラベルが不正です');
    if (label) predicted[i] ? tp++ : fn++;
    else predicted[i] ? fp++ : tn++;
  });
  const recall = ratio(tp, tp + fn),
    specificity = ratio(tn, tn + fp);
  return {
    n: actual.length,
    tp,
    tn,
    fp,
    fn,
    accuracy: ratio(tp + tn, actual.length),
    precision: ratio(tp, tp + fp),
    recall,
    specificity,
    f1: ratio(2 * tp, 2 * tp + fp + fn),
    balancedAccuracy: recall === null || specificity === null ? null : (recall + specificity) / 2,
  };
}

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** Stable ID ordering within each class; each video is held out exactly once. */
export function stratifiedFolds(records, requested = 5) {
  if (![3, 5].includes(Number(requested)))
    throw new Error('交差検証は3分割か5分割を選択してください');
  const classes = [records.filter((r) => r.target === 0), records.filter((r) => r.target === 1)];
  const k = Math.min(Number(requested), ...classes.map((group) => group.length));
  if (k < 2)
    throw new Error('対象・対象外の曲がそれぞれ2曲以上必要です。分析対象の範囲を広げてください');
  const folds = Array.from({ length: k }, () => []);
  for (const group of classes) {
    group.sort(
      (a, b) =>
        hash('nico-tree-1:' + a.row.id) - hash('nico-tree-1:' + b.row.id) ||
        String(a.row.id).localeCompare(String(b.row.id)),
    );
    group.forEach((record, i) => folds[i % k].push(record));
  }
  return { folds, k, reduced: k !== Number(requested) };
}

/** Scores come from held-out predictions; no calibration is fitted here. */
export function probabilityMetrics(actual, scores) {
  if (
    actual.length !== scores.length ||
    actual.some((y) => ![0, 1].includes(y)) ||
    scores.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
  )
    throw new Error('確率評価の入力が不正です');
  const n = actual.length,
    positives = actual.filter(Boolean).length;
  const bins = Array.from({ length: 10 }, (_, i) => ({
    low: i / 10,
    high: (i + 1) / 10,
    n: 0,
    sum: 0,
    positive: 0,
  }));
  let loss = 0,
    squared = 0;
  scores.forEach((p, i) => {
    const clipped = Math.max(1e-15, Math.min(1 - 1e-15, p));
    loss -= actual[i] ? Math.log(clipped) : Math.log1p(-clipped);
    squared += (p - actual[i]) ** 2;
    const bin = bins[Math.min(9, Math.floor(p * 10))];
    bin.n++;
    bin.sum += p;
    bin.positive += actual[i];
  });
  const ordered = scores.map((p, i) => ({ p, y: actual[i] })).sort((a, b) => a.p - b.p);
  let ranks = 0;
  for (let i = 0; i < ordered.length;) {
    let j = i + 1;
    while (j < ordered.length && ordered[j].p === ordered[i].p) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (ordered[k].y) ranks += rank;
    i = j;
  }
  return {
    logLoss: n ? loss / n : null,
    brier: n ? squared / n : null,
    auc:
      positives && positives < n
        ? (ranks - (positives * (positives + 1)) / 2) / (positives * (n - positives))
        : null,
    bins: bins
      .filter((bin) => bin.n)
      .map((bin) => ({
        low: bin.low,
        high: bin.high,
        n: bin.n,
        mean: bin.sum / bin.n,
        actual: bin.positive / bin.n,
      })),
  };
}
