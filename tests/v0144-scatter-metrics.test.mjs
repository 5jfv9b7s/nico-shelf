import test from 'node:test';
import assert from 'node:assert/strict';

import { buildLibraryRows } from '../src/app/library.js';
import {
  SCATTER_METRICS,
  createScatterData,
  metricValue,
  readableMetric,
  scatterTicks,
} from '../src/app/scatter.js';
import { renderScatter } from '../src/ui/scatter.js';
import { createInitialState } from '../src/app/state.js';

const library = {
  playlists: [
    { id: 'one', name: 'ぼかうた1' },
    { id: 'three', name: 'ぼかうた3' },
  ],
  entries: [
    { playlist_id: 'one', video_id: 'sm1', present: true },
    { playlist_id: 'three', video_id: 'sm1', present: true },
    { playlist_id: 'three', video_id: 'sm2', present: true },
    { playlist_id: 'one', video_id: 'sm1', present: false },
  ],
  meta: [
    { video_id: 'sm1', rating: 5 },
    { video_id: 'sm2', rating: 0 },
  ],
  videos: [
    {
      id: 'sm1',
      title: 'ニコニコの例',
      status: '取得成功',
      views: 10000,
      mylists: 200,
      comments: 80,
      likes: 100,
    },
    {
      id: 'sm2',
      title: 'ゼロ再生',
      status: '取得成功',
      views: 0,
      mylists: 0,
      comments: 0,
      likes: 0,
    },
    {
      id: 'sm3',
      title: '情報未取得',
      status: '取得成功',
      views: 300,
      mylists: null,
      comments: null,
      likes: null,
    },
    {
      id: 'sm4',
      title: '非公開動画',
      status: 'private',
      views: 50000,
      mylists: 5000,
      comments: 1000,
      likes: 1000,
    },
  ],
};
const rows = buildLibraryRows(library);

test('ニコニコ全体のマイリスト数を散布図の軸に選べる', () => {
  assert.equal(SCATTER_METRICS.mylists.label, 'ニコニコのマイリスト数');
  assert.equal(SCATTER_METRICS.mylists.logarithmic, true);
  assert.equal(metricValue(rows[0], 'mylists'), 200);
  assert.equal(metricValue(rows[1], 'mylists'), 0);
  assert.equal(metricValue(rows[2], 'mylists'), null);
  const result = createScatterData(rows, { x: 'views', y: 'mylists' });
  assert.deepEqual(
    result.points.map((p) => p.id),
    ['sm1', 'sm2'],
  );
  assert.equal(result.excluded.private, 1);
});

test('マイリス率・コメント率・いいね率は1,000再生あたりで計算する', () => {
  assert.equal(metricValue(rows[0], 'mylistRate'), 20);
  assert.equal(metricValue(rows[0], 'commentRate'), 8);
  assert.equal(metricValue(rows[0], 'likeRate'), 10);
  assert.equal(metricValue(rows[1], 'mylistRate'), null, '0再生のとき0と断定しない');
  assert.equal(metricValue(rows[2], 'mylistRate'), null, 'マイリスト数未取得を0と誤認しない');
  assert.equal(metricValue(rows[2], 'commentRate'), null);
  assert.equal(metricValue({ views: 100, mylists: 0 }, 'mylistRate'), 0);
  assert.equal(metricValue({ views: 100, mylists: -1 }, 'mylistRate'), null);
});

test('ユーザーの所属リスト数とニコニコのマイリス数は別指標', () => {
  assert.equal(metricValue(rows[0], 'membershipCount'), 2);
  assert.equal(metricValue(rows[1], 'membershipCount'), 1);
  assert.equal(metricValue(rows[2], 'membershipCount'), 0);
  assert.equal(metricValue({ id: 'sm5' }, 'membershipCount'), null, '所属リスト未取得は数えない');
  assert.equal(metricValue({ memberships: [{ id: 'a' }, { id: 'a' }] }, 'membershipCount'), 1);
});

test('未評価と評価済みを区別し、評価軸と単位の表示を行う', () => {
  assert.equal(metricValue(rows[0], 'rating'), 5);
  assert.equal(metricValue(rows[1], 'rating'), null);
  assert.equal(metricValue(rows[2], 'rating'), null);
  assert.equal(metricValue({ userMeta: { rating: 6 } }, 'rating'), null);
  assert.equal(metricValue({ userMeta: { rating: 0 } }, 'rating'), null);
  assert.equal(readableMetric(2.1256, 'mylistRate'), '2.126');
  assert.deepEqual(scatterTicks(-0.2, 4.2, 'membershipCount'), [0, 1, 2, 3, 4]);
  assert.deepEqual(scatterTicks(1.5, 4.5, 'rating'), [2, 3, 4]);
});

test('UIに拡張軸と出典の説明を表示し、軸の選択状態を維持', () => {
  const state = createInitialState();
  state.scatter.x = 'mylists';
  state.scatter.y = 'mylistRate';
  const html = renderScatter({ state, rows, hero: () => '' });
  assert.match(html, /<option value="mylists" selected>/);
  assert.match(html, /<option value="mylistRate" selected>/);
  assert.match(html, /<option value="membershipCount"/);
  assert.match(html, /<option value="rating"/);
  assert.match(html, /<optgroup label="自分のライブラリ">/);
  assert.match(html, /1,000再生あたり/);
  assert.match(html, /非公開で除外/);
  assert.doesNotMatch(html, /data-scatter-video="sm4"/);
});
