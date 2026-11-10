import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLibraryRows, countLibrary } from '../src/app/library.js';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { createDialogRenderer } from '../src/ui/dialogs.js';
import { safeThumb } from '../src/ui/media.js';

function fixtureLibrary() {
  return {
    playlists: [
      { id: '101', name: 'ぼかうた1' },
      { id: '102', name: 'ぼかうた2' },
      { id: '103', name: '最近のお気に入り' },
    ],
    videos: [
      { id: 'sm100', title: '<script>不正な曲名</script>', views: 120, voices: ['音街ウナ Spicy'] },
      { id: 'sm200', title: 'テスト曲', views: 900, voices: ['初音ミク'] },
      { id: 'sm300', title: '削除履歴', views: 30 },
    ],
    entries: [
      { playlist_id: '101', video_id: 'sm100', position: 1, present: true },
      { playlist_id: '102', video_id: 'sm100', position: 2, present: true },
      { playlist_id: '101', video_id: 'sm200', position: 3, present: true },
      { playlist_id: '102', video_id: 'sm300', position: 4, present: false },
    ],
    meta: [{ video_id: 'sm100', favorite: true, memo: '大切な曲' }],
  };
}

function createFixtureUI() {
  const state = createInitialState();
  state.user = { email: 'example@example.com', user_metadata: { name: 'テストユーザー' } };
  state.library = fixtureLibrary();

  const bridge = { connected: true };
  const renderDialog = createDialogRenderer({ state, nicoBridge: bridge });
  const view = createViewRenderer({ state, renderDialog });
  return { state, view, renderDialog };
}

test('ログインユーザーの登録情報と削除済みエントリを区別する', () => {
  const library = fixtureLibrary();
  assert.deepEqual(countLibrary(library), {
    videos: 3,
    entries: 3,
    duplicates: 1,
    tracked: 2,
  });

  const rows = buildLibraryRows(library);
  assert.deepEqual(rows.find((video) => video.id === 'sm100').memberships.map((m) => m.name), [
    'ぼかうた1',
    'ぼかうた2',
  ]);
  assert.equal(rows.find((video) => video.id === 'sm100').userMeta.memo, '大切な曲');
  assert.equal(rows.find((video) => video.id === 'sm300').memberships.length, 0);
});

test('描画: 既存のライブラリ検索・ソート・重複表示が残る', () => {
  const { state, view } = createFixtureUI();
  state.view = 'library';
  const html = view.content();

  assert.match(html, /id="sort-field"/);
  assert.match(html, /id="sort-reset"/);
  assert.match(html, /id="voice-filter"/);
  assert.match(html, /id="genre-filter"/);
  assert.match(html, /id="mood-filter"/);
  assert.match(html, /ぼかうた1/);
  assert.match(html, /ぼかうた2/);
  assert.doesNotMatch(html, /<script>不正な曲名<\/script>/);
  assert.match(html, /&lt;script&gt;不正な曲名&lt;\/script&gt;/);
});

test('描画: ダッシュボードは既存の歌唱者集計と分析を表示する', () => {
  const { view } = createFixtureUI();
  const html = view.content();
  assert.match(html, /歌唱者ランキング/);
  assert.match(html, /マイリスト別・歌唱者の傾向/);
  assert.match(html, /タグから推定したジャンル/);
});

test('描画: 連携確認後にだけ登録ボタンを有効化する', () => {
  const { state, renderDialog } = createFixtureUI();
  state.dialog = { kind: 'add', vid: 'sm400', target: 'auto' };
  let html = renderDialog();
  assert.match(html, /id="nico-register" disabled/);
  assert.match(html, /id="nico-inspect"/);

  state.dialog.probe = {
    videoId: 'sm400',
    lists: [
      { id: '101', name: 'ぼかうた1', count: 1, hasVideoIds: [] },
      { id: '102', name: 'ぼかうた2', count: 1, hasVideoIds: [] },
      { id: '103', name: '最近のお気に入り', count: 1, hasVideoIds: [] },
    ],
  };
  html = renderDialog();
  assert.match(html, /追加先：<b>ぼかうた1<\/b>/);
  assert.doesNotMatch(html, /id="nico-register" disabled/);
});

test('サムネイルのURLはニコニコ関連のHTTPSドメインに限定する', () => {
  assert.equal(safeThumb('https://nicovideo.jp/thumb.jpg'), 'https://nicovideo.jp/thumb.jpg');
  assert.equal(safeThumb('https://nicovideo.jp.attacker.example/track'), '');
  assert.equal(safeThumb('javascript:alert(1)'), '');
  assert.equal(safeThumb('http://nicovideo.jp/thumb.jpg'), '');
});
