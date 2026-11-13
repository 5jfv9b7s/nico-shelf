import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  videoId,
  esc,
  csvParse,
  csvToImport,
  normalizeImport,
  membershipMap,
  sortRows,
  autoPlaylist,
  singerStats,
} from '../src/lib.js';

test('動画IDをURLから正しく抽出し、不正IDは拒否', () => {
  assert.equal(videoId('sm12345678'), 'sm12345678');
  assert.equal(videoId('https://www.nicovideo.jp/watch/so456789?from=share'), 'so456789');
  assert.equal(videoId('https://www.nicovideo.jp/watch/sm12345678'), 'sm12345678');
  assert.equal(videoId('foo123'), null);
});
test('HTMLエスケープ', () => assert.equal(esc('<img src="x">'), '&lt;img src=&quot;x&quot;&gt;'));
test('CSVパーサーは改行・コンマ・引用符を処理', () => {
  const rows = csvParse('a,b\r\n"one,two","line\none"\r\n"a""b",4');
  assert.deepEqual(rows, [
    { a: 'one,two', b: 'line\none' },
    { a: 'a"b', b: '4' },
  ]);
});
test('CSV読み込みは同じ動画の複数リスト所属を維持', () => {
  const src =
    'playlist_id,playlist_name,video_id,position,title\na,ぼかうた1,sm123456,1,曲1\nb,ぼかうた2,sm123456,2,曲1';
  const data = csvToImport(src);
  assert.equal(data.videos.length, 1);
  assert.equal(data.playlists.length, 2);
  assert.equal(data.entries.length, 2);
});
test('自動登録は最近のお気に入りを除外し空きのある順', () => {
  const p = [
    { id: 'fav', name: '最近のお気に入り' },
    { id: '1', name: 'ぼかうた1' },
    { id: '2', name: 'ぼかうた2' },
    { id: '3', name: 'ぼかうた3' },
  ];
  const entries = [
    ...Array.from({ length: 500 }, (_, i) => ({ playlist_id: '1', video_id: `sm${i + 100}` })),
    ...Array.from({ length: 500 }, (_, i) => ({ playlist_id: '2', video_id: `sm${i + 100}` })),
  ];
  assert.equal(autoPlaylist(p, entries)?.id, '3');
});
test('登録順と所属先', () => {
  const m = membershipMap(
    [
      { playlist_id: '1', video_id: 'sm1', position: 1 },
      { playlist_id: '2', video_id: 'sm1', position: 8 },
      { playlist_id: '1', video_id: 'sm2', position: 2 },
    ],
    [
      { id: '1', name: 'ぼかうた1' },
      { id: '2', name: 'ぼかうた2' },
    ],
  );
  assert.deepEqual(
    m.get('sm1').map((x) => x.name),
    ['ぼかうた1', 'ぼかうた2'],
  );
  const rows = [
    { id: 'sm2', memberships: m.get('sm2') },
    { id: 'sm1', memberships: m.get('sm1') },
  ];
  assert.equal(sortRows(rows, 'registration', 'asc', '1')[0].id, 'sm1');
});
test('v0.3形式のJSONを正規化できる', () => {
  const input = {
    playlists: [
      { id: 'a', name: 'ぼかうた1' },
      { id: 'b', name: 'ぼかうた2' },
    ],
    videos: [
      { id: 'sm1234', title: '曲A', voices: ['音街ウナ'], tags: ['ポップ'] },
      { id: 'sm5678', title: '曲B', voices: ['初音ミク'] },
    ],
    entries: [
      { playlist_id: 'a', video_id: 'sm1234', position: 1 },
      { playlist_id: 'b', video_id: 'sm1234', position: 4 },
      { playlist_id: 'b', video_id: 'sm5678', position: 3 },
    ],
  };
  const data = normalizeImport(input);
  assert.equal(data.videos.length, 2);
  assert.equal(data.entries.length, 3);
  assert.equal(data.playlists.length, 2);
  assert.deepEqual(singerStats(data.videos, 5), [
    ['音街ウナ', 1],
    ['初音ミク', 1],
  ]);
});
