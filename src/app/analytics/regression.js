import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import jStat from 'jstat';
import { completeData, validateFeatures } from './data.js';
import { mean, variance, standardize, dot } from './numeric.js';

/** Exploratory OLS, with intercept and sample-SD scaling for numerical stability. */
export function fitOLS(values, target) {
  const n = values.length,
    p = values[0]?.length || 0;
  if (!p || n <= p + 1)
    throw new Error('説明変数の数より十分多い有効曲が必要です（最低：説明変数数+2曲）');
  if (!(variance(target) > 1e-20)) throw new Error('目的変数の値が一定のため回帰できません');
  const scaled = standardize(values);
  if (scaled.dropped.length)
    throw new Error('値が一定の説明変数があります。分析項目から外してください');
  const design = new Matrix(scaled.values.map((row) => [1, ...row]));
  const svd = new SingularValueDecomposition(design, { autoTranspose: true });
  const singular = svd.diagonal;
  const condition = singular[0] / singular[singular.length - 1];
  if (!Number.isFinite(condition) || condition > 1e8)
    throw new Error('説明変数が重複、またはほぼ同じ情報です。項目を減らしてください');
  const standardized = svd.solve(Matrix.columnVector(target)).to1DArray();
  const slopes = standardized.slice(1).map((b, j) => b / scaled.scales[j]);
  const intercept = standardized[0] - dot(slopes, scaled.means);
  const fitted = scaled.values.map((row) => standardized[0] + dot(row, standardized.slice(1)));
  const residuals = target.map((value, i) => value - fitted[i]);
  const sse = dot(residuals, residuals),
    ym = mean(target);
  const sst = target.reduce((sum, value) => sum + (value - ym) ** 2, 0);
  const df = n - p - 1,
    mse = sse / df;
  const v = svd.rightSingularVectors;
  const inverseGram = v.mmul(Matrix.diag(singular.map((s) => 1 / s ** 2))).mmul(v.transpose());
  const transform = Matrix.eye(p + 1);
  for (let j = 0; j < p; j++) {
    transform.set(0, j + 1, -scaled.means[j] / scaled.scales[j]);
    transform.set(j + 1, j + 1, 1 / scaled.scales[j]);
  }
  const covariance = transform.mmul(inverseGram).mmul(transform.transpose()).mul(mse);
  const critical95 = jStat.studentt.inv(0.975, df);
  if (!Number.isFinite(critical95)) throw new Error('信頼区間の計算に失敗しました');
  const coefficients = [intercept, ...slopes].map((value, i) => ({
    value,
    se: Math.sqrt(Math.max(0, covariance.get(i, i))),
    beta: i ? (slopes[i - 1] * scaled.scales[i - 1]) / Math.sqrt(variance(target)) : null,
    vif: i ? Math.max(1, inverseGram.get(i, i) * (n - 1)) : null,
    ciLow: value - critical95 * Math.sqrt(Math.max(0, covariance.get(i, i))),
    ciHigh: value + critical95 * Math.sqrt(Math.max(0, covariance.get(i, i))),
  }));
  return {
    n,
    p,
    df,
    critical95,
    coefficients,
    fitted,
    residuals,
    actual: target,
    r2: 1 - sse / sst,
    adjustedR2: 1 - sse / df / (sst / (n - 1)),
    rmse: Math.sqrt(sse / n),
    condition,
    warning:
      coefficients.some((c) => c.vif > 10) || condition > 1000
        ? '説明変数同士の関連が強く、係数が不安定になる可能性があります。項目を減らして比較してください。'
        : '',
  };
}

export function regressionAnalysis(rows, options, multiple = false) {
  validateFeatures([options.y]);
  const predictors = multiple
    ? validateFeatures((options.features || []).filter((key) => key !== options.y))
    : validateFeatures([options.x]);
  if (predictors.includes(options.y))
    throw new Error('目的変数と説明変数は別の項目を選択してください');
  const data = completeData(rows, [...predictors, options.y], options.logCounts);
  const values = data.values.map((row) => row.slice(0, -1));
  const target = data.values.map((row) => row.at(-1));
  const fit = fitOLS(values, target);
  return {
    ...fit,
    method: multiple ? 'multiple' : 'regression',
    keys: predictors,
    target: options.y,
    missing: data.missing,
    points: data.videos.map((video, i) => ({
      ...video,
      x: multiple ? fit.fitted[i] : values[i][0],
      y: target[i],
      fitted: fit.fitted[i],
      residual: fit.residuals[i],
    })),
  };
}
