import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialState } from '../src/app/state.js';
import { createViewRenderer } from '../src/ui/views.js';
import { scatterTicks } from '../src/app/scatter.js';
import { filteredDiscovery } from '../src/discovery.js';

const source = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

function createTestState(count = 80) {
  const state = createInitialState();
  state.user = { id: 'test-user', email: 'example@example.invalid', user_metadata: {} };
  state.view = 'library';
  state.library.videos = Array.from({ length: count }, (_, index) => ({
    id: `sm${10000 + index}`,
    title: `動画サンプル ${index + 1}`,
    views: index + 1,
    published_at: '2025-01-01T00:00:00Z',
    tags: [],
  }));
  return state;
}

test('狭い画面用の下部ナビゲーションは既存の画面切替を利用する', () => {
  const state = createTestState();
  const { shell } = createViewRenderer({ state, renderDialog: () => '' });
  const html = shell();
  assert.match(html, /class="mobile-bottom-nav"/);
  for (const view of ['dashboard', 'library', 'trends', 'scatter', 'favorites', 'settings']) {
    assert.match(html, new RegExp(`data-view="${view}"`));
  }
  assert.match(html, /aria-label="モバイル用ナビゲーション"/);
});

test('検索条件は閉じた状態から開閉でき、入力を更新しても開いた状態を維持する', () => {
  const state = createTestState();
  const { content } = createViewRenderer({ state, renderDialog: () => '' });
  assert.match(content(), /<details class="library-extra-filters" >/);
  state.filterPanelsOpen = true;
  assert.match(content(), /<details class="library-extra-filters" open>/);
  assert.match(source('src/app/events.js'), /state\.filterPanelsOpen = event\.target\.open/);
});

test('32ページでも選択式ジャンプと前後ページが表示される', () => {
  const state = createTestState(1120);
  state.page = 24;
  const { content } = createViewRenderer({ state, renderDialog: () => '' });
  const html = content();
  assert.match(html, /id="page-jump"/);
  assert.match(html, /<option value="24" selected>24<\/option>/);
  assert.match(html, /<option value="32" >32<\/option>/);
  assert.match(source('src/app/events.js'), /e\.target\.id === 'page-jump'/);
});

test('非公開・削除対応は維持し、重複リストも詳細検索から表示できる', () => {
  const rows = [
    { id: 'sm1', memberships: [{ id: 'a' }, { id: 'b' }] },
    { id: 'sm2', memberships: [{ id: 'a' }] },
  ];
  assert.deepEqual(
    filteredDiscovery(rows, { status: 'duplicate' }).map((row) => row.id),
    ['sm1'],
  );
});

test('対数目盛りは100、1000、10000など切りのよい件数を使う', () => {
  const plotTicks = scatterTicks(Math.log10(51), Math.log10(32628001), 'views');
  const values = plotTicks.map((value) => Math.round(10 ** value - 1));
  assert.deepEqual(values, [100, 1000, 10000, 100000, 1000000, 10000000]);
  assert.ok(scatterTicks(1.1, 1.7, 'views').length >= 1);
});

test('画面全体のaria-liveを撤去し、トーストだけを読み上げる', () => {
  assert.doesNotMatch(source('index.html'), /id="app"[^>]*aria-live=/);
  assert.match(source('src/main.js'), /setAttribute\('role',\s*'status'\)/);
});

test('スマホのボタンは大きく、モーション削減設定を尊重する', () => {
  const css = source('src/style.css');
  assert.match(css, /\.mobile-bottom-nav\s*\{/);
  assert.match(css, /min-height:\s*56px/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('初期の音楽変遷はヒートマップを重視し、他の形式へ切替可能', () => {
  assert.equal(createInitialState().trends.chartStyle, 'matrix');
  const chartSource = source('src/ui/trend-charts.js');
  for (const view of ['matrix', 'line', 'spotlight']) {
    assert.ok(chartSource.includes(`value="${view}"`));
  }
});
