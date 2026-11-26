import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createInitialState } from '../src/app/state.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';
import { createViewRenderer } from '../src/ui/views.js';
import { buildLibraryRows } from '../src/app/library.js';
import { runAnalysis } from '../src/app/analytics/engine.js';

function fixture() {
  const state = createInitialState();
  state.user = { id: 'test-owner', user_metadata: {} };
  state.view = 'analysis';
  state.library = {
    videos: Array.from({ length: 12 }, (_, i) => ({
      id: 'sm' + (i + 1),
      title: i ? '曲' + i : '<img src=x onerror=evil()>',
      tags: i < 6 ? ['<unsafe>', 'B', 'C', 'D'] : [],
      views: 100,
      published_at: '2026-01-01T00:00:00Z',
      duration: 180,
    })),
    entries: [],
    playlists: [],
    meta: [],
  };
  Object.assign(state.analysis, {
    method: 'rules',
    ruleMode: 'apriori',
    ruleFields: ['tag', 'views', 'published'],
    ruleMaxSize: 4,
    ruleMinCount: 1,
    ruleMinLift: 0,
    confidence: 0,
    ruleLimit: 100,
  });
  return state;
}
function harness(state) {
  const listeners = {},
    workers = [];
  const root = { addEventListener: (name, fn) => (listeners[name] = fn) };
  const controller = createAnalysisController({
    root,
    state,
    render: () => {},
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
    change: (field, value, type = 'text', extra = {}) =>
      listeners.change({
        target: { value, type, dataset: { analysisField: field, ...extra } },
      }),
    click: (id) => listeners.click({ target: { closest: () => ({ id, dataset: {} }) } }),
  };
}

test('advanced rule screen separates scope and attributes, escapes labels and exposes source exports', () => {
  const state = fixture();
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  state.analysis.selection = { type: 'rule', index: 0 };
  const html = createViewRenderer({ state, renderDialog: () => '' }).content();
  for (const field of [
    'ruleMode',
    'ruleFields',
    'ruleMaxSize',
    'ruleMinCount',
    'ruleMinLift',
    'ruleLimit',
    'ruleConsequentField',
    'ruleConsequentItem',
    'ruleViewBins',
    'ruleYearBins',
    'ruleDurationBins',
  ])
    assert.ok(html.includes('data-analysis-field="' + field + '"'), field);
  assert.match(html, /対象マイリスト（複数選択可）/);
  assert.match(html, /規則に使う属性/);
  assert.match(html, /最大項目集合サイズ（左右の合計）/);
  assert.match(html, /id="analysis-source-csv"/);
  assert.match(html, /id="analysis-source-arff"/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.doesNotMatch(html, /<unsafe>|<img src=x|\bNaN\b|\bInfinity\b/);
  state.analysis.result.partial = true;
  state.analysis.result.warnings = ['<探索上限>'];
  assert.match(createViewRenderer({ state, renderDialog: () => '' }).content(), /&lt;探索上限&gt;/);
  state.analysis.ruleMode = 'simple';
  state.analysis.result = null;
  const simple = createViewRenderer({
    state,
    renderDialog: () => '',
  }).content();
  assert.match(simple, /data-analysis-field="ruleExtras"/);
  assert.doesNotMatch(simple, /data-analysis-field="ruleMaxSize"/);
});

test('rule setting changes convert percentages, clear old results and invalidate pending workers', () => {
  const state = fixture(),
    { controller, workers, change } = harness(state);
  controller.execute();
  const old = workers[0];
  change('support', '2.5', 'number', { analysisPercent: 'true' });
  assert.equal(state.analysis.support, 0.025);
  assert.equal(old.terminated, true);
  old.onmessage({ data: { id: old.data.id, result: { private: true } } });
  assert.equal(state.analysis.result, null);
  state.analysis.ruleConsequentItem = 'old';
  change('ruleConsequentField', 'views');
  assert.equal(state.analysis.ruleConsequentItem, '');
  state.analysis.ruleConsequentField = 'views';
  change('ruleFields', 'views', 'checkbox');
  assert.ok(!state.analysis.ruleFields.includes('views'));
  assert.equal(state.analysis.ruleConsequentField, '');
  change('ruleLimit', '80', 'number');
  assert.equal(state.analysis.ruleLimit, 80);
  change('confidence', '', 'number', { analysisPercent: 'true' });
  assert.ok(Number.isNaN(state.analysis.confidence));
});

test('source downloads use the analyzed dataset and discard results on user/library changes', async () => {
  const state = fixture(),
    { click } = harness(state);
  state.analysis.result = runAnalysis(buildLibraryRows(state.library), state.analysis);
  const saved = {
    document: globalThis.document,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const downloads = [];
  let blob;
  globalThis.document = {
    createElement: () => ({
      click() {
        downloads.push(this.download);
      },
    }),
  };
  URL.createObjectURL = (value) => {
    blob = value;
    return 'blob:test';
  };
  URL.revokeObjectURL = () => {};
  try {
    click('analysis-source-arff');
    assert.deepEqual(downloads, ['nico-shelf-rules-source.arff']);
    assert.match(await blob.text(), /@relation nico_shelf_rules/);
    state.user = { id: 'other-owner' };
    click('analysis-source-csv');
    assert.equal(downloads.length, 1);
    assert.equal(state.analysis.result, null);
    state.analysis.result = { method: 'rules', dataset: { private: true } };
    state.library = { ...state.library };
    click('analysis-export');
    assert.equal(downloads.length, 1);
    assert.equal(state.analysis.result, null);
  } finally {
    globalThis.document = saved.document;
    URL.createObjectURL = saved.create;
    URL.revokeObjectURL = saved.revoke;
  }
});

test('advanced multi-item rules run through the actual analysis Worker', async () => {
  const state = fixture(),
    worker = new Worker(new URL('./fixtures/analytics-worker-runner.mjs', import.meta.url));
  try {
    const response = once(worker, 'message', {
      signal: AbortSignal.timeout(8000),
    });
    worker.postMessage({
      id: 21,
      rows: buildLibraryRows(state.library),
      options: state.analysis,
    });
    const [data] = await response;
    assert.equal(data.id, 21);
    assert.equal(data.error, undefined);
    assert.equal(data.result.mode, 'apriori');
    assert.ok(data.result.rules.some((r) => r.fromItems.length === 2 && r.toItems.length === 2));
    assert.equal(data.result.dataset.transactions.length, 12);
  } finally {
    await worker.terminate();
  }
});
