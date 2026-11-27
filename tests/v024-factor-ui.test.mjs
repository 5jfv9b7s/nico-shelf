import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';
import { buildLibraryRows } from '../src/app/library.js';
import { runAnalysis } from '../src/app/analytics/engine.js';

function fixture() {
  const ref = JSON.parse(readFileSync(new URL('./fixtures/factor-reference.json', import.meta.url)))
    .datasets[0];
  const state = createInitialState();
  state.user = { id: 'a' };
  state.view = 'analysis';
  state.library = {
    videos: ref.raw.map((v, i) => ({
      id: 'sm' + (i + 1),
      title: i ? '曲' + i : '<script>曲</script>',
      views: 200 + v[0],
      comments: 200 + v[1],
      mylists: 200 + v[2],
      likes: 200 + v[3],
      duration: 400 + v[4],
    })),
    playlists: [
      { id: 'a', name: '<同名>' },
      { id: 'b', name: '<同名>' },
    ],
    entries: [],
    meta: [],
  };
  Object.assign(state.analysis, {
    method: 'factor',
    factorCount: 2,
    features: ['views', 'comments', 'mylists', 'likes', 'duration'],
    logCounts: false,
  });
  return state;
}
function harness(state) {
  const listeners = {},
    workers = [];
  let renderCount = 0;
  const controller = createAnalysisController({
    state,
    root: { addEventListener: (name, fn) => (listeners[name] = fn) },
    render: () => renderCount++,
    createWorker: () => {
      const worker = {
        postMessage(data) {
          this.data = data;
        },
        terminate() {
          this.stopped = true;
        },
      };
      workers.push(worker);
      return worker;
    },
  });
  return {
    controller,
    workers,
    renders: () => renderCount,
    change: (field, value) =>
      listeners.change({
        target: { dataset: { analysisField: field }, type: 'select-one', value },
      }),
    click: (dataset) => listeners.click({ target: { closest: () => ({ dataset }) } }),
  };
}

test('factor controls preserve requested numeric defaults and expose distinct loadings, scores and fit diagnostics', () => {
  const state = fixture(),
    view = createViewRenderer({ state, renderDialog: () => '' });
  assert.deepEqual(createInitialState().analysis.features, ['views', 'comments', 'mylists']);
  assert.equal(createInitialState().analysis.factorCount, 1);
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  const html = view.content();
  for (const text of [
    'data-analysis-method="factor"',
    'data-analysis-field="factorCount"',
    'data-analysis-field="factorRotation"',
    'data-analysis-field="factorIterations"',
    '5個以上',
    '因子負荷量',
    '共通性',
    '独自分散',
    '因子得点',
    'RMSR',
    'data-detail=',
    'data-scatter-video=',
    'id="analysis-export"',
    'role="group"',
    'aria-label=',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /<同名>|<script>|\bNaN\b|\bInfinity\b/);
  assert.equal((html.match(/data-analysis-method=/g) || []).length, 9);
  assert.ok(html.includes('主成分分析との違い'));
  assert.ok(html.includes('is-strong'));
  state.analysis.factorCount = 1;
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  assert.match(view.content(), /1因子のため縦軸なし/);
});

test('factor settings invalidate previous results, cancel stale calculations and reset on account/library changes', () => {
  const state = fixture(),
    h = harness(state);
  h.controller.execute();
  const old = h.workers[0];
  h.change('factorCount', '1');
  assert.equal(old.stopped, true);
  assert.equal(state.analysis.factorCount, 1);
  old.onmessage({ data: { id: old.data.id, result: { private: true } } });
  assert.equal(state.analysis.result, null);
  h.change('factorRotation', 'none');
  h.change('factorIterations', '1000');
  assert.equal(state.analysis.factorRotation, 'none');
  assert.equal(state.analysis.factorIterations, 1000);
  h.controller.execute();
  const active = h.workers[1];
  active.onmessage({
    data: { id: active.data.id, result: runAnalysis(active.data.rows, active.data.options) },
  });
  assert.equal(state.analysis.result.method, 'factor');
  state.library = { ...state.library };
  h.controller.synchronize();
  assert.equal(state.analysis.result, null);
  state.user = { id: 'b' };
  h.controller.synchronize();
  assert.equal(state.analysis.factorRotation, 'varimax');
  assert.equal(state.analysis.factorCount, 1);
});

test('factor analysis runs in the actual analytics Worker and invalid factor counts return actionable messages', async () => {
  const state = fixture(),
    worker = new Worker(new URL('./fixtures/analytics-worker-runner.mjs', import.meta.url));
  try {
    let pending = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({ id: 24, rows: buildLibraryRows(state.library), options: state.analysis });
    const [data] = await pending;
    assert.equal(data.error, undefined);
    assert.equal(data.result.method, 'factor');
    assert.equal(data.result.points.length, 180);
    assert.equal(data.result.count, 2);
    pending = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({
      id: 25,
      rows: buildLibraryRows(state.library),
      options: { ...state.analysis, factorCount: 3 },
    });
    assert.match((await pending)[0].error, /3因子.*6個/);
  } finally {
    await worker.terminate();
  }
});
