import { needsMetadata } from '../discovery.js';
import { runMetadataQueue, metadataJobInitial } from './metadata-queue.js';
import { updateMetadataProgress } from '../ui/metadata-progress.js';

/** One bulk job per tab. Closing its dialog does not discard the job or its counts. */
export function createMetadataController({
  state,
  root,
  enrich,
  nicoBridge,
  connectNico,
  render,
  refresh,
  toast,
  runQueue = runMetadataQueue,
}) {
  let active = null;
  function cancel() {
    if (!active || state.metadataJob?.cancelRequested) return;
    active.controller.abort();
    if (state.metadataJob) {
      state.metadataJob.cancelRequested = true;
      updateMetadataProgress(root, state.metadataJob);
    }
  }
  function reset() {
    active?.controller.abort();
    active = null;
    state.metadataJob = null;
    state.metadataProgress = '';
    state.busy = false;
  }
  async function start() {
    if (state.busy || active || !state.user) return;
    if (state.metadataSource === 'bridge' && !nicoBridge.connected) return connectNico();
    const ids = state.library.videos.filter((v) => needsMetadata(v)).map((v) => v.id);
    if (!ids.length) return toast('補完待ちの動画はありません');
    const owner = state.user.id,
      library = state.library,
      source = state.metadataSource;
    const run = { controller: new AbortController() };
    active = run;
    state.metadataProgress = '';
    state.metadataJob = metadataJobInitial(ids.length);
    state.busy = true;
    render();
    const current = () => state.user?.id === owner && state.library === library && active === run;
    try {
      const result = await runQueue(ids, {
        signal: run.controller.signal,
        isCurrent: current,
        enrich: (id, { signal }) => enrich(id, { signal, source }),
        onProgress: (job) => {
          if (!current()) return;
          state.metadataJob = { ...job, cancelRequested: run.controller.signal.aborted };
          updateMetadataProgress(root, state.metadataJob);
        },
      });
      if (state.user?.id !== owner || active !== run) return;
      state.metadataJob = result;
      await refresh();
      if (state.user?.id !== owner || active !== run) return;
      toast(
        `${result.phase === 'done' ? '補完完了' : result.phase === 'cancelled' ? '補完を中止' : '補完を停止'}：成功${result.ok}件・失敗${result.failed}件・未処理${result.remaining}件`,
        result.phase === 'stopped',
      );
      return result;
    } finally {
      if (active === run) {
        active = null;
        state.busy = false;
        if (state.user?.id === owner) render();
      }
    }
  }
  return { start, cancel, reset };
}
