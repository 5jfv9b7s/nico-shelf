export const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
export const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
export const squaredDistance = (a, b) => a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);
export function variance(values) {
  const m = mean(values);
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1);
}
export function ranks(values) {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].v === sorted[i].v) j++;
    for (let t = i; t < j; t++) out[sorted[t].i] = (i + 1 + j) / 2;
    i = j;
  }
  return out;
}
export function correlation(a, b) {
  if (a.length < 3) return null;
  const am = mean(a),
    bm = mean(b);
  let aa = 0,
    bb = 0,
    ab = 0;
  a.forEach((v, i) => {
    aa += (v - am) ** 2;
    bb += (b[i] - bm) ** 2;
    ab += (v - am) * (b[i] - bm);
  });
  if (!(aa > 0 && bb > 0)) return null;
  return Math.max(-1, Math.min(1, ab / Math.sqrt(aa * bb)));
}
export function standardize(values) {
  if (values.length < 3) throw new Error('有効な曲が3曲以上必要です');
  const columns = values[0].map((_, j) => values.map((v) => v[j]));
  const means = columns.map(mean);
  const scales = columns.map((v) => Math.sqrt(variance(v)));
  const kept = scales
    .map((s, j) => (Number.isFinite(s) && s > 1e-12 ? j : -1))
    .filter((j) => j >= 0);
  return {
    values: values.map((row) => kept.map((j) => (row[j] - means[j]) / scales[j])),
    means,
    scales,
    kept,
    dropped: scales.map((_, j) => j).filter((j) => !kept.includes(j)),
  };
}
export function randomGenerator(seed = 517) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
