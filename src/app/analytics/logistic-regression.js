import { targetRecords, fitTreeFeatures, transformTreeFeatures } from './classification-data.js';
import { binaryMetrics, stratifiedFolds, probabilityMetrics } from './classification-evaluation.js';
import { COUNT_METRICS, metricLabel } from './data.js';

export const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const softplus = (z) => Math.max(z, 0) + Math.log1p(Math.exp(-Math.abs(z)));
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = (vector) => vector.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0);

/** Mean binary log loss + lambda/2 * ||w||^2; the intercept is unpenalized. */
export function fitLogistic(
  values,
  labels,
  { lambda = 0.01, maxIterations = 300, tolerance = 1e-7 } = {},
  budget = { work: 0, limit: 120000000 },
) {
  const n = labels.length,
    width = values[0]?.length || 0;
  if (
    !n ||
    values.length !== n ||
    labels.some((y) => ![0, 1].includes(y)) ||
    values.some((row) => row.length !== width || row.some((v) => !Number.isFinite(v)))
  )
    throw new Error('学習用の数値・分類が不正です');
  if (!Number.isFinite(lambda) || lambda < 0.0001 || lambda > 100)
    throw new Error('正則化の強さは0.0001〜100にしてください');
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000)
    throw new Error('最大反復回数は1〜1000の整数にしてください');
  const positives = labels.filter(Boolean).length;
  if (!positives || positives === n) throw new Error('学習用に対象・対象外の両方が必要です');
  function evaluate(weights) {
    budget.work += n * (width + 1);
    if (budget.work > budget.limit)
      throw new Error(
        'ロジスティック回帰の計算量上限に達しました。曲数・説明変数・分割数を減らしてください',
      );
    const gradient = Array(width + 1).fill(0);
    let loss = 0;
    for (let i = 0; i < n; i++) {
      let z = weights[0];
      for (let j = 0; j < width; j++) z += weights[j + 1] * values[i][j];
      if (!Number.isFinite(z))
        throw new Error('計算が数値範囲を超えました。対数変換や説明変数を見直してください');
      loss += softplus(labels[i] ? -z : z);
      const residual = sigmoid(z) - labels[i];
      gradient[0] += residual;
      for (let j = 0; j < width; j++) gradient[j + 1] += residual * values[i][j];
    }
    loss /= n;
    for (let j = 0; j < gradient.length; j++) {
      gradient[j] /= n;
      if (j) {
        loss += (lambda * weights[j] ** 2) / 2;
        gradient[j] += lambda * weights[j];
      }
    }
    return { loss, gradient };
  }
  let weights = [Math.log(positives / (n - positives)), ...Array(width).fill(0)],
    current = evaluate(weights),
    iterations = 0;
  const history = [];
  for (; iterations < maxIterations && norm(current.gradient) > tolerance; iterations++) {
    const q = [...current.gradient],
      alphas = [];
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i],
        a = h.rho * dot(h.s, q);
      alphas[i] = a;
      for (let j = 0; j < q.length; j++) q[j] -= a * h.y[j];
    }
    const last = history.at(-1),
      gamma = last ? Math.max(1e-6, Math.min(1e6, dot(last.s, last.y) / dot(last.y, last.y))) : 1;
    const direction = q.map((value) => value * gamma);
    for (let i = 0; i < history.length; i++) {
      const h = history[i],
        beta = h.rho * dot(h.y, direction);
      for (let j = 0; j < direction.length; j++) direction[j] += h.s[j] * (alphas[i] - beta);
    }
    for (let j = 0; j < direction.length; j++) direction[j] = -direction[j];
    let slope = dot(current.gradient, direction);
    if (!Number.isFinite(slope) || slope >= 0) {
      history.length = 0;
      direction.splice(0, direction.length, ...current.gradient.map((g) => -g));
      slope = -dot(current.gradient, current.gradient);
    }
    let step = 1,
      accepted = null,
      candidate;
    for (let search = 0; search < 30; search++, step /= 2) {
      candidate = weights.map((value, j) => value + step * direction[j]);
      const next = evaluate(candidate);
      if (next.loss <= current.loss + 1e-4 * step * slope) {
        accepted = next;
        break;
      }
    }
    if (!accepted) break;
    const s = candidate.map((value, j) => value - weights[j]),
      y = accepted.gradient.map((value, j) => value - current.gradient[j]),
      sy = dot(s, y);
    if (sy > 1e-14) {
      history.push({ s, y, rho: 1 / sy });
      if (history.length > 10) history.shift();
    }
    weights = candidate;
    current = accepted;
  }
  return {
    intercept: weights[0],
    weights: weights.slice(1),
    loss: current.loss,
    iterations,
    converged: norm(current.gradient) <= tolerance,
    gradientNorm: norm(current.gradient),
  };
}

function analysisValue(value, feature, logCounts) {
  return logCounts && feature.type === 'numeric' && COUNT_METRICS.has(feature.key)
    ? Math.log1p(value)
    : value;
}
export function fitLogisticScaling(values, features, logCounts = true) {
  return features.map((feature, j) => {
    const column = values.map((row) => analysisValue(row[j], feature, logCounts));
    const anchor = column.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0) || 1;
    const center = column.reduce((sum, value) => sum + value / anchor, 0) / values.length;
    const spread = Math.sqrt(
      column.reduce((sum, value) => sum + (value / anchor - center) ** 2, 0) / values.length,
    );
    return {
      anchor,
      center,
      spread: spread || 1,
      mean: center * anchor,
      scale: spread * anchor || 1,
      constant: !spread,
      label: feature.type === 'numeric' ? metricLabel(feature.key, logCounts) : feature.label,
    };
  });
}
export function scaleLogisticValues(values, features, scaling, logCounts = true) {
  return values.map((row) =>
    row.map((value, j) => {
      const parameter = scaling[j],
        scaled =
          (analysisValue(value, features[j], logCounts) / parameter.anchor - parameter.center) /
          parameter.spread;
      if (!Number.isFinite(scaled))
        throw new Error('説明変数が数値範囲を超えています。対数変換や対象範囲を見直してください');
      return scaled;
    }),
  );
}
export function logisticProbability(model, vector) {
  const z = model.intercept + dot(model.weights, vector);
  if (!Number.isFinite(z))
    throw new Error('予測値が数値範囲を超えています。対数変換や説明変数を見直してください');
  return sigmoid(z);
}

export function logisticAnalysis(rows, options) {
  const lambda = Number(options.logisticLambda),
    maxIterations = Number(options.logisticIterations),
    cutoff = Number(options.logisticCutoff);
  if (!Number.isFinite(cutoff) || cutoff <= 0 || cutoff >= 1)
    throw new Error('分類の閾値は0より大きく1未満にしてください');
  const target = targetRecords(rows, options),
    records = target.records;
  if (records.length < 10 || records.length > 10000)
    throw new Error('ロジスティック回帰は分類対象が分かる10〜10000曲で分析してください');
  records.sort((a, b) => String(a.row.id).localeCompare(String(b.row.id)));
  const { folds, k, reduced } = stratifiedFolds(records, options.treeFolds),
    budget = { work: 0, limit: 120000000 };
  function train(training, testing) {
    const fitted = fitTreeFeatures(training, options),
      rawTrain = transformTreeFeatures(training, fitted),
      rawTest = transformTreeFeatures(testing, fitted);
    const scaling = fitLogisticScaling(rawTrain.values, fitted.features, options.logCounts);
    const trainValues = scaleLogisticValues(
      rawTrain.values,
      fitted.features,
      scaling,
      options.logCounts,
    );
    const model = fitLogistic(
      trainValues,
      training.map((r) => r.target),
      { lambda, maxIterations },
      budget,
    );
    const testValues = scaleLogisticValues(
      rawTest.values,
      fitted.features,
      scaling,
      options.logCounts,
    );
    return {
      fitted,
      scaling,
      model,
      imputed: rawTrain.imputed,
      scores: testValues.map((vector) => logisticProbability(model, vector)),
    };
  }
  const predictions = [],
    foldResults = [];
  for (let fold = 0; fold < k; fold++) {
    const testing = folds[fold],
      training = folds.filter((_, i) => i !== fold).flat(),
      trained = train(training, testing);
    const baselineScore = training.filter((r) => r.target).length / training.length;
    const baseline = baselineScore > 0.5 ? 1 : 0;
    const output = testing.map((record, i) => ({
      id: record.row.id,
      title: record.row.title || record.row.id,
      actual: record.target,
      score: trained.scores[i],
      predicted: trained.scores[i] >= cutoff ? 1 : 0,
      baseline,
      baselineScore,
      fold: fold + 1,
    }));
    predictions.push(...output);
    foldResults.push({
      fold: fold + 1,
      trainN: training.length,
      testN: testing.length,
      features: trained.fitted.features.length,
      iterations: trained.model.iterations,
      converged: trained.model.converged,
      metrics: binaryMetrics(
        output.map((p) => p.actual),
        output.map((p) => p.predicted),
      ),
      probability: probabilityMetrics(
        output.map((p) => p.actual),
        output.map((p) => p.score),
      ),
    });
  }
  predictions.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const full = train(records, []),
    actual = predictions.map((p) => p.actual),
    positive = actual.filter(Boolean).length;
  const coefficients = full.fitted.features.map((feature, i) => {
    const comparison =
      feature.type === 'category'
        ? full.model.weights[i] / full.scaling[i].scale
        : full.model.weights[i];
    return {
      ...feature,
      label: full.scaling[i].label,
      coefficient: full.model.weights[i],
      comparison,
      oddsRatio: Math.abs(comparison) <= 700 ? Math.exp(comparison) : null,
      mean: full.scaling[i].mean,
      scale: full.scaling[i].scale,
    };
  });
  const warnings = [];
  if (reduced) warnings.push('少数側の件数に合わせ、交差検証を' + k + '分割に減らしました。');
  if (records.length < 100)
    warnings.push('対象が100曲未満です。評価値は分割に左右されやすい目安です。');
  if (Math.min(positive, records.length - positive) / records.length < 0.1)
    warnings.push(
      '対象・対象外の件数に偏りがあります。多数派の基準、バランス正解率・再現率も確認してください。',
    );
  if (!full.model.converged)
    warnings.push(
      '全曲の説明用モデルが未収束です。係数は途中の値です。正則化の強さ・反復回数・項目を見直してください。',
    );
  const unfinished = foldResults.filter((f) => !f.converged).length;
  if (unfinished)
    warnings.push(
      '交差検証の' + unfinished + '分割が未収束です。評価も途中のモデルに基づく参考値です。',
    );
  if (!coefficients.length)
    warnings.push('有効な説明項目がなく、学習用の対象割合だけを使うモデルになりました。');
  return {
    method: 'logistic',
    n: records.length,
    missing: target.missingTarget,
    target: { ...target, records: undefined },
    positive,
    negative: records.length - positive,
    coefficients,
    intercept: full.model.intercept,
    iterations: full.model.iterations,
    converged: full.model.converged,
    gradientNorm: full.model.gradientNorm,
    blocked: full.fitted.blocked,
    dropped: full.fitted.dropped,
    omittedCategories: full.fitted.omitted,
    imputed: full.imputed,
    folds: k,
    foldResults,
    predictions,
    metrics: binaryMetrics(
      actual,
      predictions.map((p) => p.predicted),
    ),
    baseline: binaryMetrics(
      actual,
      predictions.map((p) => p.baseline),
    ),
    probability: probabilityMetrics(
      actual,
      predictions.map((p) => p.score),
    ),
    baselineProbability: probabilityMetrics(
      actual,
      predictions.map((p) => p.baselineScore),
    ),
    groups: [
      { label: '予測：対象', ids: predictions.filter((p) => p.predicted).map((p) => p.id) },
      { label: '予測：対象外', ids: predictions.filter((p) => !p.predicted).map((p) => p.id) },
      {
        label: '誤分類',
        ids: predictions.filter((p) => p.predicted !== p.actual).map((p) => p.id),
      },
    ],
    warnings,
    work: budget.work,
  };
}
