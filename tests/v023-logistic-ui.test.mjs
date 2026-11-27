import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createInitialState } from '../src/app/state.js';
import { buildLibraryRows } from '../src/app/library.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';
import { runAnalysis } from '../src/app/analytics/engine.js';

function fixture() {
  const state = createInitialState();
  state.user = { id: 'a' };
  state.view = 'analysis';
  state.library = {
    playlists: [
      { id: 'target', name: '<対象>' },
      { id: 'other', name: '<対象>' },
    ],
    videos: Array.from({ length: 60 }, (_, i) => ({
      id: 'sm' + (i + 1),
      title: i ? '曲' + i : '<script>evil()</script>',
      views: 1000 + i * 100,
      comments: i % 3 ? 100 : 10,
      mylists: i + 1,
      tags: i % 4 ? ['<tag>'] : [],
    })),
    entries: Array.from({ length: 60 }, (_, i) => ({
      playlist_id: i % 3 ? 'target' : 'other',
      video_id: 'sm' + (i + 1),
      present: true,
      position: i + 1,
    })),
    meta: [],
  };
  Object.assign(state.analysis, {
    method: 'logistic',
    treePlaylist: 'target',
    treeCategories: ['tag'],
  });
  return state;
}
function harness(state) {
  const listeners = {},
    workers = [];
  const c = createAnalysisController({
    root: { addEventListener: (name, fn) => (listeners[name] = fn) },
    state,
    render: () => {},
    createWorker: () => {
      const w = {
        postMessage(data) {
          this.data = data;
        },
        terminate() {
          this.stopped = true;
        },
      };
      workers.push(w);
      return w;
    },
  });
  return {
    c,
    workers,
    change: (field, value, type = 'number') =>
      listeners.change({ target: { dataset: { analysisField: field }, type, value } }),
    click: (dataset) => listeners.click({ target: { closest: () => ({ dataset }) } }),
  };
}

test('logistic UI distinguishes same-name target IDs, shows all controls and safely renders coefficients and selected songs', () => {
  const state = fixture(),
    view = createViewRenderer({ state, renderDialog: () => '' });
  state.analysis.treePlaylist = '';
  assert.match(view.content(), /マイリストを選択してください/);
  state.analysis.treePlaylist = 'target';
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  state.analysis.selection = {
    type: 'group',
    index: state.analysis.result.predictions[0].predicted ? 0 : 1,
  };
  const html = view.content();
  for (const text of [
    'ID: target',
    'ID: other',
    'data-analysis-field="logisticLambda"',
    'data-analysis-field="logisticCutoff"',
    'ROC-AUC',
    '標準化係数',
    '予測確率の帯',
    'data-analysis-group=',
    'id="analysis-selection"',
    '&lt;script&gt;',
    '&lt;tag&gt;',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<script>|<tag>|<対象>|\bNaN\b|\bInfinity\b/);
  assert.equal((html.match(/data-analysis-method=/g) || []).length, 9);
});

test('changing logistic settings cancels stale Worker results and group selection respects account/library changes', () => {
  const state = fixture(),
    h = harness(state);
  h.c.execute();
  const first = h.workers[0];
  h.change('logisticLambda', '0.1');
  assert.equal(first.stopped, true);
  assert.equal(state.analysis.logisticLambda, 0.1);
  first.onmessage({ data: { id: first.data.id, result: { private: true } } });
  assert.equal(state.analysis.result, null);
  h.c.execute();
  const second = h.workers[1];
  second.onmessage({
    data: { id: second.data.id, result: runAnalysis(second.data.rows, second.data.options) },
  });
  h.click({ analysisGroup: '2' });
  assert.deepEqual(state.analysis.selection, { type: 'group', index: 2 });
  state.library = { ...state.library };
  h.click({ analysisGroup: '0' });
  assert.equal(state.analysis.result, null);
  state.user = { id: 'b' };
  h.c.synchronize();
  assert.equal(state.analysis.treePlaylist, '');
});

test('actual analytics Worker computes logistic predictions and returns understandable input errors', async () => {
  const state = fixture(),
    worker = new Worker(new URL('./fixtures/analytics-worker-runner.mjs', import.meta.url));
  try {
    let pending = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({ id: 23, rows: buildLibraryRows(state.library), options: state.analysis });
    const [data] = await pending;
    assert.equal(data.error, undefined);
    assert.equal(data.result.method, 'logistic');
    assert.equal(data.result.predictions.length, 60);
    pending = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({
      id: 24,
      rows: buildLibraryRows(state.library),
      options: { ...state.analysis, treePlaylist: '' },
    });
    assert.match((await pending)[0].error, /マイリストを選択/);
  } finally {
    await worker.terminate();
  }
});
