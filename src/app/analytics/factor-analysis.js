import { Matrix, EigenvalueDecomposition, SingularValueDecomposition } from 'ml-matrix';
import { completeData, validateFeatures } from './data.js';
import { minimumFactorVariables } from './factor-settings.js';
export { minimumFactorVariables } from './factor-settings.js';

const SMALL = 1e-12;
const sumSquares = (values) => values.reduce((sum, value) => sum + value * value, 0);
const identity = (n) =>
  Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
const multiply = (a, b) =>
  a.map((row) => b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)));
const transpose = (a) => a[0].map((_, j) => a.map((row) => row[j]));

function eigen(matrix) {
  const evd = new EigenvalueDecomposition(new Matrix(matrix), { assumeSymmetric: true });
  const order = evd.realEigenvalues
    .map((value, i) => ({ value, i }))
    .sort((a, b) => b.value - a.value);
  return {
    values: order.map((v) => v.value),
    vectors: matrix.map((_, j) => order.map((v) => evd.eigenvectorMatrix.get(j, v.i))),
  };
}

/** Population standardization. Scaling before subtraction avoids overflowing raw squares. */
export function factorStandardize(values) {
  const n = values.length,
    p = values[0]?.length || 0;
  if (n < 20 || n > 10000) throw new Error('因子分析は全項目がそろう20〜10000曲で分析してください');
  if (
    !p ||
    p > 11 ||
    values.some((row) => row.length !== p || row.some((value) => !Number.isFinite(value)))
  )
    throw new Error('因子分析の数値が不正です');
  const parameters = Array.from({ length: p }, (_, j) => {
    const anchor = values.reduce((max, row) => Math.max(max, Math.abs(row[j])), 0) || 1;
    const center = values.reduce((sum, row) => sum + row[j] / anchor, 0) / n;
    const spread = Math.sqrt(
      values.reduce((sum, row) => sum + (row[j] / anchor - center) ** 2, 0) / n,
    );
    return { anchor, center, spread, mean: center * anchor, scale: spread * anchor };
  });
  const kept = parameters.map((v, j) => (v.spread > SMALL ? j : -1)).filter((j) => j >= 0);
  return {
    parameters,
    kept,
    dropped: parameters.map((_, j) => j).filter((j) => !kept.includes(j)),
    values: values.map((row) =>
      kept.map(
        (j) => (row[j] / parameters[j].anchor - parameters[j].center) / parameters[j].spread,
      ),
    ),
  };
}

/** Orthogonal Varimax, without Kaiser row normalization. Rotation does not change LL'. */
export function varimax(loadings, { maxIterations = 100, tolerance = 1e-6 } = {}) {
  const p = loadings.length,
    count = loadings[0].length;
  if (count === 1 || loadings.every((row) => sumSquares(row) < SMALL))
    return { loadings, matrix: identity(count), converged: true, iterations: 0 };
  let rotation = identity(count),
    previous = 0,
    converged = false,
    iterations = 0;
  const source = transpose(loadings);
  for (let i = 0; i < maxIterations; i++) {
    const rotated = multiply(loadings, rotation),
      ss = transpose(rotated).map(sumSquares);
    const gradient = multiply(
      source,
      rotated.map((row) => row.map((v, j) => v ** 3 - (v * ss[j]) / p)),
    );
    const svd = new SingularValueDecomposition(new Matrix(gradient));
    rotation = svd.leftSingularVectors.mmul(svd.rightSingularVectors.transpose()).to2DArray();
    const objective = svd.diagonal.reduce((sum, v) => sum + v, 0);
    iterations = i + 1;
    if (previous && objective < previous * (1 + tolerance)) {
      converged = true;
      break;
    }
    if (objective < SMALL) {
      converged = true;
      break;
    }
    previous = objective;
  }
  return { loadings: multiply(loadings, rotation), matrix: rotation, converged, iterations };
}
function canonicalFactors(loadings, rotation) {
  const ss = transpose(loadings).map(sumSquares);
  const order = ss
    .map((value, i) => ({ value, i }))
    .sort((a, b) => b.value - a.value || a.i - b.i)
    .map((v) => v.i);
  const signs = order.map((j) => {
    const pivot = loadings.reduce(
      (best, row, i) => (Math.abs(row[j]) > Math.abs(loadings[best][j]) ? i : best),
      0,
    );
    return loadings[pivot][j] < 0 ? -1 : 1;
  });
  return {
    loadings: loadings.map((row) => order.map((j, i) => row[j] * signs[i])),
    rotation: rotation.map((row) => order.map((j, i) => row[j] * signs[i])),
    sums: order.map((j) => ss[j]),
  };
}

/** Gaussian common-factor ML: R = L L' + diag(psi), latent covariance I.
 * Small eigendecompositions of the whitened correlation replace an n-by-p SVD.
 * Each update uses p<=11; individual scores are computed once after fitting.
 */
export function fitFactorAnalysis(
  values,
  { count = 1, rotation = 'varimax', maxIterations = 500, tolerance = 1e-6 } = {},
) {
  if (!Number.isInteger(count) || count < 1 || count > 5)
    throw new Error('因子数は1〜5の整数にしてください');
  if (!['none', 'varimax'].includes(rotation)) throw new Error('回転方法を選択してください');
  if (
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 1000 ||
    !Number.isFinite(tolerance) ||
    !(tolerance > 0)
  )
    throw new Error('因子分析の反復設定が不正です');
  const scaled = factorStandardize(values),
    z = scaled.values,
    n = z.length,
    p = scaled.kept.length;
  const minimum = minimumFactorVariables(count);
  if (p < minimum)
    throw new Error(
      count +
        '因子には、値に変化がある数値項目を' +
        minimum +
        '個以上選んでください（現在' +
        p +
        '個）',
    );
  const correlation = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (__, j) => z.reduce((sum, row) => sum + row[i] * row[j], 0) / n),
  );
  const spectrum = eigen(correlation),
    condition = spectrum.values[0] / spectrum.values.at(-1);
  if (spectrum.values.at(-1) <= 1e-8 || !Number.isFinite(condition) || condition > 1e8)
    throw new Error(
      '数値項目がほぼ重複し、相関行列が不安定です。元の件数とその比率など、似た項目を減らしてください',
    );
  let noise = Array(p).fill(1),
    loadings,
    oldLikelihood = -Infinity,
    converged = false,
    iterations = 0;
  const logLikelihood = [];
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const roots = noise.map((v) => Math.sqrt(v));
    const whitened = correlation.map((row, i) => row.map((v, j) => v / roots[i] / roots[j]));
    const decomposition = eigen(whitened);
    loadings = decomposition.vectors.map((row, j) =>
      row
        .slice(0, count)
        .map((v, k) => roots[j] * v * Math.sqrt(Math.max(decomposition.values[k] - 1, 0))),
    );
    const logDet =
      noise.reduce((sum, v) => sum + Math.log(v), 0) +
      decomposition.values.slice(0, count).reduce((sum, v) => sum + Math.log(Math.max(v, 1)), 0);
    const trace = decomposition.values.reduce(
      (sum, v, j) => sum + (j < count ? Math.min(v, 1) : v),
      0,
    );
    const likelihood = -0.5 * (p * Math.log(2 * Math.PI) + logDet + trace);
    if (!Number.isFinite(likelihood))
      throw new Error('因子分析の数値が不安定です。因子数や項目を減らしてください');
    const improvement = likelihood - oldLikelihood;
    if (improvement < -1e-8)
      throw new Error('因子分析の尤度が低下しました。数値項目や因子数を見直してください');
    logLikelihood.push(likelihood);
    iterations = iteration + 1;
    if (iteration && improvement < tolerance) {
      converged = true;
      break;
    }
    oldLikelihood = likelihood;
    if (iteration + 1 < maxIterations)
      noise = loadings.map((row, j) => Math.max(correlation[j][j] - sumSquares(row), SMALL));
  }
  const unrotated = loadings;
  const rotated =
    rotation === 'varimax'
      ? varimax(loadings)
      : { loadings, matrix: identity(count), converged: true, iterations: 0 };
  const canonical = canonicalFactors(rotated.loadings, rotated.matrix);
  loadings = canonical.loadings;
  const reproduced = loadings.map((row, i) =>
    loadings.map(
      (other, j) => row.reduce((sum, v, k) => sum + v * other[k], 0) + (i === j ? noise[i] : 0),
    ),
  );
  const residuals = correlation.map((row, i) => row.map((v, j) => v - reproduced[i][j]));
  const reproducedEvd = eigen(reproduced);
  if (reproducedEvd.values.at(-1) <= 0)
    throw new Error('推定した共分散が不安定です。因子数・項目を減らしてください');
  // E[f|z] under the fitted Gaussian model: score weights = Sigma^-1 L.
  const projected = multiply(transpose(reproducedEvd.vectors), loadings);
  const scoreWeights = multiply(
    reproducedEvd.vectors,
    projected.map((row, i) => row.map((v) => v / reproducedEvd.values[i])),
  );
  const scores = multiply(z, scoreWeights);
  if (scores.some((row) => row.some((v) => !Number.isFinite(v))))
    throw new Error('因子得点の数値が不安定です');
  let squared = 0,
    pairs = 0;
  for (let i = 0; i < p; i++)
    for (let j = i + 1; j < p; j++) {
      squared += residuals[i][j] ** 2;
      pairs++;
    }
  const communalities = loadings.map(sumSquares),
    degrees = ((p - count) ** 2 - p - count) / 2;
  const warnings = [];
  if (n < 100 || n < 5 * p)
    warnings.push(
      '曲数が少ないため負荷量が不安定になり得ます。項目や対象範囲を変えたときも確認してください。',
    );
  if (!converged)
    warnings.push(
      '最尤法が未収束です。負荷量・独自分散・得点は途中の値です。反復回数や因子数・項目を見直してください。',
    );
  if (!rotated.converged) warnings.push('Varimax回転が未収束です。表示する向きは途中の値です。');
  if (noise.some((v) => v < 0.005))
    warnings.push(
      '独自分散がほぼ0の項目があります（境界解に近い状態）。負荷量・得点の解釈は不安定です。因子数や似た項目を減らすことも検討してください。',
    );
  if (communalities.some((v) => v > 1 + 1e-6))
    warnings.push(
      '共通性が1を超えた項目があります。未収束やモデルの不適合を確認し、因子数・項目を見直してください。',
    );
  if (condition > 1000)
    warnings.push('相関行列の条件数が大きく、似た項目の影響で結果が不安定になり得ます。');
  if (degrees === 0)
    warnings.push('モデルの自由度が0です。再現誤差の小ささだけで因子数が適切とは判断できません。');
  if (canonical.sums.some((v) => v < 1e-8))
    warnings.push(
      '負荷量がほぼ0の因子があります。指定した数の因子を有効に抽出できていません。因子数を減らしてください。',
    );
  return {
    ...scaled,
    correlation,
    eigenvalues: spectrum.values,
    condition,
    loadings,
    unrotated,
    rotationMatrix: canonical.rotation,
    noise,
    communalities,
    sums: canonical.sums,
    shares: canonical.sums.map((v) => v / p),
    reproduced,
    residuals,
    rmsr: Math.sqrt(squared / pairs),
    scoreWeights,
    scores,
    converged,
    iterations,
    rotationConverged: rotated.converged,
    rotationIterations: rotated.iterations,
    logLikelihood,
    df: degrees,
    warnings,
  };
}

export function factorAnalysis(rows, options) {
  const keys = validateFeatures(options.features, 3),
    data = completeData(rows, keys, options.logCounts);
  const fitted = fitFactorAnalysis(data.values, {
    count: Number(options.factorCount),
    rotation: options.factorRotation,
    maxIterations: Number(options.factorIterations),
  });
  return {
    method: 'factor',
    n: data.n,
    missing: data.missing,
    count: Number(options.factorCount),
    keys: fitted.kept.map((j) => keys[j]),
    dropped: fitted.dropped.map((j) => keys[j]),
    ...Object.fromEntries(
      [
        'correlation',
        'eigenvalues',
        'condition',
        'loadings',
        'unrotated',
        'rotationMatrix',
        'noise',
        'communalities',
        'sums',
        'shares',
        'reproduced',
        'residuals',
        'rmsr',
        'scoreWeights',
        'converged',
        'iterations',
        'rotationConverged',
        'rotationIterations',
        'logLikelihood',
        'df',
        'warnings',
      ].map((key) => [key, fitted[key]]),
    ),
    means: fitted.kept.map((j) => fitted.parameters[j].mean),
    scales: fitted.kept.map((j) => fitted.parameters[j].scale),
    points: data.videos.map((v, i) => ({
      ...v,
      scores: fitted.scores[i],
      x: fitted.scores[i][0],
      y: fitted.scores[i][1] ?? 0,
    })),
  };
}
