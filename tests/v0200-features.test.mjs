import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/app/state.js';
import {
  snapshotFromBridgeParts,
  diffSnapshot,
  diffSignature,
  toRpcPayload,
  normalizeSnapshot,
} from '../src/sync.js';
import { eligibleRows, analysisDefaults } from '../src/app/analytics/data.js';
import { runAnalysis } from '../src/app/analytics/engine.js';
import { analysisCsv } from '../src/app/analytics/export.js';
import { createAnalysisController } from '../src/app/analysis-controller.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';
import { createViewRenderer } from '../src/ui/views.js';

const remote = (name = '取得元の名前') => ({
  id: '101',
  name,
  complete: true,
  items: [{ video_id: 'sm1', title: '曲' }],
});
const library = () => ({
  playlists: [{ id: '101', name: '古い名前' }],
  videos: [{ id: 'sm1', title: '曲' }],
  entries: [{ playlist_id: '101', video_id: 'sm1', position: 1 }],
  meta: [],
});
test('実際に取得した名前がbridge/public共通のsnapshot・差分・RPCまで届く', () => {
  const lib = library();
  const snapshot = snapshotFromBridgeParts(lib.playlists, [remote()]);
  assert.equal(snapshot.lists[0].name, '取得元の名前');
  const diff = diffSnapshot(snapshot, lib);
  assert.equal(diff.renamed, 1);
  assert.equal(diff.added + diff.removed + diff.reordered, 0);
  assert.equal(toRpcPayload(snapshot).lists[0].name, '取得元の名前');
  const next = diffSnapshot(snapshotFromBridgeParts(lib.playlists, [remote('さらに変更')]), lib);
  assert.notEqual(diffSignature(diff), diffSignature(next));
  const state = createInitialState();
  state.library = lib;
  state.dialog = { kind: 'sync' };
  state.sync = diff;
  const html = createDialogRenderer({ state, nicoBridge: { connected: false } })();
  assert.match(html, /古い名前.*取得元の名前/s);
  assert.match(html, /確認して差分を反映/);
});
test('名前のない旧snapshotは名前を上書きせず、不正な名前は反映前に拒否する', () => {
  const lib = library(),
    reply = remote();
  delete reply.name;
  const snapshot = snapshotFromBridgeParts(lib.playlists, [reply]);
  assert.equal(Object.hasOwn(toRpcPayload(snapshot).lists[0], 'name'), false);
  assert.equal(diffSnapshot(snapshot, lib).renamed, 0);
  for (const name of ['', '  ', null, {}, 'あ'.repeat(201)]) {
    assert.throws(() => normalizeSnapshot({ ...snapshot, lists: [remote(name)] }));
  }
});
function rows() {
  return Array.from({ length: 45 }, (_, i) => ({
    id: 'sm' + (i + 1),
    title: '曲' + i,
    views: i * 173 + (i % 3) + 1,
    comments: i * i + 2,
    mylists: i * 5 + (i % 7) + 1,
    duration: 100 + ((i * i) % 71),
    published_at: '2020-01-01T00:00:00Z',
    tags: ['初音ミク', i % 2 ? 'ロック' : 'ポップ'],
    memberships: [{ id: i < 15 ? 'a' : i < 30 ? 'b' : 'c' }, ...(i < 5 ? [{ id: 'b' }] : [])],
  }));
}
test('複数リストは和集合、重複動画は1曲、空配列は全体', () => {
  const all = rows();
  assert.equal(eligibleRows(all, { playlists: ['a', 'b'] }).rows.length, 30);
  assert.equal(eligibleRows([...all, all[0]], { playlists: ['a', 'b'] }).rows.length, 30);
  assert.equal(eligibleRows(all, { playlists: [] }).rows.length, 45);
  assert.equal(eligibleRows(all, { playlist: 'a' }).rows.length, 15);
  assert.equal(eligibleRows(all, { playlists: ['c'] }).rows.length, 15);
});
test('6種類の分析とCSVが同じ複数選択スコープを使い、選択配列を共有しない', () => {
  for (const method of ['correlation', 'regression', 'multiple', 'pca', 'rules', 'clusters']) {
    const options = {
      ...analysisDefaults(),
      method,
      playlists: ['a', 'b'],
      features: ['views', 'comments', 'duration'],
      ruleExtras: true,
    };
    const result = runAnalysis(rows(), options);
    assert.equal(result.scope.available, 30, method);
    assert.match(analysisCsv(result), /a \/ b/);
    options.playlists.push('c');
    assert.deepEqual(result.options.playlists, ['a', 'b']);
  }
});
test('チェックボックスで複数選択・解除・全体へ戻すことができる', () => {
  const listeners = {},
    state = createInitialState();
  state.user = { id: 'a' };
  state.library.playlists = [
    { id: 'a', name: '<script>A</script>' },
    { id: 'b', name: 'B' },
  ];
  const root = { addEventListener: (type, fn) => (listeners[type] = fn) };
  createAnalysisController({ root, state, render() {} });
  const change = (value, checked) =>
    listeners.change({
      target: { value, checked, type: 'checkbox', dataset: { analysisField: 'playlists' } },
    });
  change('a', true);
  change('b', true);
  assert.deepEqual(state.analysis.playlists, ['a', 'b']);
  change('a', false);
  assert.deepEqual(state.analysis.playlists, ['b']);
  change('b', false);
  assert.deepEqual(state.analysis.playlists, []);
  change('a', true);
  change('', true);
  assert.deepEqual(state.analysis.playlists, []);
  change('unknown', true);
  assert.deepEqual(state.analysis.playlists, []);
  state.view = 'analysis';
  const html = createViewRenderer({ state, renderDialog: () => '' }).content();
  assert.match(html, /対象マイリスト（複数選択可）/);
  assert.match(html, /&lt;script&gt;A/);
  assert.doesNotMatch(html, /<script>/);
});
test('動画詳細だけが横幅拡大・二列レイアウトを使い、未接続でも補完できる', () => {
  const state = createInitialState();
  state.library = library();
  state.dialog = { kind: 'detail', id: 'sm1' };
  const modal = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const html = modal();
  assert.match(html, /class="modal modal-detail"/);
  assert.match(html, /class="detail-notes"/);
  assert.match(html, /id="enrich-single"\s*>/);
  for (const field of [
    'meta-fav',
    'meta-rating',
    'meta-memo',
    'meta-tags',
    'meta-voice',
    'meta-composer',
    'save-meta',
  ])
    assert.ok(html.includes('id="' + field + '"'));
  state.dialog = { kind: 'metadata' };
  const metadata = modal();
  assert.doesNotMatch(metadata, /modal-detail/);
  assert.match(metadata, /拡張機能不要/);
  assert.match(metadata, /従来のTampermonkey連携/);
});
