import { esc } from '../lib.js';
export function metadataJobText(job) {
  if (!job) return '';
  if (job.cancelRequested && job.running)
    return '中止しています。送信済みの保存処理があれば完了を待ちます。';
  const count = `${job.processed}/${job.total}件確認・補完成功 ${job.ok}件・取得失敗 ${job.failed}件・未処理 ${job.remaining}件`;
  const phase =
    job.phase === 'done'
      ? '完了'
      : job.phase === 'cancelled'
        ? '中止'
        : job.phase === 'stopped'
          ? '停止'
          : job.phase === 'rate-wait'
            ? `アクセス制限：あと${job.waitSeconds}秒待機`
            : job.phase === 'resting'
              ? `休憩：あと${job.waitSeconds}秒`
              : job.currentId
                ? `${job.currentId} を取得中`
                : '準備中';
  return phase + ' / ' + count + (job.message ? '。' + job.message : '');
}
export function renderMetadataProgress(job, { announce = true } = {}) {
  if (!job) return '';
  return `<div class="metadata-job-progress"><progress data-metadata-progress max="${Math.max(1, job.total)}" value="${job.processed}" aria-label="メタデータ補完の進捗"></progress><p class="sync-progress" data-metadata-message role="status" aria-live="${announce ? 'polite' : 'off'}">${esc(metadataJobText(job))}</p><p class="modal-note" data-metadata-failure>${esc(job.failures?.at(-1) || '')}</p><button class="btn subtle" data-metadata-cancel ${!job.running || job.cancelRequested ? 'disabled' : ''} ${!job.running ? 'hidden' : ''}>${job.cancelRequested ? '中止しています…' : '補完を中止する'}</button></div>`;
}
/** Update text/values only, preserving keyboard focus and the dialog scroll position. */
export function updateMetadataProgress(root, job) {
  root.querySelectorAll('[data-metadata-message]').forEach((el) => {
    el.textContent = metadataJobText(job);
  });
  root.querySelectorAll('[data-metadata-progress]').forEach((el) => {
    el.max = Math.max(1, job.total);
    el.value = job.processed;
  });
  root.querySelectorAll('[data-metadata-failure]').forEach((el) => {
    el.textContent = job.failures?.at(-1) || '';
  });
  root.querySelectorAll('[data-metadata-cancel]').forEach((el) => {
    el.disabled = !job.running || job.cancelRequested;
    el.hidden = !job.running;
    el.textContent = job.cancelRequested ? '中止しています…' : '補完を中止する';
  });
}
