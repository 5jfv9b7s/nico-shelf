import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analysisDefaults, ANALYSIS_METHODS, COUNT_METRICS } from '../src/app/analytics/data.js';
import { fitOLS } from '../src/app/analytics/regression.js';
import { principalComponents } from '../src/app/analytics/pca.js';
import { silhouetteScore } from '../src/app/analytics/cluster-validation.js';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { mineRules } from '../src/app/analytics/rules.js';
import { analysisCsv } from '../src/app/analytics/export.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';

const ref = JSON.parse(
  await readFile(new URL('./fixtures/analytics-reference.json', import.meta.url), 'utf8'),
);
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) < tolerance, a + ' != ' + b);
function rows(count = 30) {
  return Array.from({ length: count }, (_, i) => ({
    id: 'sm' + (i + 1),
    title: '曲' + (i + 1),
    views: (i + 1) * 100,
    likes: 1 + (i % 7),
    mylists: (i + 1) * 3 + (i % 5),
    comments: 2 + (i % 11),
    duration: 60 + i * i,
    published_at: 2007 + (i % 19) + '-01-01T00:00:00Z',
  }));
}
test('初期選択は件数を1項目に抑え、表示メニューに飛び番号を出さない', () => {
  const defaults = analysisDefaults();
  assert.equal(defaults.features.filter((key) => COUNT_METRICS.has(key)).length, 1);
  assert.ok(defaults.features.includes('duration') && defaults.features.includes('published'));
  assert.ok(Object.values(ANALYSIS_METHODS).every((label) => !/^\d/.test(label)));
  assert.equal(defaults.ruleSort, 'count');
});
test('95%区間とt臨界値がSciPyと一致し、小自由度で正規近似を使わない', () => {
  const fit = fitOLS(ref.x, ref.y);
  close(fit.critical95, ref.critical95);
  fit.coefficients.forEach((c, i) => {
    close(c.ciLow, ref.ci95[i][0]);
    close(c.ciHigh, ref.ci95[i][1]);
  });
  const lowDf = fitOLS(
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ],
    [1, 3, 4, 7],
  );
  assert.equal(lowDf.df, 1);
  close(lowDf.critical95, ref.critical95_df1);
  assert.ok(lowDf.critical95 > 12);
});
test('シルエットは単独点群を含むscikit-learnの全点・部分評価と一致する', () => {
  const values = principalComponents(ref.x).values;
  close(silhouetteScore(values, ref.silhouette.labels), ref.silhouette.mean);
  close(
    silhouetteScore(values, ref.silhouette.labels, ref.silhouette.evaluation),
    ref.silhouette.partial,
  );
  assert.equal(silhouetteScore([[1], [2], [3]], [0, 0, 0]), null);
  assert.equal(silhouetteScore([[1], [2], [3]], [0, 1, 2]), null);
  assert.equal(silhouetteScore([[1], [1], [1], [1]], [0, 0, 1, 1]), 0);
});
test('k比較は選択kの全対象での群内平方和と一致し、係数評価の標本だけを制限する', () => {
  const result = runAnalysis(rows(315), { ...analysisDefaults(), method: 'clusters', k: 3 });
  assert.equal(result.n, 315);
  assert.equal(result.silhouetteN, 300);
  const selected = result.comparison.find((row) => row.k === 3);
  close(selected.inertia, result.inertia);
  close(selected.silhouette, result.silhouette);
  assert.deepEqual(
    result.comparison.map((row) => row.k),
    [2, 3, 4, 5, 6, 7, 8],
  );
  assert.ok(result.comparison.every((row) => row.minSize > 0 && row.maxSize <= result.n));
  const csv = analysisCsv(result);
  assert.match(csv, /シルエットの評価曲数/);
  assert.match(csv, /シルエット係数/);
});
test('相関ルールは上位50件を切る前に件数順・リフト順を切り替える', () => {
  const records = Array.from({ length: 100 }, (_, i) => ({
    id: 'sm' + (i + 1),
    tags: [
      ...(i < 50 ? ['COMMON-A'] : []),
      ...(i < 40 ? ['COMMON-B'] : []),
      ...(i >= 80 && i <= 82 ? Array.from({ length: 20 }, (_, j) => 'RARE-' + j) : []),
    ],
  }));
  const options = { support: 0.01, confidence: 0.5, ruleExtras: true };
  const byCount = mineRules(records, { ...options, ruleSort: 'count' });
  const byLift = mineRules(records, { ...options, ruleSort: 'lift' });
  assert.ok(byCount.totalRules > 50);
  assert.equal(byCount.rules[0].count, 40);
  assert.ok(byLift.rules.every((rule) => rule.count === 3));
  assert.equal(byCount.rules.length, 50);
});
test('画面は主成分の読み上げ要約、CI、k比較、ルール並べ順を表示する', () => {
  const state = createInitialState();
  state.user = { id: 'test-user', user_metadata: {} };
  state.view = 'analysis';
  const data = rows();
  state.library.videos = data;
  const view = createViewRenderer({ state, renderDialog: () => '' });
  for (const method of ['pca', 'multiple', 'clusters', 'rules']) {
    state.analysis.method = method;
    state.analysis.result = runAnalysis(data, state.analysis);
    const html = view.content();
    assert.doesNotMatch(html, /(?:>|\s)(?:5|9|10)\. (?:主成分|相関ルール|クラスタリング)/);
    if (method === 'pca') {
      assert.match(html, /role="group" aria-label="[^"]*第1主成分の寄与率/);
      assert.match(html, /<desc>[^<]*Tab/);
      assert.match(html, /role="button"/);
    }
    if (method === 'multiple') assert.match(html, /95%区間 下限/);
    if (method === 'clusters') {
      assert.match(html, /グループ数kの比較/);
      assert.match(html, /対象全30曲で評価/);
      assert.match(html, /data-analysis-k="2"/);
    }
    if (method === 'rules') assert.match(html, /data-analysis-field="ruleSort"/);
  }
});
test('k比較のボタンは指定kで新しいWorkerを実行する', () => {
  const state = createInitialState();
  state.user = { id: 'test' };
  state.view = 'analysis';
  state.analysis.method = 'clusters';
  state.library.videos = rows();
  const listeners = {},
    messages = [];
  const root = { addEventListener: (type, handler) => (listeners[type] ||= []).push(handler) };
  createAnalysisController({
    root,
    state,
    render: () => {},
    createWorker: () => ({
      terminate() {},
      postMessage: (data) => messages.push(data),
    }),
  });
  const button = { dataset: { analysisK: '6' } };
  listeners.click.forEach((fn) => fn({ target: { closest: () => button } }));
  assert.equal(state.analysis.k, 6);
  assert.equal(messages[0].options.k, 6);
  assert.equal(messages[0].options.method, 'clusters');
});
