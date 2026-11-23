/** Estimate normal processing from recent completed attempts, excluding explicit waits. */
export function estimateMetadataTiming({
  total,
  processed,
  running,
  samples,
  startedAt,
  now,
  requestStartedAt = null,
  waitUntil = null,
  gapPending = true,
  intervalMs = 400,
  batchSize = 15,
  batchPauseMs = 5000,
}) {
  const elapsedMs = Math.max(0, now - startedAt);
  const remaining = Math.max(0, total - processed);
  if (!running || !remaining || samples.length < 3) return { elapsedMs, etaMs: null };
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  // Each gap occurs before its zero-based item index; index 0 has no initial gap.
  const firstGap = Math.max(1, processed + (gapPending ? 0 : 1));
  const gaps = Math.max(0, total - firstGap);
  const pauses = gaps
    ? Math.max(0, Math.floor((total - 1) / batchSize) - Math.floor((firstGap - 1) / batchSize))
    : 0;
  const futureGaps = (gaps - pauses) * intervalMs + pauses * batchPauseMs;
  const activeElapsed =
    requestStartedAt === null ? 0 : Math.min(mean, Math.max(0, now - requestStartedAt));
  const waiting = waitUntil === null ? 0 : Math.max(0, waitUntil - now);
  const etaMs = Math.max(0, mean * remaining - activeElapsed + futureGaps + waiting);
  return { elapsedMs, etaMs: Number.isFinite(etaMs) ? etaMs : null };
}
