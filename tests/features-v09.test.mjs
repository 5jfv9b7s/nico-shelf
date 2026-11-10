import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SAVED_SEARCHES,
  normalizeSavedFilters,
  createSearchPreset,
  applySearchPreset,
} from '../src/app/saved-searches.js';
import { chooseRandomVideo, selectLibraryResults } from '../src/app/search.js';
import { makeLibraryCsv, csvCell } from '../src/app/csv-export.js';
import { filteredDiscovery } from '../src/discovery.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';

const library = {
  playlists: [{ id: '101', name: 'ぼかうた1' }],
  videos: [
    { id: 'sm100', title: '音街ウナのロック', voices: ['音街ウナ-SV'],
      tags: ['ボカロック'], views: 100, published_at: '2025-04-01T00:00:00Z', thumb: 'https://nicovideo.jp/100.png' },
    { id: 'sm200', title: '=HYPERLINK("malicious")', voices: [],
      tags: [], views: 200 },
    { id: 'sm300', title: '別の曲', voices: ['初音ミク'],
      tags: ['VOCAPOP'], views: 300 },
  ],
  entries: [
    { playlist_id: '101', video_id: 'sm100', position: 1, present: true },
    { playlist_id: '101', video_id: 'sm200', position: 2, present: false },
  ],
  meta: [
    { video_id: 'sm100', favorite: true, rating: 5, memo: '朝に聴く' },
    { video_id: 'sm200', rating: 0, personal_tags: '+SUM(A1:A2)' },
  ],
};

function fixture() {
  const state = createInitialState();
  state.view = 'library';
  state.library = library;
  state.user = { email: 'sample@example.org', user_metadata: {} };
  return state;
}

test('プリセットは検索と表示状態を保存する', () => {
  const current = fixture();
  Object.assign(current.filters, { q: '音街', voice: '音街ウナ', status: 'unrated', order: 'asc' });
  current.cardMode = 'grid';
  const preset = createSearchPreset({ name: '  音街ウナ   発掘  ', view: 'library', filters: current.filters, cardMode: current.cardMode });
  assert.equal(preset.name, '音街ウナ 発掘');
  assert.equal(preset.filters.voice, '音街ウナ');
  assert.equal(preset.card_mode, 'grid');
  assert.equal(MAX_SAVED_SEARCHES, 20);
});

test('プリセット復元は現在の状態を上書きしページを最初へ戻す', () => {
  const state = fixture();
  state.page = 8;
  state.filters.q = 'old';
  applySearchPreset(state, { id: 'preset-id', view: 'favorites', filters: { q: '好き', sort: 'published_at', order: 'asc' }, card_mode: 'grid' });
  assert.equal(state.view, 'favorites');
  assert.equal(state.filters.q, '好き');
  assert.equal(state.filters.order, 'asc');
  assert.equal(state.cardMode, 'grid');
  assert.equal(state.page, 1);
  assert.equal(state.activeSavedSearchId, 'preset-id');
});

test('プリセットの不正なsortやstatusを安全な値へ戻す', () => {
  const filters = normalizeSavedFilters({ sort: 'DROP TABLE', order: 'other', status: 'admin', q: 'a'.repeat(1000) });
  assert.equal(filters.sort, 'views');
  assert.equal(filters.order, 'desc');
  assert.equal(filters.status, '');
  assert.equal(filters.q.length, 250);
});

test('不明なビューを読み込んでもライブラリへ戻す', () => {
  const state = fixture();
  applySearchPreset(state, { view: 'settings', filters: {} });
  assert.equal(state.view, 'library');
  assert.throws(() => createSearchPreset({ name: ' ', view: 'library', filters: {} }), /名前/);
});

test('整理状況: 所属なしの動画だけを探せる', () => {
  const rows = selectLibraryResults(fixture()).rows;
  assert.deepEqual(filteredDiscovery(rows, { status: 'unlisted' }).map(v => v.id), ['sm300', 'sm200']);
});

test('整理状況: 歌唱者未判定と未評価の抽出', () => {
  const rows = selectLibraryResults(fixture()).rows;
  assert.deepEqual(filteredDiscovery(rows, { status: 'no-voice' }).map(v => v.id), ['sm200']);
  assert.deepEqual(filteredDiscovery(rows, { status: 'unrated' }).map(v => v.id), ['sm300', 'sm200']);
});

test('整理状況: 動画情報不足を抽出', () => {
  const rows = selectLibraryResults(fixture()).rows;
  assert.deepEqual(filteredDiscovery(rows, { status: 'missing-metadata' }).map(v => v.id), ['sm300', 'sm200']);
});

test('検索・一覧・CSVで同じ絞り込み結果を利用する', () => {
  const state = fixture();
  state.filters.voice = '音街ウナ';
  assert.deepEqual(selectLibraryResults(state).rows.map(v => v.id), ['sm100']);
  const csv = makeLibraryCsv(selectLibraryResults(state).rows);
  assert.match(csv, /sm100/);
  assert.doesNotMatch(csv, /sm200/);
});

test('リスト別の表示時は選択リストだけを対象とする', () => {
  const state = fixture();
  state.view = 'playlist:101';
  state.filters.playlist = '';
  assert.deepEqual(selectLibraryResults(state).rows.map(v => v.id), ['sm100']);
});

test('ランダム選曲は候補全体から1件を返す', () => {
  const rows = selectLibraryResults(fixture()).rows;
  assert.equal(chooseRandomVideo(rows, () => 0).id, rows[0].id);
  assert.equal(chooseRandomVideo(rows, () => 0.99999).id, rows.at(-1).id);
  assert.equal(chooseRandomVideo([], () => 0), null);
});

test('CSVは日本語用BOMと全所属・メモ・評価を含む', () => {
  const csv = makeLibraryCsv(selectLibraryResults(fixture()).rows);
  assert.equal(csv.codePointAt(0), 0xFEFF);
  assert.match(csv, /"所属マイリスト"/);
  assert.match(csv, /"ぼかうた1"/);
  assert.match(csv, /"朝に聴く"/);
  assert.match(csv, /"5"/);
});

test('CSV注入対策: 数式・改行・引用符を無害なテキストとして出力する', () => {
  assert.equal(csvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(csvCell('  +evil'), '"\'  +evil"');
  assert.equal(csvCell('"quoted"'), '"""quoted"""');
  assert.equal(csvCell('abc\r\ndef'), '"abc\r\ndef"');
  assert.match(makeLibraryCsv(selectLibraryResults(fixture()).rows), /"'=HYPERLINK/);
});

test('UI: 保存検索・CSV・ランダム選曲・整理状況の操作が表示される', () => {
  const state = fixture();
  state.savedSearches = [{ id: 'preset-1', name: '音街ウナだけ' }];
  state.activeSavedSearchId = 'preset-1';
  const dialog = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const renderer = createViewRenderer({ state, renderDialog: dialog });
  const html = renderer.content();
  for (const id of ['saved-search-select', 'save-search', 'delete-search', 'export-filtered', 'surprise-me', 'status-filter']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /音街ウナだけ/);
});

test('UI: SQL未適用では保存操作を無効化して理由を表示する', () => {
  const state = fixture();
  state.savedSearchesError = 'SQL適用が必要';
  const dialog = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const renderer = createViewRenderer({ state, renderDialog: dialog });
  assert.match(renderer.content(), /SQL適用が必要/);
  assert.match(renderer.content(), /id="save-search" disabled/);
});

test('UI: 保存検索ダイアログは名前入力と説明を表示する', () => {
  const state = fixture();
  state.dialog = { kind: 'save-search' };
  const dialog = createDialogRenderer({ state, nicoBridge: { connected: false } });
  const html = dialog();
  assert.match(html, /id="saved-search-name"/);
  assert.match(html, /id="save-search-confirm"/);
});

test('JSONバックアップ復元: 保存検索が存在しても安全な構造に正規化できる', async () => {
  const { normalizeImport } = await import('../src/lib.js');
  const parsed = normalizeImport({
    playlists: [{ id: '101', name: 'ぼかうた1' }],
    videos: [{ id: 'sm100', title: '曲' }],
    entries: [{ playlist_id: '101', video_id: 'sm100' }],
    saved_searches: [{ name: 'お気に入りの音街ウナ', view: 'favorites', filters: { voice: '音街ウナ' }, card_mode: 'grid' }],
  });
  assert.equal(parsed.savedSearches.length, 1);
  assert.equal(parsed.savedSearches[0].view, 'favorites');
  assert.equal(parsed.savedSearches[0].filters.voice, '音街ウナ');
  assert.equal(parsed.savedSearches[0].card_mode, 'grid');
  assert.equal(parsed.savedSearches[0].owner_id, undefined);
});

test('JSONバックアップ復元: 同名検索や上限超過は拒否する', async () => {
  const { normalizeImport } = await import('../src/lib.js');
  const base = { playlists: [], videos: [], entries: [] };
  const p = { name: '重複', view: 'library', filters: {} };
  assert.throws(() => normalizeImport({ ...base, saved_searches: [p, p] }), /同名/);
  assert.throws(() => normalizeImport({ ...base, saved_searches: Array.from({ length: 21 }, (_, i) => ({ name: `条件${i}` })) }), /上限/);
});
