import test from 'node:test';
import assert from 'node:assert/strict';
import {
  orderTrendPlaylists, createTrendGroups, calculateTrend,
  compareTrendEndpoints, videosForTrendCell,
} from '../src/app/trends.js';
import { renderTrends } from '../src/ui/trends.js';

function video(id, overrides = {}) {
  return {
    id, title: id, published_at: '2025-01-01T00:00:00',
    voices: [], tags: [], producers: [], composers: [], uploader: '',
    userMeta: null, memberships: [], ...overrides,
  };
}

function fixture() {
  const playlists = [
    { id: 'fav', name: '最近のお気に入り' },
    { id: 'three', name: 'ぼかうた3' },
    { id: 'one', name: 'ぼかうた1' },
    { id: 'two', name: 'ぼかうた2' },
  ];
  const rows = [
    video('sm1', { voices: ['音街ウナ Spicy'], tags: ['ボカロック'], uploader: '作曲者A', published_at: '2023-02-10' }),
    video('sm2', { voices: ['Synthesizer V AI 音街ウナ'], tags: ['ボカポップ'], uploader: '作曲者B', published_at: '2024-05-01' }),
    video('sm3', { voices: ['初音ミク'], tags: ['ボカロック', 'ボカロック'], uploader: '作曲者C', published_at: '2024-07-01' }),
    video('sm4', { voices: [], tags: [], published_at: '' }),
    video('sm5', { voices: ['重音テト'], tags: ['元気が出る'], published_at: '2025-01-01' }),
    video('sm6', { voices: ['音街ウナ-SV'], tags: ['エレクトロ'], published_at: '2026-01-01' }),
    video('sm7', { voices: ['初音ミク'], published_at: 'not a year' }),
    video('sm8', { voices: ['音街ウナ Spicy'], published_at: '2026-01-01' }),
  ];
  const entries = [
    { playlist_id: 'one', video_id: 'sm1', position: 3, present: true },
    { playlist_id: 'one', video_id: 'sm2', position: 1, present: true },
    { playlist_id: 'one', video_id: 'sm3', position: 2, present: true },
    { playlist_id: 'one', video_id: 'sm4', position: 4, present: true },
    { playlist_id: 'two', video_id: 'sm2', position: 1, present: true },
    { playlist_id: 'two', video_id: 'sm5', position: 2, present: true },
    { playlist_id: 'three', video_id: 'sm6', position: 1, present: true },
    { playlist_id: 'three', video_id: 'sm7', position: 2, present: false },
    { playlist_id: 'fav', video_id: 'sm1', position: 1, present: true },
  ];
  return { library: { playlists, entries, videos: rows, meta: [] }, rows };
}

test('numbered playlists are ordered numerically; favorites are not a chronological stage', () => {
  const { library } = fixture();
  assert.deepEqual(orderTrendPlaylists(library.playlists).map((p) => p.id), ['one', 'two', 'three']);
  assert.deepEqual(orderTrendPlaylists(library.playlists, { includeOther: true }).map((p) => p.id), ['one', 'two', 'three', 'fav']);
});

test('fallback retains unnumbered playlists for other users', () => {
  assert.deepEqual(orderTrendPlaylists([{ id: 'x', name: 'お気に入り' }]).map((p) => p.id), ['x']);
});

test('each group deduplicates entries and ignores removed registrations', () => {
  const { library, rows } = fixture();
  library.entries.push({ playlist_id: 'one', video_id: 'sm1', position: 5, present: true });
  const groups = createTrendGroups(library, rows, { axis: 'playlist' });
  assert.deepEqual(groups.map((group) => group.total), [4, 2, 1]);
  assert.deepEqual(groups.map((group) => group.label), ['ぼかうた1', 'ぼかうた2', 'ぼかうた3']);
});

test('same song can contribute to two playlists, but only once to each category', () => {
  const { library, rows } = fixture();
  const result = calculateTrend(library, rows, { facet: 'voice', axis: 'playlist' });
  assert.equal(result.cells[0].values['音街ウナ'].count, 2);
  assert.equal(result.cells[0].values['音街ウナ'].percent, 50);
  assert.equal(result.cells[1].values['音街ウナ'].count, 1);
  assert.equal(result.cells[2].values['音街ウナ'].count, 1);
  assert.equal(result.cells[0].classified, 3);
  assert.equal(result.cells[0].total, 4);
});

test('genre values are based on all songs and repeated identical tags count once', () => {
  const { library, rows } = fixture();
  const result = calculateTrend(library, rows, { facet: 'genre' });
  assert.equal(result.cells[0].values['ロック'].count, 2);
  assert.equal(result.cells[0].values['ロック'].percent, 50);
  assert.equal(result.cells[0].classified, 3);
});

test('position groups use saved ascending position, not publication year', () => {
  const { library, rows } = fixture();
  const groups = createTrendGroups(library, rows, { axis: 'position', playlistId: 'one' });
  assert.deepEqual(groups.map((group) => group.label), ['1〜1番目', '2〜2番目', '3〜3番目', '4〜4番目']);
  assert.deepEqual(groups.map((group) => group.videos[0].id), ['sm2', 'sm3', 'sm1', 'sm4']);
});

test('position groups are capped at the number of active songs', () => {
  const { library, rows } = fixture();
  assert.equal(createTrendGroups(library, rows, { axis: 'position', playlistId: 'three' }).length, 1);
});

test('publication year axis is not computed from playlist membership', () => {
  const { library, rows } = fixture();
  const groups = createTrendGroups(library, rows, { axis: 'published' });
  assert.deepEqual(groups.map((group) => group.label), ['2023年', '2024年', '2025年', '2026年']);
  assert.deepEqual(groups.map((group) => group.total), [1, 2, 1, 2]);
});

test('trend cell selection returns precisely the matching video ids', () => {
  const { library, rows } = fixture();
  const result = calculateTrend(library, rows, { facet: 'voice', axis: 'playlist' });
  assert.deepEqual(videosForTrendCell(result, 'playlist:one', '音街ウナ').map((v) => v.id), ['sm1', 'sm2']);
  assert.deepEqual(videosForTrendCell(result, 'playlist:three', '音街ウナ').map((v) => v.id), ['sm6']);
  assert.deepEqual(videosForTrendCell(result, 'playlist:one', 'secret').map((v) => v.id), []);
});

test('endpoint differences use percentage points, not counts', () => {
  const { library, rows } = fixture();
  const result = calculateTrend(library, rows, { facet: 'voice', axis: 'playlist' });
  const diff = compareTrendEndpoints(result).find((item) => item.category === '音街ウナ');
  assert.equal(diff.first, 50);
  assert.equal(diff.last, 100);
  assert.equal(diff.delta, 50);
});

test('trends UI escapes untrusted artist labels and provides data selectors', () => {
  const { library, rows } = fixture();
  rows[0].uploader = '<img src=x onerror=alert(1)>';
  const state = {
    library,
    trends: { axis: 'playlist', facet: 'creator', playlistId: '', includeOther: false, selected: null },
  };
  const html = renderTrends({ state, rows, cards: () => '', hero: () => '<h1>変遷</h1>' });
  assert.match(html, /id="trend-axis"/);
  assert.match(html, /data-trend-group="playlist:one"/);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
});

test('trends UI includes card results when a table cell is selected', () => {
  const { library, rows } = fixture();
  const state = { library, trends: {
    axis: 'playlist', facet: 'voice', playlistId: '', includeOther: false,
    selected: { group: 'playlist:one', category: '音街ウナ' },
  } };
  const html = renderTrends({ state, rows, hero: () => '', cards: (selected) => `cards=${selected.map((x) => x.id).join(',')}` });
  assert.match(html, /cards=sm1,sm2/);
  assert.match(html, /判定情報がある動画/);
  assert.match(html, /実際に曲を聴いた日時/);
});

test('trend screen is reachable via real app view renderer and sidebar', async () => {
  const { createViewRenderer } = await import('../src/ui/views.js');
  const { createInitialState } = await import('../src/app/state.js');
  const { library } = fixture();
  const state = createInitialState();
  state.user = { email: 'test@example.com', user_metadata: {} };
  state.library = library;
  state.view = 'trends';
  const renderer = createViewRenderer({ state, renderDialog: () => '' });
  assert.match(renderer.content(), /id="trend-axis"/);
  assert.match(renderer.shell(), /data-view="trends"/);
  assert.match(renderer.shell(), /音楽の変遷/);
});

test('trend bars have explicit block layout to prevent the v0.10 display regression', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.trend-cell-fill\s*\{[^}]*display:\s*block/s);
  assert.match(css, /\.trend-scroll\s*\{[^}]*overflow-x:\s*auto/s);
});
