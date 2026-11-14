import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createInitialState } from '../src/app/state.js';
import { buildLibraryRows } from '../src/app/library.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { niceAxis } from '../src/ui/analysis-charts.js';

test('分析グラフは切りのよい等間隔目盛りを使い、定数の軸でも範囲を確保する', () => {
  for (const values of [
    [-5.96, 2.97],
    [1.73, 4.11],
    [0, 0],
    [0.00013, 0.00048],
  ]) {
    const axis = niceAxis(values);
    assert.ok(axis.low < Math.min(...values) && axis.high > Math.max(...values));
    assert.ok(axis.ticks.length >= 3 && axis.ticks.length <= 8);
    const gaps = axis.ticks.slice(1).map((v, i) => v - axis.ticks[i]);
    assert.ok(gaps.every((gap) => Math.abs(gap - gaps[0]) < 1e-10));
  }
});

function fixture(count = 32) {
  const state = createInitialState();
  state.user = { id: 'user-a', email: 'example@example.invalid', user_metadata: {} };
  state.view = 'analysis';
  state.library = {
    videos: Array.from({ length: count }, (_, i) => ({
      id: 'sm' + (i + 1),
      title: i ? '曲' + i : '<script>alert(1)</script>',
      views: (i + 1) * 120,
      mylists: (i + 1) * 3 + (i % 5),
      comments: 5 + (i % 9),
      likes: (i % 6) + 1,
      duration: 60 + i * i,
      tags: i < 10 ? ['TEST-A', 'TEST-B'] : ['TEST-C'],
    })),
    entries: [],
    playlists: [],
    meta: [],
  };
  state.analysis.features = ['views', 'comments', 'duration'];
  state.analysis.ruleExtras = true;
  return state;
}
test('6種類の結果画面が曲名をエスケープし、操作導線と有効件数を表示する', () => {
  const state = fixture();
  for (const method of ['correlation', 'regression', 'multiple', 'pca', 'rules', 'clusters']) {
    state.analysis.method = method;
    state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
    const html = createViewRenderer({ state, renderDialog: () => '' }).shell();
    assert.match(html, /分析対象 32曲/);
    assert.match(html, /id="analysis-export"/);
    assert.equal((html.match(/data-analysis-method=/g) || []).length, 6);
    assert.doesNotMatch(html, /<script>|onerror=|onclick=|\bNaN\b|\bInfinity\b/);
    if (['regression', 'multiple', 'pca', 'clusters'].includes(method)) {
      assert.match(html, /data-scatter-video="sm1"/);
      assert.match(html, /&lt;script&gt;/);
    }
    // Mobile keeps its six existing destinations.
    const mobile = html.match(/<nav class="mobile-bottom-nav"[\s\S]*?<\/nav>/)[0];
    assert.equal((mobile.match(/<button /g) || []).length, 6);
  }
});
test('階層型画面は標本・省略枝を明示し、選択群の曲一覧を開ける', () => {
  const state = fixture(330);
  state.analysis.method = 'clusters';
  state.analysis.clusterMethod = 'hierarchical';
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  state.analysis.selection = { type: 'group', index: 0 };
  const html = createViewRenderer({ state, renderDialog: () => '' }).content();
  assert.match(html, /グループ内の枝は省略/);
  assert.match(html, /標本300曲/);
  assert.match(html, /選択した項目の曲/);
  assert.match(html, /data-detail=/);
});
function rootStub() {
  const listeners = {};
  return {
    addEventListener: (name, handler) => (listeners[name] ||= []).push(handler),
    dispatch(name, button) {
      const target = { ...button, closest: () => button };
      listeners[name]?.forEach((fn) => fn({ target }));
    },
  };
}
test('分析はキャンセル・条件変更で古い応答を破棄し、ログアウトで私的結果を消去する', () => {
  const state = fixture(),
    root = rootStub(),
    workers = [];
  const controller = createAnalysisController({
    root,
    state,
    render: () => {},
    createWorker: () => {
      const worker = {
        terminated: false,
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
  controller.execute();
  assert.equal(state.analysis.busy, true);
  const first = workers[0];
  controller.cancel();
  first.onmessage({ data: { id: first.data.id, result: { private: true } } });
  assert.equal(state.analysis.result, null);
  assert.equal(first.terminated, true);
  controller.execute();
  const second = workers[1];
  second.onmessage({ data: { id: second.data.id, result: { private: true } } });
  assert.deepEqual(state.analysis.result, { private: true });
  root.dispatch('change', {
    type: 'select-one',
    value: 'pearson',
    dataset: { analysisField: 'correlation' },
  });
  assert.equal(state.analysis.result, null);
  controller.execute();
  state.user = { id: 'user-b' };
  controller.synchronize();
  assert.equal(workers[2].terminated, true);
  assert.equal(state.analysis.busy, false);
  assert.equal(state.analysis.result, null);
  assert.equal(state.analysis.playlist, '');
});
test('ライブラリ再取得後は以前の分析結果を再利用しない', () => {
  const state = fixture(),
    root = rootStub();
  const controller = createAnalysisController({ root, state, render: () => {} });
  state.analysis.result = { from: 'old library' };
  state.library = { ...state.library, videos: [] };
  controller.synchronize();
  assert.equal(state.analysis.result, null);
});
test('分析Workerが別スレッドで計算し、エラー時は安全に応答する', async () => {
  const state = fixture();
  const worker = new Worker(new URL('./fixtures/analytics-worker-runner.mjs', import.meta.url));
  try {
    const response = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({
      id: 17,
      rows: buildLibraryRows(state.library),
      options: { ...state.analysis, method: 'pca' },
    });
    const [data] = await response;
    assert.equal(data.id, 17);
    assert.equal(data.result.n, 32);
    assert.equal(data.result.method, 'pca');
    const failure = once(worker, 'message', { signal: AbortSignal.timeout(8000) });
    worker.postMessage({ id: 18, rows: [], options: { method: 'unknown' } });
    const [error] = await failure;
    assert.equal(error.id, 18);
    assert.match(error.error, /分析方法/);
    assert.equal(error.result, undefined);
  } finally {
    await worker.terminate();
  }
});
