import { squaredDistance } from './numeric.js';

/** Mean silhouette of evaluation points, distances always to the full fitted set. */
export function silhouetteScore(values, labels, evaluation = values.map((_, i) => i)) {
  const groups = [...new Set(labels)];
  if (groups.length < 2 || groups.length >= values.length || !evaluation.length) return null;
  const index = new Map(groups.map((group, i) => [group, i]));
  const counts = groups.map((group) => labels.filter((label) => label === group).length);
  let total = 0;
  for (const i of evaluation) {
    const own = index.get(labels[i]);
    // A singleton contributes 0, matching the standard silhouette definition.
    if (counts[own] === 1) continue;
    const sums = Array(groups.length).fill(0);
    values.forEach((row, j) => {
      if (i !== j) sums[index.get(labels[j])] += Math.sqrt(squaredDistance(values[i], row));
    });
    const a = sums[own] / (counts[own] - 1);
    const b = Math.min(...sums.map((sum, g) => (g === own ? Infinity : sum / counts[g])));
    total += Math.max(a, b) ? (b - a) / Math.max(a, b) : 0;
  }
  return total / evaluation.length;
}

export function partitionInertia(values, labels) {
  const groups = new Map();
  values.forEach((row, i) => {
    if (!groups.has(labels[i])) groups.set(labels[i], { sum: Array(row.length).fill(0), n: 0 });
    const group = groups.get(labels[i]);
    row.forEach((v, j) => (group.sum[j] += v));
    group.n++;
  });
  return values.reduce((sum, row, i) => {
    const group = groups.get(labels[i]);
    return (
      sum +
      squaredDistance(
        row,
        group.sum.map((v) => v / group.n),
      )
    );
  }, 0);
}

export function fixedHash(id) {
  let hash = 2166136261;
  for (const c of String(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/** Same videos/features for every k; only silhouette evaluation is capped. */
export function compareClusterCounts(values, videos, selectedK, selectedResult, fit) {
  const evaluation = videos
    .map((video, i) => ({ video, i }))
    .sort(
      (a, b) =>
        fixedHash(a.video.id) - fixedHash(b.video.id) || a.video.id.localeCompare(b.video.id),
    )
    .slice(0, 300)
    .map((v) => v.i);
  const maximum = Math.min(
    8,
    values.length - 1,
    new Set(values.map((row) => JSON.stringify(row))).size,
  );
  const comparison = [];
  for (let k = 2; k <= maximum; k++) {
    const model = k === selectedK ? selectedResult : fit(values, k);
    const sizes = Array.from(
      { length: k },
      (_, group) => model.labels.filter((label) => label === group).length,
    );
    comparison.push({
      k,
      inertia: model.inertia ?? partitionInertia(values, model.labels),
      silhouette: silhouetteScore(values, model.labels, evaluation),
      minSize: Math.min(...sizes),
      maxSize: Math.max(...sizes),
      converged: model.converged ?? null,
    });
  }
  return {
    comparison,
    silhouetteN: evaluation.length,
    silhouette:
      comparison.find((row) => row.k === selectedK)?.silhouette ??
      silhouetteScore(values, selectedResult.labels, evaluation),
  };
}
