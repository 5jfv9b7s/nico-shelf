import { Matrix, SingularValueDecomposition } from 'ml-matrix';
import { completeData, validateFeatures } from './data.js';
import { standardize, dot } from './numeric.js';

/** PCA of sample-standardized columns; eigenvectors and correlation loadings differ. */
export function principalComponents(values) {
  const scaled = standardize(values);
  if (scaled.kept.length < 2) throw new Error('値に変化がある項目を2個以上選択してください');
  const svd = new SingularValueDecomposition(new Matrix(scaled.values), { autoTranspose: true });
  const eigenvalues = svd.diagonal.map((s) => s ** 2 / (values.length - 1));
  const total = eigenvalues.reduce((a, b) => a + b, 0);
  const v = svd.rightSingularVectors;
  const vectors = eigenvalues.map((_, axis) => {
    const vector = scaled.kept.map((__, j) => v.get(j, axis));
    const pivot = vector.reduce(
      (best, value, j) => (Math.abs(value) > Math.abs(vector[best]) ? j : best),
      0,
    );
    return vector.map((value) => value * (vector[pivot] < 0 ? -1 : 1));
  });
  return {
    ...scaled,
    eigenvalues,
    explained: eigenvalues.map((value) => value / total),
    vectors,
    scores: scaled.values.map((row) =>
      vectors.map((vector, axis) => (eigenvalues[axis] / total < 1e-12 ? 0 : dot(row, vector))),
    ),
    loadings: scaled.kept.map((_, j) =>
      vectors.map((vector, axis) => vector[j] * Math.sqrt(eigenvalues[axis])),
    ),
  };
}

export function pcaAnalysis(rows, options) {
  const keys = validateFeatures(options.features, 2);
  const data = completeData(rows, keys, options.logCounts);
  const pca = principalComponents(data.values);
  return {
    method: 'pca',
    n: data.n,
    missing: data.missing,
    keys: pca.kept.map((j) => keys[j]),
    dropped: pca.dropped.map((j) => keys[j]),
    explained: pca.explained,
    eigenvalues: pca.eigenvalues,
    vectors: pca.vectors,
    loadings: pca.loadings,
    points: data.videos.map((video, i) => ({ ...video, x: pca.scores[i][0], y: pca.scores[i][1] })),
  };
}
