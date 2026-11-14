import { completeData, validateFeatures } from './data.js';
import { principalComponents } from './pca.js';
import { squaredDistance, randomGenerator } from './numeric.js';

function nearest(row, centers) {
  let best = 0;
  for (let j = 1; j < centers.length; j++)
    if (squaredDistance(row, centers[j]) < squaredDistance(row, centers[best])) best = j;
  return best;
}
export function kmeans(values, k, { starts = 5, maxIterations = 100, seed = 517 } = {}) {
  if (new Set(values.map((v) => JSON.stringify(v))).size < k)
    throw new Error('異なる特徴を持つ曲の数よりグループ数が多いため、グループ数を減らしてください');
  let best;
  for (let run = 0; run < starts; run++) {
    const random = randomGenerator(seed + run * 101);
    let centers = [values[Math.floor(random() * values.length)].slice()];
    while (centers.length < k) {
      const distances = values.map((row) => squaredDistance(row, centers[nearest(row, centers)]));
      let weight = random() * distances.reduce((a, b) => a + b, 0),
        chosen = distances.length - 1;
      for (let i = 0; i < distances.length; i++) {
        weight -= distances[i];
        if (weight < 0) {
          chosen = i;
          break;
        }
      }
      centers.push(values[chosen].slice());
    }
    let labels = [],
      iterations = 0,
      converged = false;
    for (; iterations < maxIterations; iterations++) {
      const previous = labels;
      labels = values.map((row) => nearest(row, centers));
      const sums = Array.from({ length: k }, () => Array(values[0].length).fill(0));
      const counts = Array(k).fill(0);
      values.forEach((row, i) => {
        counts[labels[i]]++;
        row.forEach((v, j) => (sums[labels[i]][j] += v));
      });
      for (let cluster = 0; cluster < k; cluster++) {
        if (counts[cluster]) continue;
        let farthest = -1,
          distance = -1;
        values.forEach((row, i) => {
          const d = squaredDistance(row, centers[labels[i]]);
          if (counts[labels[i]] > 1 && d > distance) {
            farthest = i;
            distance = d;
          }
        });
        if (farthest < 0)
          throw new Error('空のグループを解消できません。グループ数を減らしてください');
        const old = labels[farthest];
        counts[old]--;
        counts[cluster]++;
        values[farthest].forEach((v, j) => {
          sums[old][j] -= v;
          sums[cluster][j] += v;
        });
        labels[farthest] = cluster;
      }
      const next = sums.map((row, i) => row.map((v) => v / counts[i]));
      const shift = centers.reduce((sum, row, i) => sum + squaredDistance(row, next[i]), 0);
      centers = next;
      if (shift < 1e-12 || (previous.length && previous.every((label, i) => label === labels[i]))) {
        converged = true;
        iterations++;
        break;
      }
    }
    const inertia = values.reduce(
      (sum, row, i) => sum + squaredDistance(row, centers[labels[i]]),
      0,
    );
    if (!best || inertia < best.inertia) best = { labels, centers, inertia, iterations, converged };
  }
  return best;
}

/** Exact Euclidean average linkage (UPGMA); UI explicitly limits this to 300 videos. */
export function hierarchical(values, k) {
  const n = values.length,
    capacity = 2 * n - 1;
  const distances = new Float64Array(capacity * capacity);
  const get = (a, b) => distances[a * capacity + b];
  const set = (a, b, v) => {
    distances[a * capacity + b] = v;
    distances[b * capacity + a] = v;
  };
  const nodes = values.map((_, i) => ({ id: i, size: 1, height: 0, members: [i] }));
  const active = new Set(values.map((_, i) => i));
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) set(a, b, Math.sqrt(squaredDistance(values[a], values[b])));
  let cut = n === k ? [...active] : null;
  const linkage = [];
  while (active.size > 1) {
    const ids = [...active];
    let a = ids[0],
      b = ids[1],
      best = get(a, b);
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const d = get(ids[i], ids[j]);
        if (d < best) {
          best = d;
          a = ids[i];
          b = ids[j];
        }
      }
    const left = nodes[a],
      right = nodes[b],
      next = nodes.length;
    const node = {
      id: next,
      left: a,
      right: b,
      size: left.size + right.size,
      height: best,
      members: [...left.members, ...right.members],
    };
    for (const other of active)
      if (other !== a && other !== b)
        set(next, other, (get(a, other) * left.size + get(b, other) * right.size) / node.size);
    nodes.push(node);
    linkage.push([a, b, best, node.size]);
    active.delete(a);
    active.delete(b);
    active.add(next);
    if (active.size === k) cut = [...active];
  }
  const labels = Array(n);
  cut.forEach((id, label) => nodes[id].members.forEach((i) => (labels[i] = label)));
  const compressedTree = (id) =>
    cut.includes(id)
      ? { group: cut.indexOf(id), size: nodes[id].size, height: 0 }
      : {
          height: nodes[id].height,
          left: compressedTree(nodes[id].left),
          right: compressedTree(nodes[id].right),
        };
  return { labels, linkage, tree: compressedTree(nodes.length - 1) };
}

function hashId(id) {
  let hash = 2166136261;
  for (const c of String(id)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
export function clusterAnalysis(rows, options) {
  const keys = validateFeatures(options.features, 2);
  const k = Number(options.k);
  if (!Number.isInteger(k) || k < 2 || k > 8) throw new Error('グループ数は2〜8にしてください');
  const data = completeData(rows, keys, options.logCounts);
  const method = options.clusterMethod === 'hierarchical' ? 'hierarchical' : 'kmeans';
  const used = data.videos.map((video, i) => ({ video, i }));
  const indices =
    method === 'hierarchical' && used.length > 300
      ? used
          .sort(
            (a, b) =>
              hashId(a.video.id) - hashId(b.video.id) || a.video.id.localeCompare(b.video.id),
          )
          .slice(0, 300)
          .map((v) => v.i)
      : used.map((v) => v.i);
  if (indices.length < Math.max(3, k))
    throw new Error('有効な曲数以上のグループには分けられません');
  const pca = principalComponents(indices.map((i) => data.values[i]));
  const result = method === 'hierarchical' ? hierarchical(pca.values, k) : kmeans(pca.values, k);
  const groups = Array.from({ length: k }, (_, group) => {
    const members = result.labels
      .map((label, i) => (label === group ? i : -1))
      .filter((i) => i >= 0);
    return {
      group,
      count: members.length,
      ids: members.map((i) => data.videos[indices[i]].id),
      profile: pca.kept.map((j, c) => ({
        key: keys[j],
        z: members.reduce((sum, i) => sum + pca.values[i][c], 0) / members.length,
      })),
    };
  });
  return {
    method: 'clusters',
    clusterMethod: method,
    n: indices.length,
    complete: data.n,
    missing: data.missing,
    sampled: data.n - indices.length,
    keys: pca.kept.map((j) => keys[j]),
    dropped: pca.dropped.map((j) => keys[j]),
    groups,
    explained: pca.explained,
    inertia: result.inertia,
    iterations: result.iterations,
    converged: result.converged,
    tree: result.tree,
    linkage: result.linkage,
    points: indices.map((index, i) => ({
      ...data.videos[index],
      x: pca.scores[i][0],
      y: pca.scores[i][1],
      group: result.labels[i],
    })),
  };
}
