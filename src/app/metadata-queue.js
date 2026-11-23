/** Sequential, cancellable metadata work; retry the same ID when rate-limited. */
export function abortError() {
  return new DOMException('処理を中止しました', 'AbortError');
}
export function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(abortError());
  }
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError());
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', cancel));
  });
}
export function metadataSleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
const RATE_CODES = new Set(['RATE_LIMITED', 'ACCOUNT_RATE_LIMITED', 'UPSTREAM_RATE_LIMITED']);
const PER_VIDEO_CODES = new Set(['UPSTREAM_METADATA_UNAVAILABLE', 'UPSTREAM_NOT_FOUND']);
function fatal(error) {
  return (
    error?.status === 401 ||
    error?.status === 403 ||
    /^(AUTH_|METADATA_NOT_CONFIGURED|STALE_LIBRARY)/.test(error?.code || '') ||
    /(?:UNCONFIGURED|_LIMIT_FAILED)$/.test(error?.code || '') ||
    /NICO_(?:ROW|ACCOUNT|GLOBAL|FIELD|ARRAY)_LIMIT/.test(error?.message || '')
  );
}
export function metadataJobInitial(total) {
  return {
    phase: 'running',
    total,
    processed: 0,
    ok: 0,
    failed: 0,
    remaining: total,
    currentId: '',
    waitSeconds: 0,
    message: '',
    failures: [],
    running: true,
    cancelRequested: false,
  };
}
export async function runMetadataQueue(
  ids,
  {
    enrich,
    signal,
    onProgress = () => {},
    isCurrent = () => true,
    sleep = metadataSleep,
    now = Date.now,
    intervalMs = 400,
    batchSize = 15,
    batchPauseMs = 5000,
    maxRateRetries = 2,
  } = {},
) {
  const pending = [...new Set(ids)];
  const job = metadataJobInitial(pending.length);
  let consecutiveErrors = 0;
  const emit = () => onProgress({ ...job, failures: [...job.failures] });
  const valid = () => {
    if (signal?.aborted) throw abortError();
    if (!isCurrent())
      throw Object.assign(new Error('ライブラリが変更されたため停止しました'), {
        code: 'STALE_LIBRARY',
      });
  };
  async function wait(ms, phase) {
    const until = now() + ms;
    job.phase = phase;
    while (now() < until) {
      valid();
      job.waitSeconds = Math.ceil((until - now()) / 1000);
      emit();
      await sleep(Math.min(1000, until - now()), signal);
    }
    job.waitSeconds = 0;
    valid();
  }
  emit();
  try {
    for (let i = 0; i < pending.length; i++) {
      valid();
      if (i)
        await wait(
          i % batchSize === 0 ? batchPauseMs : intervalMs,
          i % batchSize === 0 ? 'resting' : 'interval',
        );
      valid();
      job.currentId = pending[i];
      let retries = 0;
      for (;;) {
        valid();
        job.phase = 'running';
        job.message = '';
        emit();
        try {
          await enrich(pending[i], { signal });
          // A DB save already sent when cancel was requested may finish safely.
          job.ok++;
          job.processed++;
          job.remaining--;
          consecutiveErrors = 0;
          emit();
          break;
        } catch (error) {
          if (signal?.aborted || error?.name === 'AbortError') throw abortError();
          if (fatal(error)) throw error;
          if (error?.status === 429 || RATE_CODES.has(error?.code)) {
            if (retries++ >= maxRateRetries)
              throw new Error(
                'アクセス制限が続いているため停止しました。時間を空けて再実行してください',
              );
            job.message = 'アクセス制限のため待機しています。同じ動画から再開します。';
            const retryMs = Math.max(
              60000,
              Math.min(Number(error?.retryAfterMs) || 60000, 3600000),
            );
            await wait(retryMs, 'rate-wait');
            continue;
          }
          job.failed++;
          job.processed++;
          job.remaining--;
          job.failures.push(`${pending[i]}: ${String(error?.message || '取得失敗').slice(0, 350)}`);
          if (job.failures.length > 3) job.failures.shift();
          consecutiveErrors = PER_VIDEO_CODES.has(error?.code) ? 0 : consecutiveErrors + 1;
          emit();
          if (consecutiveErrors >= 3)
            throw new Error(
              '取得・保存エラーが3件続いたため停止しました。取得元や接続設定を確認してください',
            );
          break;
        }
      }
    }
    job.phase = signal?.aborted ? 'cancelled' : 'done';
  } catch (error) {
    job.phase = signal?.aborted || error?.name === 'AbortError' ? 'cancelled' : 'stopped';
    job.message = job.phase === 'cancelled' ? '' : String(error?.message || '処理を停止しました');
  }
  job.running = false;
  job.waitSeconds = 0;
  job.currentId = '';
  emit();
  return { ...job, failures: [...job.failures] };
}
