/** Nonnegative degrees of freedom is necessary, not sufficient, for identification. */
export function minimumFactorVariables(count) {
  for (let p = count + 1; p <= 11; p++) if (((p - count) ** 2 - p - count) / 2 >= 0) return p;
  return null;
}
