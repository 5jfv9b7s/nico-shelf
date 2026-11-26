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
