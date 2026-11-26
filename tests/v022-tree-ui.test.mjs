import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';
import { buildLibraryRows } from '../src/app/library.js';
import { runAnalysis } from '../src/app/analytics/engine.js';

function fixture() {
  const state = createInitialState();
  state.user = { id: 'owner-a', user_metadata: {} };
  state.view = 'analysis';
  state.library = {
    videos: Array.from({ length: 60 }, (_, i) => ({
      id: 'sm' + i,
      title: i ? '曲' + i : '<img src=x onerror=evil()>',
      comments: i < 30 ? 10 : 100,
      views: 1000 + i * 1000,
      mylists: i + 1,
    })),
    playlists: [
      { id: 'a', name: '<対象のリスト>' },
      { id: 'b', name: '<対象のリスト>' },
    ],
    entries: Array.from({ length: 60 }, (_, i) => ({
      playlist_id: i < 30 ? 'a' : 'b',
      video_id: 'sm' + i,
      position: i,
      present: true,
    })),
    meta: [],
  };
  Object.assign(state.analysis, {
    method: 'tree',
    treePlaylist: 'a',
    features: ['comments'],
    treeCategories: [],
  });
  return state;
}
function harness(state) {
  const listeners = {},
    workers = [];
  let renders = 0;
  const root = { addEventListener: (name, fn) => (listeners[name] = fn) };
  const controller = createAnalysisController({
    root,
    state,
    render: () => renders++,
    createWorker: () => {
      const worker = {
        postMessage(data) {
          this.data = data;
        },
        terminate() {
          this.terminated = true;
        },
      };
      workers.push(worker);
      return worker;
    },
  });
  return {
    controller,
    workers,
    renders: () => renders,
    change: (field, value, type = 'select-one', checked = false) =>
      listeners.change({ target: { dataset: { analysisField: field }, value, type, checked } }),
    click: (dataset) => listeners.click({ target: { closest: () => ({ dataset }) } }),
    toggle: (id, open) =>
      listeners.toggle({ target: { dataset: { analysisTreeBranch: String(id) }, open } }),
  };
}
test('tree screen requires a user-chosen playlist ID and escapes target names, conditions and song titles', () => {
  const state = fixture(),
    view = createViewRenderer({ state, renderDialog: () => '' });
  state.analysis.treePlaylist = '';
  let html = view.content();
  assert.match(html, /マイリストを選択してください/);
  assert.doesNotMatch(html, /value="a" selected|最近のお気に入り/);
  state.analysis.treePlaylist = 'a';
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  state.analysis.selection = { type: 'node', index: state.analysis.result.tree.id };
  html = view.content();
  assert.match(html, /&lt;対象のリスト&gt;/);
  assert.doesNotMatch(html, /<対象のリスト>|<img src=x|\bNaN\b|\bInfinity\b/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /混同行列/);
  assert.match(html, /学習に使っていない曲/);
  assert.match(html, /分類の分岐図/);
  assert.match(html, /data-analysis-node=/);
  assert.match(html, /id="analysis-export"/);
});
test('target-defining variables are disabled in the UI and removed by the computation', () => {
  const state = fixture();
  state.analysis.treeTarget = 'views';
  state.analysis.features = ['views', 'commentRate', 'comments'];
  const html = createViewRenderer({ state, renderDialog: () => '' }).content();
  assert.match(html, /data-analysis-field="features" value="views" disabled/);
  assert.match(html, /data-analysis-field="features" value="commentRate" disabled/);
  assert.match(html, /data-analysis-field="treeThreshold"/);
  const result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  assert.deepEqual(result.blocked, ['views', 'commentRate']);
  state.analysis.treeTarget = 'favorite';
  assert.doesNotMatch(
    createViewRenderer({ state, renderDialog: () => '' }).content(),
    /data-analysis-field="treePlaylist"/,
  );
});
test('node selection and native branch toggles preserve display state without rerunning training', () => {
  const state = fixture(),
    h = harness(state);
  h.controller.execute();
  const worker = h.workers[0];
  assert.ok(!Object.hasOwn(worker.data.options, 'treeExpansion'));
  worker.onmessage({
    data: { id: worker.data.id, result: runAnalysis(worker.data.rows, worker.data.options) },
  });
  h.click({ analysisTreeToggle: '0' });
  h.click({ analysisNode: '0' });
  assert.equal(state.analysis.treeExpansion[0], false);
  assert.deepEqual(state.analysis.selection, { type: 'node', index: 0 });
  assert.equal(h.workers.length, 1);
  h.click({ analysisTreeExpand: 'all' });
  assert.equal(state.analysis.treeExpansion[0], true);
  h.click({ analysisTreeExpand: 'reset' });
  assert.deepEqual(state.analysis.treeExpansion, {});
  h.change('treeMinLeaf', '8', 'number');
  assert.equal(state.analysis.treeMinLeaf, 8);
  assert.equal(state.analysis.result, null);
  assert.deepEqual(state.analysis.treeExpansion, {});
  h.change('treeCategories', 'tag', 'checkbox', true);
  assert.deepEqual(state.analysis.treeCategories, ['tag']);
});
test('target changes cancel stale responses and node selections cannot reuse another account or library result', () => {
  const state = fixture(),
    h = harness(state);
  h.controller.execute();
  const old = h.workers[0];
  h.change('treeTarget', 'favorite');
  assert.equal(old.terminated, true);
  old.onmessage({ data: { id: old.data.id, result: { private: true } } });
  assert.equal(state.analysis.result, null);
  state.analysis.treeTarget = 'playlist';
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  state.user = { id: 'owner-b' };
  h.click({ analysisNode: '0' });
  assert.equal(state.analysis.result, null);
  assert.equal(state.analysis.treePlaylist, '');
  state.analysis.result = { nodes: [{ id: 0, ids: ['private'] }] };
  state.library = { ...state.library };
  h.click({ analysisNode: '0' });
  assert.equal(state.analysis.result, null);
});
test('decision tree and held-out evaluation execute through the actual Worker and return actionable target errors', async () => {
  const state = fixture(),
    worker = new Worker(new URL('./fixtures/analytics-worker-runner.mjs', import.meta.url));
  try {
    const response = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({ id: 22, rows: buildLibraryRows(state.library), options: state.analysis });
    const [data] = await response;
    assert.equal(data.id, 22);
    assert.equal(data.error, undefined);
    assert.equal(data.result.method, 'tree');
    assert.equal(data.result.predictions.length, 60);
    assert.equal(data.result.metrics.accuracy, 1);
    const failure = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({
      id: 23,
      rows: buildLibraryRows(state.library),
      options: { ...state.analysis, treePlaylist: '' },
    });
    const [error] = await failure;
    assert.match(error.error, /分類対象のマイリストを選択/);
    assert.equal(error.result, undefined);
  } finally {
    await worker.terminate();
  }
});
