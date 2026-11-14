import { valueFor, validateFeatures } from './data.js';
import { correlation, ranks } from './numeric.js';

/** Pairwise complete observations: each cell reports its own sample size. */
export function correlationMatrix(rows, options) {
  const keys = validateFeatures(options.features, 2);
  const ranked = options.correlation !== 'pearson';
  const columns = keys.map((key) => rows.map((video) => valueFor(video, key, options.logCounts)));
  const cells = columns.map((left) =>
    columns.map((right) => {
      const a = [],
        b = [];
      left.forEach((value, i) => {
        if (value !== null && right[i] !== null) {
          a.push(value);
          b.push(right[i]);
        }
      });
      return { n: a.length, r: correlation(ranked ? ranks(a) : a, ranked ? ranks(b) : b) };
    }),
  );
  return { method: 'correlation', keys, cells, n: rows.length, ranked };
}
